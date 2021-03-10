import path from 'path';
import fs from 'fs';
import type { LevelUp } from 'levelup';
import BN from 'bn.js';
import { Account, Address, bufferToHex, setLengthLeft } from 'ethereumjs-util';
import { SecureTrie as Trie } from 'merkle-patricia-tree';
import PeerId from 'peer-id';
import { Database, createLevelDB, DBSaveReceipts } from '@gxchain2/database';
import { Libp2pNode, PeerPool } from '@gxchain2/network';
import { Common, constants, defaultGenesis } from '@gxchain2/common';
import { Blockchain } from '@gxchain2/blockchain';
import { StateManager } from '@gxchain2/state-manager';
import { VM, WrappedVM } from '@gxchain2/vm';
import { TxPool } from '@gxchain2/tx-pool';
import { Block } from '@gxchain2/block';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { hexStringToBuffer, AsyncChannel, Aborter, logger } from '@gxchain2/utils';
import { FullSynchronizer, Synchronizer } from './sync';
import { TxFetcher } from './txsync';
import { Miner } from './miner';
import { threadId } from 'worker_threads';

export interface NodeOptions {
  databasePath: string;
  mine?: {
    coinbase: string;
    mineInterval: number;
    gasLimit: string;
  };
  p2p?: {
    tcpPort?: number;
    wsPort?: number;
    bootnodes?: string[];
  };
}

type AddPendingTxs = {
  txs: (Transaction | WrappedTransaction)[];
  resolve: (results: boolean[]) => void;
};

export class Node {
  public readonly rawdb: LevelUp;

  public db!: Database;
  public common!: Common;
  public peerpool!: PeerPool;
  public blockchain!: Blockchain;
  public sync!: Synchronizer;
  public txPool!: TxPool;
  public miner!: Miner;
  public txSync!: TxFetcher;

  private readonly options: NodeOptions;
  private readonly initPromise: Promise<void>;
  private readonly aborter = new Aborter();
  private readonly newBlockQueue = new AsyncChannel<Block>({ max: 1, isAbort: () => this.aborter.isAborted });
  private readonly addPendingTxsQueue = new AsyncChannel<AddPendingTxs>({ isAbort: () => this.aborter.isAborted });

  constructor(options: NodeOptions) {
    this.options = options;
    this.rawdb = createLevelDB(path.join(this.options.databasePath, 'chaindb'));
    this.initPromise = this.init();
    this.newBlockLoop();
    this.addPendingTxsLoop();
  }

  get status() {
    return {
      networkId: this.common.networkId(),
      height: this.blockchain.latestHeight,
      bestHash: this.blockchain.latestHash,
      genesisHash: this.common.genesis().hash
    };
  }

  private async setupAccountInfo(
    accountInfo: {
      [index: string]: {
        nonce: string;
        balance: string;
        storage: {
          [index: string]: string;
        };
        code: string;
      };
    },
    stateManager: StateManager
  ) {
    await stateManager.checkpoint();
    for (const addr of Object.keys(accountInfo)) {
      const { nonce, balance, storage, code } = accountInfo[addr];
      const address = new Address(Buffer.from(addr.slice(2), 'hex'));
      const account = Account.fromAccountData({ nonce, balance });
      await stateManager.putAccount(address, account);
      for (const hexStorageKey of Object.keys(storage)) {
        const val = Buffer.from(storage[hexStorageKey], 'hex');
        const storageKey = setLengthLeft(Buffer.from(hexStorageKey, 'hex'), 32);
        await stateManager.putContractStorage(address, storageKey, val);
      }
      const codeBuf = Buffer.from(code.slice(2), 'hex');
      await stateManager.putContractCode(address, codeBuf);
    }
    await stateManager.commit();
    return stateManager._trie.root;
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    let genesisJSON;
    try {
      genesisJSON = JSON.parse(fs.readFileSync(path.join(this.options.databasePath, 'genesis.json')).toString());
    } catch (err) {
      logger.warn('Read genesis.json faild, use default genesis');
      genesisJSON = defaultGenesis;
    }

    const poa: Buffer[] = [];
    if (genesisJSON.POA && Array.isArray(genesisJSON.POA)) {
      for (const address of genesisJSON.POA) {
        if (typeof address === 'string') {
          poa.push(hexStringToBuffer(address));
        }
      }
    }

    this.common = new Common(
      {
        chain: genesisJSON.genesisInfo,
        hardfork: 'chainstart'
      },
      poa
    );
    this.db = new Database(this.rawdb, this.common);

    let genesisBlock!: Block;
    try {
      const genesisHash = await this.db.numberToHash(new BN(0));
      genesisBlock = await this.db.getBlock(genesisHash);
      logger.info('find genesis block in db', bufferToHex(genesisHash));
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }

    if (!genesisBlock) {
      genesisBlock = Block.genesis({ header: genesisJSON.genesisInfo.genesis }, { common: this.common });
      logger.log('read genesis block from file', bufferToHex(genesisBlock.hash()));

      const stateManager = new StateManager({ common: this.common, trie: new Trie(this.rawdb) });
      const root = await this.setupAccountInfo(genesisJSON.accountInfo, stateManager);
      if (!root.equals(genesisBlock.header.stateRoot)) {
        logger.error('state root not equal', bufferToHex(root), '0x' + bufferToHex(genesisBlock.hash()));
        throw new Error('state root not equal');
      }
    }

    this.common.setHardfork('muirGlacier');
    this.blockchain = new Blockchain({
      db: this.rawdb,
      database: this.db,
      common: this.common,
      validateConsensus: false,
      validateBlocks: true,
      genesisBlock
    });
    await this.blockchain.init();

    this.sync = new FullSynchronizer({ node: this });
    this.sync
      .on('error', (err) => {
        logger.error('Sync error:', err);
      })
      .on('synchronized', () => {
        const block = this.blockchain.latestBlock;
        this.newBlock(block);
      });

    this.txPool = new TxPool({ node: this, journal: this.options.databasePath });

    let peerId!: PeerId;
    try {
      const key = fs.readFileSync(path.join(this.options.databasePath, 'peer-key'));
      peerId = await PeerId.createFromPrivKey(key);
    } catch (err) {
      logger.warn('Read peer-key faild, generate a new key');
      peerId = await PeerId.create({ bits: 1024, keyType: 'Ed25519' });
      fs.writeFileSync(path.join(this.options.databasePath, 'peer-key'), peerId.privKey.bytes);
    }

    this.peerpool = new PeerPool({
      nodes: await Promise.all(
        [
          new Libp2pNode({
            node: this,
            peerId,
            protocols: new Set<string>([constants.GXC2_ETHWIRE]),
            tcpPort: this.options?.p2p?.tcpPort,
            wsPort: this.options?.p2p?.wsPort,
            bootnodes: this.options?.p2p?.bootnodes
          })
        ].map(
          (n) => new Promise<Libp2pNode>((resolve) => n.init().then(() => resolve(n)))
        )
      )
    });
    this.peerpool
      .on('error', (err) => {
        logger.error('Peer pool error:', err);
      })
      .on('added', (peer) => {
        const status = peer.getStatus(constants.GXC2_ETHWIRE);
        if (status && status.height !== undefined) {
          this.sync.announce(peer, status.height);
          peer.announceTx(this.txPool.getPooledTransactionHashes());
        }
      })
      .on('removed', (peer) => {
        this.txSync.dropPeer(peer.peerId);
      });

    this.sync.start();
    this.miner = new Miner(this, this.options.mine);
    await this.txPool.init();
    this.txSync = new TxFetcher(this);
  }

  async getStateManager(root: Buffer) {
    const stateManager = new StateManager({ common: this.common, trie: new Trie(this.rawdb) });
    await stateManager.setStateRoot(root);
    return stateManager;
  }

  async getWrappedVM(root: Buffer) {
    const stateManager = await this.getStateManager(root);
    return new WrappedVM(
      new VM({
        common: this.common,
        stateManager,
        blockchain: this.blockchain
      })
    );
  }

  async processBlock(blockSkeleton: Block, generate: boolean = true) {
    await this.initPromise;
    const lastHeader = await this.db.getHeader(blockSkeleton.header.parentHash, blockSkeleton.header.number.subn(1));
    const opts = {
      block: blockSkeleton,
      root: lastHeader.stateRoot,
      generate
    };
    const { result, block } = await (await this.getWrappedVM(lastHeader.stateRoot)).runBlock(opts);
    blockSkeleton = block || blockSkeleton;
    logger.info('✨ Process block, height:', blockSkeleton.header.number.toString(), 'hash:', bufferToHex(blockSkeleton.hash()));
    await this.blockchain.putBlock(blockSkeleton);
    await this.blockchain.saveTxLookup(blockSkeleton);
    await this.db.batch([DBSaveReceipts(result.receipts, blockSkeleton.hash(), blockSkeleton.header.number)]);
    return blockSkeleton;
  }

  async processBlocks(blocks: Block[]) {
    for (const block of blocks) {
      await this.processBlock(block);
    }
  }

  private async newBlockLoop() {
    await this.initPromise;
    for await (const block of this.newBlockQueue.generator()) {
      try {
        for (const peer of this.peerpool.peers) {
          if (peer.isSupport(constants.GXC2_ETHWIRE)) {
            peer.newBlock(block);
          }
        }
        await this.txPool.newBlock(block);
        await this.miner.worker.newBlock(block);
      } catch (err) {
        logger.error('Node::newBlockLoop, catch error:', err);
      }
    }
  }

  private async addPendingTxsLoop() {
    await this.initPromise;
    for await (const addPendingTxs of this.addPendingTxsQueue.generator()) {
      try {
        const { results, readies } = await this.txPool.addTxs(addPendingTxs.txs.map((tx) => (tx instanceof Transaction ? new WrappedTransaction(tx) : tx)));
        if (readies && readies.size > 0) {
          const hashes = Array.from(readies.values())
            .reduce((a, b) => a.concat(b), [])
            .map((wtx) => wtx.transaction.hash());
          for (const peer of this.peerpool.peers) {
            peer.announceTx(hashes);
          }
          await this.miner.worker.addTxs(readies);
        }
        addPendingTxs.resolve(results);
      } catch (err) {
        addPendingTxs.resolve(new Array<boolean>(addPendingTxs.txs.length).fill(false));
        logger.error('Node::addPendingTxsLoop, catch error:', err);
      }
    }
  }

  async newBlock(block: Block) {
    await this.initPromise;
    this.newBlockQueue.push(block);
  }

  async addPendingTxs(txs: (Transaction | WrappedTransaction)[]) {
    await this.initPromise;
    return new Promise<boolean[]>((resolve) => {
      this.addPendingTxsQueue.push({ txs, resolve });
    });
  }
}
