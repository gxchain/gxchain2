import Semaphore from 'semaphore-async-await';

import { OrderedQueue, AysncChannel } from '@gxchain2/utils';
import { constants } from '@gxchain2/common';
import { Peer, PeerRequestTimeoutError } from '@gxchain2/network';
import { Block, BlockHeader } from '@gxchain2/block';

import { Synchronizer, SynchronizerOptions } from './sync';

export interface FullSynchronizerOptions extends SynchronizerOptions {
  limit?: number;
  count?: number;
  timeoutBanTime?: number;
  errorBanTime?: number;
}

type Task = {
  start: number;
  count: number;
};

export class FullSynchronizer extends Synchronizer {
  private readonly downloadQueue: OrderedQueue<Task>;
  private readonly resultQueue: AysncChannel<Block[]>;
  private readonly idlePeerQueue: AysncChannel<Peer>;
  private readonly count: number;
  private readonly timeoutBanTime: number;
  private readonly errorBanTime: number;
  private readonly lock = new Semaphore(1);
  private abortFlag: boolean = false;
  private isSyncing: boolean = false;

  constructor(options: FullSynchronizerOptions) {
    super(options);
    this.count = options.count || 128;
    this.timeoutBanTime = options.timeoutBanTime || 300000;
    this.errorBanTime = options.errorBanTime || 60000;
    this.resultQueue = new AysncChannel<Block[]>({
      isAbort: () => this.abortFlag
    });
    this.idlePeerQueue = new AysncChannel<Peer>({
      hasNext: () => {
        const peer = this.node.peerpool.idle(constants.GXC2_ETHWIRE);
        if (!peer) {
          return false;
        }
        this.idlePeerQueue.array.push(peer);
        return true;
      },
      isAbort: () => this.abortFlag
    });
    this.downloadQueue = new OrderedQueue<Task, Block[]>({
      limit: options.limit || 16,
      processTask: this.download.bind(this)
    });
    this.downloadQueue.on('error', (queue, err) => this.emit('error', err));
    this.downloadQueue.on('result', (queue, data, result: any) => {
      this.resultQueue.push(result);
    });
    this.downloadQueue.on('over', (queue) => {
      this.resultQueue.abort();
    });

    this.node.peerpool.on('idle', (peer) => {
      if (this.isSyncing && peer.idle && peer.latestHeight(constants.GXC2_ETHWIRE)) {
        this.idlePeerQueue.push(peer);
      }
    });
  }

  private async download(task: Task) {
    let peer!: Peer;
    try {
      await this.lock.acquire();
      peer = (await this.idlePeerQueue.next())!;
      peer.idle = false;
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.lock.release();
    }
    try {
      const headers: BlockHeader[] = await peer.getBlockHeaders(task.start, task.count);
      /*
      const bodies: any[] = await peer.request(
        constants.GXC2_ETHWIRE,
        'GetBlockBodies',
        headers.map((h) => h.hash())
      );
      const blocks = bodies.map(([txsData, unclesData], i: number) => Block.fromValuesArray([headers[i].raw(), txsData, unclesData], { common: this.node.common }));
      */
      const blocks = headers.map((h) =>
        Block.fromBlockData(
          {
            header: h
          },
          { common: this.node.common }
        )
      );
      peer.idle = true;
      return blocks;
    } catch (err) {
      peer.idle = true;
      if (err instanceof PeerRequestTimeoutError) {
        this.node.peerpool.ban(peer, this.timeoutBanTime);
      } else {
        this.node.peerpool.ban(peer, this.errorBanTime);
      }
      throw err;
    }
  }

  async sync(): Promise<boolean> {
    if (this.isSyncing) {
      throw new Error('FullSynchronizer already sync');
    }
    this.isSyncing = true;
    this.idlePeerQueue.clear();
    await this.downloadQueue.reset();

    let bestHeight = 0;
    const results = await Promise.all([
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          const latestHeight = this.node.blockchain.latestHeight;
          bestHeight = latestHeight;
          let best: Peer | undefined;
          for (const peer of this.node.peerpool.peers) {
            const height = peer.latestHeight(constants.GXC2_ETHWIRE);
            if (height > bestHeight) {
              best = peer;
              bestHeight = height;
            }
          }
          if (best) {
            console.debug('get best height from:', best.peerId, 'best height:', bestHeight, 'local height:', latestHeight);
            let totalCount = bestHeight - latestHeight;
            let taskCount = 0;
            while (totalCount > 0) {
              this.downloadQueue.insert({
                start: taskCount++ * this.count + latestHeight + 1,
                count: totalCount > this.count ? this.count : totalCount
              });
              totalCount -= this.count;
            }
            await this.downloadQueue.start(taskCount);
            result = true;
          } else {
            this.resultQueue.abort();
          }
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      }),
      new Promise<boolean>(async (resolve) => {
        let result = false;
        try {
          for await (const result of this.resultQueue.generator()) {
            await this.node.processBlocks(result);
          }
          result = true;
        } catch (err) {
          this.emit('error', err);
        } finally {
          resolve(result);
        }
      })
    ]);

    this.isSyncing = false;
    return results.reduce((a, b) => a && b, true) && bestHeight === this.node.blockchain.latestHeight;
  }

  async abort() {
    this.idlePeerQueue.abort();
    await this.downloadQueue.abort();
    await super.abort();
  }

  async reset() {
    await this.downloadQueue.reset();
    await super.reset();
  }
}
