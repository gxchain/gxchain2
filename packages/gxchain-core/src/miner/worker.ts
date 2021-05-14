import { Address, BN } from 'ethereumjs-util';
import { Block, BlockHeader, calcCliqueDifficulty, CLIQUE_DIFF_NOTURN } from '@gxchain2/block';
import { calculateTransactionTrie, TypedTransaction } from '@gxchain2/tx';
import { PendingTxMap } from '@gxchain2/tx-pool';
import { WrappedVM } from '@gxchain2/vm';
import { logger } from '@gxchain2/utils';
import { StateManager } from '@gxchain2/state-manager';
import { RunTxResult } from '@ethereumjs/vm/dist/runTx';
import { Loop } from './loop';
import { Miner } from './miner';
import { Node } from '../node';
import { getPrivateKey } from '../fakeaccountmanager';

export class Worker extends Loop {
  private readonly miner: Miner;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;

  private wvm!: WrappedVM;
  private txs: TypedTransaction[] = [];
  private header!: BlockHeader;
  private gasUsed = new BN(0);

  constructor(node: Node, miner: Miner) {
    super(1000);
    this.node = node;
    this.miner = miner;
    this.initPromise = this.init();
  }

  /**
   * Initialize the worker
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this._newBlock(this.node.blockchain.latestBlock);
  }

  /**
   * Assembles the new block
   * @param block
   */
  async newBlock(block: Block) {
    await this.initPromise;
    await this._newBlock(block);
  }

  private async makeHeader(parentHash: Buffer, number: BN) {
    if (this.miner.isMining) {
      const signer = new Address(this.miner.coinbase);
      const [inTurn, difficulty] = calcCliqueDifficulty(this.node.blockchain.cliqueActiveSigners(), signer, number);
      return BlockHeader.fromHeaderData(
        {
          // TODO: add beneficiary.
          coinbase: Address.zero(),
          difficulty,
          gasLimit: this.miner.gasLimit,
          // TODO: add beneficiary.
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp: new BN(Math.floor(Date.now() / 1000)),
          uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347'
        },
        { common: this.node.getCommon(number), cliqueSigner: getPrivateKey(this.miner.coinbase.toString('hex')) }
      );
    } else {
      return BlockHeader.fromHeaderData(
        {
          coinbase: Address.zero(),
          difficulty: CLIQUE_DIFF_NOTURN.clone(),
          gasLimit: this.miner.gasLimit,
          nonce: Buffer.alloc(8),
          number,
          parentHash,
          timestamp: new BN(Math.floor(Date.now() / 1000)),
          uncleHash: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
          transactionsTrie: await calculateTransactionTrie([])
        },
        { common: this.node.getCommon(number) }
      );
    }
  }

  private async _newBlock(block: Block) {
    try {
      if (this.wvm) {
        if ((this.wvm.vm.stateManager as any)._trie.isCheckpoint) {
          await this.wvm.vm.stateManager.revert();
        }
      }
      this.txs = [];
      this.gasUsed = new BN(0);
      const newNumber = block.header.number.addn(1);
      this.header = await this.makeHeader(block.header.hash(), block.header.number.addn(1));
      this.wvm = await this.node.getWrappedVM(block.header.stateRoot, newNumber);
      await this.wvm.vm.stateManager.checkpoint();
      await this.commit(await this.node.txPool.getPendingMap(block.header.number, block.header.hash()));
    } catch (err) {
      logger.error('Worker::_newBlock, catch error:', err);
    }
  }

  /**
   * Add transactions for c
   * @param txs - The map of Buffer and array of transactions
   */
  async addTxs(txs: Map<Buffer, TypedTransaction[]>) {
    await this.initPromise;
    try {
      const pendingMap = new PendingTxMap();
      for (const [sender, sortedTxs] of txs) {
        pendingMap.push(sender, sortedTxs);
      }
      await this.commit(pendingMap);
    } catch (err) {
      logger.error('Worker::addTxs, catch error:', err);
    }
  }

  /**
   * Assembles the pending block from block data
   * @returns
   */
  async getPendingBlock(number?: BN, hash?: Buffer) {
    await this.initPromise;
    if (number && hash && (!number.addn(1).eq(this.header.number) || !hash.equals(this.header.parentHash))) {
      logger.debug('getPendingBlock return a empty block');
      return Block.fromBlockData(
        {
          header: await this.makeHeader(hash, number.addn(1))
        },
        { common: this.node.getCommon(number.addn(1)), cliqueSigner: this.miner.isMining ? getPrivateKey(this.miner.coinbase.toString('hex')) : undefined }
      );
    }
    const txs = [...this.txs];
    const header = { ...this.header };
    return Block.fromBlockData(
      {
        header: {
          ...header,
          timestamp: new BN(Math.floor(Date.now() / 1000)),
          transactionsTrie: await calculateTransactionTrie(txs)
        },
        transactions: txs
      },
      { common: this.node.getCommon(header.number), cliqueSigner: this.miner.isMining ? getPrivateKey(this.miner.coinbase.toString('hex')) : undefined }
    );
  }

  async getPendingStateManager() {
    await this.initPromise;
    if (this.wvm) {
      return new StateManager({ common: (this.wvm.vm.stateManager as any)._common, trie: (this.wvm.vm.stateManager as any)._trie.copy(false) });
    }
    return await this.node.getStateManager(this.node.blockchain.latestBlock.header.stateRoot, this.node.blockchain.latestHeight);
  }

  protected async process() {
    await this.newBlock(this.node.blockchain.latestBlock);
  }

  private async commit(pendingMap: PendingTxMap) {
    let tx = pendingMap.peek();
    while (tx) {
      try {
        await this.wvm.vm.stateManager.checkpoint();

        let txRes: RunTxResult;
        try {
          txRes = await this.wvm.vm.runTx({
            tx,
            block: Block.fromBlockData({ header: this.header }, { common: (this.wvm.vm.stateManager as any)._common }),
            skipBalance: false,
            skipNonce: false
          });
        } catch (err) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
          tx = pendingMap.peek();
          continue;
        }

        if (this.header.gasLimit.lt(txRes.gasUsed.add(this.gasUsed))) {
          await this.wvm.vm.stateManager.revert();
          pendingMap.pop();
        } else {
          await this.wvm.vm.stateManager.commit();
          this.txs.push(tx);
          this.gasUsed.iadd(txRes.gasUsed);
          pendingMap.shift();
        }
      } catch (err) {
        pendingMap.pop();
      } finally {
        tx = pendingMap.peek();
      }
    }
  }
}
