import { BN, bnToUnpaddedBuffer, bufferToInt, intToBuffer, rlp } from 'ethereumjs-util';
import { StakingAccount } from '../../../stateManager';

export interface SnapMessage {
  code?: number;
  raw(): any;
  serialize(): Buffer;
  validateBasic(): void;
}

export class GetAccountRange implements SnapMessage {
  readonly reqID: number;
  readonly rootHash: Buffer;
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  constructor(reqID: number, rootHash: Buffer, startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.reqID = reqID;
    this.rootHash = rootHash;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 0;

  static fromValuesArray(values: Buffer[]) {
    if (values.length !== 5) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, rootHash, startHash, limitHash, responseLimitBuffer] = values;
    return new GetAccountRange(bufferToInt(reqIDBuffer), rootHash, startHash, limitHash, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [...intToBuffer(this.reqID), this.rootHash, this.startHash, this.limitHash, ...intToBuffer(this.responseLimit)];
  }

  serialize() {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class AccountRange implements SnapMessage {
  readonly reqID: number;
  readonly accountData: Buffer[][];
  readonly proofs: Buffer[][];

  constructor(reqID: number, accountData: Buffer[][], proofs: Buffer[][]) {
    this.reqID = reqID;
    this.accountData = accountData;
    this.proofs = proofs;
    this.validateBasic();
  }

  static readonly code = 1;

  static fromValuesArray(values: (Buffer | Buffer[][])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, accountData, proofs] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(accountData) || !Array.isArray(proofs)) {
      throw new Error('invalid values');
    }
    return new AccountRange(bufferToInt(reqIDBuffer), accountData, proofs);
  }

  raw() {
    return [intToBuffer(this.reqID), [...this.accountData], [...this.proofs]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetStorageRange implements SnapMessage {
  readonly reqID: number;
  readonly rootHash: Buffer;
  readonly accountHashes: Buffer[];
  readonly startHash: Buffer;
  readonly limitHash: Buffer;
  readonly responseLimit: number;

  constructor(reqID: number, rootHash: Buffer, accountHashes: Buffer[], startHash: Buffer, limitHash: Buffer, responseLimit: number) {
    this.reqID = reqID;
    this.rootHash = rootHash;
    this.accountHashes = accountHashes;
    this.startHash = startHash;
    this.limitHash = limitHash;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 2;

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 6) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, rootHash, accountHashes, startHash, limitHash, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !(rootHash instanceof Buffer) || !Array.isArray(accountHashes) || !(startHash instanceof Buffer) || !(limitHash instanceof Buffer) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetStorageRange(bufferToInt(reqIDBuffer), rootHash, accountHashes, startHash, limitHash, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.rootHash, [...this.accountHashes], this.startHash, this.limitHash, intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class StorageRange implements SnapMessage {
  readonly reqID: number;
  readonly storage: Buffer[][][] = [];
  readonly proof: Buffer[][];
  static readonly code = 3;

  constructor(reqID: number, storage: Buffer[][][], proof: Buffer[][]) {
    this.reqID = reqID;
    this.storage = storage;
    this.proof = proof;
    this.validateBasic();
  }

  static fromValuesArray(values: (Buffer | Buffer[][] | Buffer[][][])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, storage, proof] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(storage) || !Array.isArray(proof)) {
      throw new Error('invalid values');
    }
    return new StorageRange(bufferToInt(reqIDBuffer), storage as Buffer[][][], proof as Buffer[][]);
  }

  raw() {
    return [intToBuffer(this.reqID), [...this.storage], [...this.proof]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetByteCode implements SnapMessage {
  readonly reqID: number;
  readonly hashes: Buffer[];
  readonly responseLimit: number;

  constructor(reqID: number, hashes: Buffer[], responseLimit: number) {
    this.reqID = reqID;
    this.hashes = hashes;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 4;

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 3) {
      throw new Error('invalid values');
    }
    const [reqIDBuffer, hashes, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(hashes) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetByteCode(bufferToInt(reqIDBuffer), hashes, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), [...this.hashes], intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }
  validateBasic(): void {}
}

export class ByteCode implements SnapMessage {
  readonly reqID: number;
  readonly codesHashes: Buffer[];

  constructor(reqID: number, codeHashes: Buffer[]) {
    this.reqID = reqID;
    this.codesHashes = codeHashes;
    this.validateBasic();
  }

  static readonly code = 5;
  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, codeHashes] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(codeHashes)) {
      throw new Error('invalid values');
    }
    return new ByteCode(bufferToInt(reqIDBuffer), codeHashes);
  }

  raw() {
    return [intToBuffer(this.reqID), [...this.codesHashes]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class GetTrieNode implements SnapMessage {
  readonly reqID: number;
  readonly rootHash: Buffer;
  readonly paths: Buffer[][];
  readonly responseLimit: number;

  constructor(reqID: number, rootHash: Buffer, paths: Buffer[][], responseLimit: number) {
    this.reqID = reqID;
    this.rootHash = rootHash;
    this.paths = paths;
    this.responseLimit = responseLimit;
    this.validateBasic();
  }

  static readonly code = 6;

  static fromValuesArray(values: (Buffer | Buffer[][])[]) {
    if (values.length !== 4) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, rootHash, paths, responseLimitBuffer] = values;
    if (!(reqIDBuffer instanceof Buffer) || !(rootHash instanceof Buffer) || !Array.isArray(paths) || !(responseLimitBuffer instanceof Buffer)) {
      throw new Error('invalid values');
    }
    return new GetTrieNode(bufferToInt(reqIDBuffer), rootHash, paths, bufferToInt(responseLimitBuffer));
  }

  raw() {
    return [intToBuffer(this.reqID), this.rootHash, [...this.paths], intToBuffer(this.responseLimit)];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}

export class TrieNode implements SnapMessage {
  readonly reqID: number;
  readonly nodes: Buffer[];

  constructor(reqID: number, nodes: Buffer[]) {
    this.reqID = reqID;
    this.nodes = nodes;
    this.validateBasic();
  }

  static readonly code = 7;

  static fromValuesArray(values: (Buffer | Buffer[])[]) {
    if (values.length !== 2) {
      throw new Error('invalid values');
    }

    const [reqIDBuffer, nodes] = values;
    if (!(reqIDBuffer instanceof Buffer) || !Array.isArray(nodes)) {
      throw new Error('invalid values');
    }
    return new TrieNode(bufferToInt(reqIDBuffer), nodes);
  }

  raw() {
    return [intToBuffer(this.reqID), [...this.nodes]];
  }

  serialize(): Buffer {
    return rlp.encode(this.raw());
  }

  validateBasic(): void {}
}
