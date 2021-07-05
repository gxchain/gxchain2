import { EventEmitter } from 'events';
import { logger } from '@gxchain2/utils';
import { Peer } from '@gxchain2/network';
import type { Node } from '../node';

export interface SynchronizerOptions {
  node: Node;
  interval?: number;
}

export declare interface Synchronizer {
  on(event: 'start', listener: () => void): this;
  on(event: 'synchronized', listener: () => void): this;
  on(event: 'failed', listener: () => void): this;
  on(event: 'error', listener: (err: any) => void): this;

  once(event: 'start', listener: () => void): this;
  once(event: 'synchronized', listener: () => void): this;
  once(event: 'failed', listener: () => void): this;
  once(event: 'error', listener: (err: any) => void): this;
}

/**
 * Base class for blockchain synchronizers
 */
export abstract class Synchronizer extends EventEmitter {
  protected readonly node: Node;
  protected readonly interval: number;
  protected forceSync: boolean = false;
  protected startingBlock: number = 0;
  protected highestBlock: number = 0;

  constructor(options: SynchronizerOptions) {
    super();
    this.node = options.node;
    this.interval = options.interval || 1000;
    this.syncLoop();
  }

  /**
   * Get the state of syncing
   */
  get status() {
    return { startingBlock: this.startingBlock, highestBlock: this.highestBlock };
  }

  get isSyncing(): boolean {
    throw new Error('Unimplemented');
  }

  /**
   * Set the starting block height and the highest block height
   * @param startingBlock
   * @param highestBlock
   */
  protected startSyncHook(startingBlock: number, highestBlock: number) {
    this.startingBlock = startingBlock;
    this.highestBlock = highestBlock;
    this.emit('start');
  }

  /**
   * Abstract function
   */
  protected async _sync(peer?: Peer): Promise<boolean> {
    throw new Error('Unimplemented');
  }

  /**
   * Fetch all blocks from current height up to highest found amongst peers
   * @param peer remote peer to sync with
   */
  async sync(peer?: Peer) {
    try {
      if (!this.isSyncing) {
        const beforeSync = this.node.blockchain.latestBlock.hash();
        const result = await this._sync(peer);
        const afterSync = this.node.blockchain.latestBlock.hash();
        if (!beforeSync.equals(afterSync)) {
          if (result) {
            logger.info('💫 Synchronized');
            this.emit('synchronized');
          } else {
            this.emit('failed');
          }
          await this.node.newBlock(this.node.blockchain.latestBlock);
        }
      }
    } catch (err) {
      logger.error('Synchronizer::sync, catch error:', err);
    }
  }

  async abort() {}

  announce(peer: Peer) {}

  /**
   * Start the Synchronizer
   */
  async syncLoop() {
    await this.node.blockchain.init();
    const timeout = setTimeout(() => {
      this.forceSync = true;
    }, this.interval * 30);
    while (!this.node.aborter.isAborted) {
      await this.sync();
      await this.node.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.interval)));
    }
    clearTimeout(timeout);
  }
}
