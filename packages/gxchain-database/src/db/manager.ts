import * as rlp from 'rlp';
import { BN } from 'ethereumjs-util';
import type { LevelUp } from 'levelup';

import { Transaction } from '@gxchain2/tx';
import { Block, BlockHeader, BlockBuffer, BlockHeaderBuffer, BlockBodyBuffer } from '@gxchain2/block';
import { Common } from '@gxchain2/common';
import { Receipt } from '@gxchain2/receipt';

import Cache from './cache';
import { DatabaseKey, DBOp, DBTarget, DBOpData } from './operation';

const level = require('level-mem');

/**
 * @hidden
 */
export interface GetOpts {
  keyEncoding?: string;
  valueEncoding?: string;
  cache?: string;
}

export type CacheMap = { [key: string]: Cache<Buffer> };

/**
 * Abstraction over a DB to facilitate storing/fetching blockchain-related
 * data, such as blocks and headers, indices, and the head block.
 * @hidden
 */
export class Database {
  private _cache: CacheMap;
  private _common: Common;
  private _db: LevelUp;

  constructor(db: LevelUp, common: Common) {
    this._db = db;
    this._common = common;
    this._cache = {
      td: new Cache({ max: 1024 }),
      header: new Cache({ max: 512 }),
      body: new Cache({ max: 256 }),
      numberToHash: new Cache({ max: 2048 }),
      hashToNumber: new Cache({ max: 2048 }),
      receipts: new Cache({ max: 256 }),
      txLookup: new Cache({ max: 512 })
    };
  }

  /**
   * Fetches iterator heads from the db.
   */
  async getHeads(): Promise<{ [key: string]: Buffer }> {
    const heads = await this.get(DBTarget.Heads);
    Object.keys(heads).forEach((key) => {
      heads[key] = Buffer.from(heads[key]);
    });
    return heads;
  }

  /**
   * Fetches header of the head block.
   */
  async getHeadHeader(): Promise<Buffer> {
    return this.get(DBTarget.HeadHeader);
  }

  /**
   * Fetches head block.
   */
  async getHeadBlock(): Promise<Buffer> {
    return this.get(DBTarget.HeadBlock);
  }

  /**
   * Fetches a block (header and body) given a block id,
   * which can be either its hash or its number.
   */
  async getBlock(blockId: Buffer | BN | number): Promise<Block> {
    if (typeof blockId === 'number' && Number.isInteger(blockId)) {
      blockId = new BN(blockId);
    }

    let number;
    let hash;
    if (Buffer.isBuffer(blockId)) {
      hash = blockId;
      number = await this.hashToNumber(blockId);
    } else if (BN.isBN(blockId)) {
      number = blockId;
      hash = await this.numberToHash(blockId);
    } else {
      throw new Error('Unknown blockId type');
    }

    const header: BlockHeaderBuffer = (await this.getHeader(hash, number)).raw();
    let body: BlockBodyBuffer = [[], []];
    try {
      body = await this.getBody(hash, number);
    } catch (error) {
      if (error.type !== 'NotFoundError') {
        throw error;
      }
    }
    const blockData = [header, ...body] as BlockBuffer;
    const opts = { common: this._common };
    return Block.fromValuesArray(blockData, opts);
  }

  /**
   * Fetches body of a block given its hash and number.
   */
  async getBody(blockHash: Buffer, blockNumber: BN): Promise<BlockBodyBuffer> {
    const body = await this.get(DBTarget.Body, { blockHash, blockNumber });
    return (rlp.decode(body) as any) as BlockBodyBuffer;
  }

  /**
   * Fetches header of a block given its hash and number.
   */
  async getHeader(blockHash: Buffer, blockNumber: BN) {
    const encodedHeader = await this.get(DBTarget.Header, { blockHash, blockNumber });
    const opts = { common: this._common };
    return BlockHeader.fromRLPSerializedHeader(encodedHeader, opts);
  }

  /**
   * Fetches total difficulty for a block given its hash and number.
   */
  async getTotalDifficulty(blockHash: Buffer, blockNumber: BN): Promise<BN> {
    const td = await this.get(DBTarget.TotalDifficulty, { blockHash, blockNumber });
    return new BN(rlp.decode(td));
  }

  /**
   * Performs a block hash to block number lookup.
   */
  async hashToNumber(blockHash: Buffer): Promise<BN> {
    const value = await this.get(DBTarget.HashToNumber, { blockHash });
    return new BN(value);
  }

  /**
   * Performs a block number to block hash lookup.
   */
  async numberToHash(blockNumber: BN): Promise<Buffer> {
    if (blockNumber.ltn(0)) {
      throw new level.errors.NotFoundError();
    }

    return this.get(DBTarget.NumberToHash, { blockNumber });
  }

  /**
   * Fetches a key from the db. If `opts.cache` is specified
   * it first tries to load from cache, and on cache miss will
   * try to put the fetched item on cache afterwards.
   */
  async get(dbOperationTarget: DBTarget, key?: DatabaseKey): Promise<any> {
    const dbGetOperation = DBOp.get(dbOperationTarget, key);

    const cacheString = dbGetOperation.cacheString;
    const dbKey = dbGetOperation.baseDBOp.key;
    const dbOpts = dbGetOperation.baseDBOp;

    if (cacheString) {
      if (!this._cache[cacheString]) {
        throw new Error(`Invalid cache: ${cacheString}`);
      }

      let value = this._cache[cacheString].get(dbKey);
      if (!value) {
        value = <Buffer>await this._db.get(dbKey, dbOpts);
        this._cache[cacheString].set(dbKey, value);
      }

      return value;
    }

    return this._db.get(dbKey, dbOpts);
  }

  /**
   * Performs a batch operation on db.
   */
  async batch(ops: DBOp[]) {
    const convertedOps: DBOpData[] = ops.map((op) => op.baseDBOp);
    // update the current cache for each operation
    ops.map((op) => op.updateCache(this._cache));

    return this._db.batch(convertedOps as any);
  }

  ////////////////////
  async getTransaction(txHash: Buffer): Promise<Transaction> {
    const blockHeightBuffer = await this.get(DBTarget.TxLookup, { txHash });
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      if (tx.hash().equals(txHash)) {
        tx.installProperties(block, i);
        return tx;
      }
    }
    throw new level.errors.NotFoundError();
  }

  async getReceipt(txHash: Buffer): Promise<Receipt> {
    const blockHeightBuffer = await this.get(DBTarget.TxLookup, { txHash });
    const blockHeihgt = new BN(blockHeightBuffer);
    const block = await this.getBlock(blockHeihgt);
    const rawArr = (rlp.decode(await this.get(DBTarget.Receipts, { blockHash: block.hash(), blockNumber: blockHeihgt })) as any) as Buffer[][];
    const cumulativeGasUsed = new BN(0);
    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      const raw = rawArr[i];
      const receipt = Receipt.fromValuesArray(raw);
      cumulativeGasUsed.iadd(new BN(receipt.gasUsed));
      if (tx.hash().equals(txHash)) {
        receipt.installProperties(block, tx, cumulativeGasUsed, i);
        return receipt;
      }
    }
    throw new level.errors.NotFoundError();
  }
  ////////////////////
}
