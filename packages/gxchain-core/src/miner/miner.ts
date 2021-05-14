import { hexStringToBN, hexStringToBuffer, logger, getRandomIntInclusive } from '@gxchain2/utils';
import { Block, CLIQUE_DIFF_NOTURN, validateBlock } from '@gxchain2/block';
import { Worker } from './worker';
import { Loop } from './loop';
import { Node } from '../node';
import { Address, BN, bufferToHex } from 'ethereumjs-util';
import { getPrivateKey } from '../fakeaccountmanager';

export interface MinerOptions {
  coinbase: string;
  mineInterval: number;
  gasLimit: string;
}

export class Miner extends Loop {
  public readonly worker: Worker;

  private _coinbase: Buffer;
  private _gasLimit: BN;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;

  constructor(node: Node, options?: MinerOptions) {
    super(options?.mineInterval || 0);
    this.node = node;
    this.options = options;
    this._coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : Address.zero().buf;
    this._gasLimit = this?.options?.gasLimit ? hexStringToBN(this.options.gasLimit) : hexStringToBN('0xbe5c8b');
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', () => {
      this.worker.stopLoop();
      this.stopLoop();
    });
    node.sync.on('synchronized', () => {
      this.worker.startLoop();
      this.startLoop();
    });
    node.sync.on('synchronize failed', () => {
      this.worker.startLoop();
      this.startLoop();
    });
  }

  /**
   * Get the mining state
   */
  get isMining() {
    return !!this.options;
  }

  /**
   * Get the coinbase
   */
  get coinbase() {
    return this._coinbase;
  }

  /**
   * Get the limit of gas
   */
  get gasLimit() {
    return this._gasLimit;
  }

  /**
   * Set the coinbase
   * @param coinbase
   */
  setCoinbase(coinbase: string | Buffer) {
    this._coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
  }

  /**
   * Set the gas limit
   * @param gasLimit
   */
  setGasLimit(gasLimit: string | BN) {
    this._gasLimit = typeof gasLimit === 'string' ? hexStringToBN(gasLimit) : gasLimit;
  }

  /**
   * Initialize the miner
   * @returns
   */
  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.worker.init();
    this.worker.startLoop();
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Start the loop
   */
  startLoop() {
    if (this.isMining) {
      super.startLoop();
    }
  }

  /**
   * Mine the Block
   */
  async mineBlock() {
    await this.initPromise;
    const lastHeader = this.node.blockchain.latestBlock.header;
    let block = await this.worker.getPendingBlock(lastHeader.number, lastHeader.hash());
    const now = Math.floor(Date.now() / 1000);
    const sleep = lastHeader._common.consensusConfig().period - (now - lastHeader.timestamp.toNumber());
    if (sleep > 0) {
      logger.debug('sleep for block period', sleep, 'next block should be mined at', lastHeader.timestamp.toNumber() + lastHeader._common.consensusConfig().period);
      await new Promise((r) => setTimeout(r, sleep * 1000));
    }
    // rebuild block for timestamp.
    block = Block.fromBlockData({ header: { ...block.header, timestamp: Math.floor(Date.now() / 1000) }, transactions: [...block.transactions] }, { common: block._common, cliqueSigner: getPrivateKey(this.coinbase.toString('hex')) });
    if (block.header.difficulty.eq(CLIQUE_DIFF_NOTURN)) {
      if (!this.working) {
        return;
      }
      if (!lastHeader.hash().equals(this.node.blockchain.latestBlock.header.hash())) {
        return;
      }
      if (block.header.timestamp.lte(lastHeader.timestamp)) {
        return;
      }
      const signerCount = this.node.blockchain.cliqueActiveSigners().length;
      const sleep2 = getRandomIntInclusive(1, signerCount + 1) * 200;
      logger.debug('not turn, random sleep', sleep2);
      await new Promise((r) => setTimeout(r, sleep2));
      logger.debug('not turn, sleep over');
      if (!this.working) {
        return;
      }
      if (!lastHeader.hash().equals(this.node.blockchain.latestBlock.header.hash())) {
        return;
      }
    } else {
      logger.debug('in turn');
    }
    logger.debug('start mint');
    const newBlock = await this.node.processBlock(block);
    await this.node.newBlock(newBlock);
    logger.debug('mint over');
    logger.info('⛏️  Mine block, height:', newBlock.header.number.toString(), 'hash:', bufferToHex(newBlock.hash()));
  }

  protected async process() {
    try {
      await this.mineBlock();
    } catch (err) {
      logger.error('Miner::process, catch error:', err);
    }
  }
}
