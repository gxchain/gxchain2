import { TypedTransaction, TxOptions, Transaction, AccessListEIP2930Transaction, AccessListEIP2930ValuesArray } from '@ethereumjs/tx';
import { BN, bufferToHex, bnToHex, intToHex, rlp } from 'ethereumjs-util';
import { BaseTrie as Trie } from 'merkle-patricia-tree';

export function txSize(tx: TypedTransaction) {
  const raw = tx.raw();
  let size = 0;
  for (const b of raw) {
    if (b instanceof Buffer) {
      size += b.length;
    }
  }
  return size;
}

export interface BlockLike {
  hash(): Buffer;
  readonly header: {
    number: BN;
  };
}

export function TxFromValuesArray(values: Buffer[], opts?: TxOptions) {
  return values.length === 6 || values.length === 9 ? Transaction.fromValuesArray(values, opts) : AccessListEIP2930Transaction.fromValuesArray(values as AccessListEIP2930ValuesArray, opts);
}

export class WrappedTransaction {
  public readonly transaction: TypedTransaction;

  constructor(transaction: TypedTransaction) {
    this.transaction = transaction;
  }

  extension: {
    blockHash?: Buffer;
    blockNumber?: BN;
    transactionIndex?: number;
    size?: number;
  } = {};

  get size() {
    if (this.extension.size) {
      return this.extension.size;
    }
    this.extension.size = txSize(this.transaction);
    return this.extension.size;
  }

  installProperties(block: BlockLike, transactionIndex: number): this {
    this.extension.blockHash = block.hash();
    this.extension.blockNumber = block.header.number;
    this.extension.transactionIndex = transactionIndex;
    return this;
  }

  toRPCJSON() {
    return {
      blockHash: this.extension.blockHash ? bufferToHex(this.extension.blockHash) : null,
      blockNumber: this.extension.blockNumber ? bnToHex(this.extension.blockNumber) : null,
      from: bufferToHex(this.transaction.getSenderAddress().toBuffer()),
      gas: bnToHex(this.transaction.gasLimit),
      gasPrice: bnToHex(this.transaction.gasPrice),
      hash: bufferToHex(this.transaction.hash()),
      input: bufferToHex(this.transaction.data),
      nonce: bnToHex(this.transaction.nonce),
      to: this.transaction.to !== undefined ? this.transaction.to.toString() : null,
      transactionIndex: this.extension.transactionIndex !== undefined ? intToHex(this.extension.transactionIndex) : null,
      value: bnToHex(this.transaction.value),
      v: this.transaction.v !== undefined ? bnToHex(this.transaction.v) : undefined,
      r: this.transaction.r !== undefined ? bnToHex(this.transaction.r) : undefined,
      s: this.transaction.s !== undefined ? bnToHex(this.transaction.s) : undefined
    };
  }
}

export const emptyTxTrie = Buffer.from('56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421', 'hex');

export async function calculateTransactionTrie(transactions: TypedTransaction[]): Promise<Buffer> {
  if (transactions.length === 0) {
    return emptyTxTrie;
  }
  const txTrie = new Trie();
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const key = rlp.encode(i);
    const value = tx.serialize();
    await txTrie.put(key, value);
  }
  return txTrie.root;
}

export function calculateIntrinsicGas(tx: TypedTransaction) {
  const gas = tx.toCreationAddress() ? new BN(53000) : new BN(21000);
  const nz = new BN(0);
  const z = new BN(0);
  for (const b of tx.data) {
    (b !== 0 ? nz : z).iaddn(1);
  }
  gas.iadd(nz.muln(16));
  gas.iadd(z.muln(4));
  return gas;
}

export * from '@ethereumjs/tx';
