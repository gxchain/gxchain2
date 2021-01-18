import { Node } from '@gxchain2/core';
import { Block, JsonBlock, BlockHeader, JsonHeader } from '@gxchain2/block';
import { Account, Address, bufferToHex } from 'ethereumjs-util';
//import { Transaction } from '@gxchain2/tx';

import * as helper from './helper';
import { hexStringToBuffer } from '../../gxchain-core/node_modules/@gxchain2/utils/dist';

export class Controller {
  node: Node;
  constructor(node: Node) {
    this.node = node;
  }
  hexStringToBuffer = (hex: string): Buffer => {
    return hex.indexOf('0x') === 0 ? Buffer.from(hex.substr(2), 'hex') : Buffer.from(hex, 'hex');
  };

  private async getBlockByTag(tag: string): Promise<Block> {
    let block!: Block;
    if (tag === 'earliest') {
      block = await this.node.blockchain.getBlock(0);
    } else if (tag === 'latest') {
      block = this.node.blockchain.latestBlock;
    } else if (tag === 'pending') {
      helper.throwRpcErr('Unsupport pending block');
    } else if (Number.isInteger(Number(tag))) {
      block = await this.node.blockchain.getBlock(Number(tag));
    } else {
      helper.throwRpcErr('Invalid tag value');
    }
    return block;
  }

  //web3_clientVersion
  //aysnc web_sha3()
  //aysnc eth_net_version()
  //aysnc eth_net_listenging()
  //aysnc eth_netpeer_Count()
  //aysnc eth_protocolVersion()
  //aysnc eth_syncing()
  async eth_coinbase(): Promise<string> {
    return await '0x0000000000000000000000000000000000000000';
  }

  async eth_blockNumber(): Promise<Number> {
    let blockNumber = await Number(this.node.blockchain.latestBlock.header.number);
    return blockNumber;
  }

  async eth_getStorageAt([address, key, tag]: [string, string, string]): Promise<any> {
    const blockHeader = (await this.getBlockByTag(tag)).header;
    const stateManager = this.node.stateManager.copy();
    await stateManager.setStateRoot(blockHeader.stateRoot);
    return bufferToHex(await stateManager.getContractStorage(Address.fromString(address), hexStringToBuffer(key)));
  }

  async eth_getTransactionCount([address]: [string]): Promise<string> {
    let nonce = Buffer.from((await this.node.stateManager.getAccount(Address.fromString(address))).nonce);
    return '0x' + nonce.toString('hex');
  }
  //eth_getBlockTransactionCountByHash
  //eth_getBlockTransactionCountByNumber
  //eth_getUncleCountByBlockHash
  //eth_getUncleCountByBlockNumber
  //eth_getCode
  //eth_sign
  //eth_signTransaction
  //eth_sendTransaction
  //eth_sendRawTransaction
  //eth_call
  //eth_estimateGas
  async eth_getBlockByHash([hash, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    return (await this.node.db.getBlock(this.hexStringToBuffer(hash))).toJSON();
  }

  async eth_getBlockByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonBlock> {
    const block = await this.getBlockByTag(tag);
    return block.toJSON();
  }

  async eth_getBlockHeaderByNumber([tag, fullTransactions]: [string, boolean]): Promise<JsonHeader> {
    const blockHeader = (await this.getBlockByTag(tag)).header;
    return blockHeader.toJSON();
  }

  async eth_getTransactionByHash([hash]: [string]): Promise<any> {
    return (await this.node.db.getTransaction(this.hexStringToBuffer(hash))).toRPCJSON();
  }

  async eth_getTransactionByBlockHashAndIndex([hash, index]: [string, number]): Promise<any> {
    return (await this.node.db.getBlock(this.hexStringToBuffer(hash))).transactions[index].toRPCJSON();
  }

  async eth_getTransactionByBlockNumberAndIndex([number, index]: [number, number]): Promise<any> {
    return (await this.node.db.getBlock(number)).transactions[index].toRPCJSON();
  }

  async eth_getTransactionReceipt([hash]: [string]): Promise<any> {
    return (await this.node.db.getReceipt(this.hexStringToBuffer(hash))).toRPCJSON;
  }
  //eth_getUncleByBlockHashAndIndex
  //eth_getUncleByBlockNumberAndIndex
  //eth_compileSolidity
  //eth_compileLLL
  //eth_compileSerpent

  //eth_newFilter
  //eth_newBlockFilter
  //eth_newPendingTransactionFilter
  //eth_uninstallFilter
  //eth_getFilterChanges
  //eth_getFilterLogs
  //eth_getLogs

  //eth_getWork
  //eth_submitWork
  //eth_submitHashrate

  //db_putString
  //db_getString
  //db_putHex
  //db_getHex
  //shh_version
  //shh_post
  //shh_newIdentity
  //shh_hasIdentity
  //shh_newGroup(?)
  //shh_addToGroup
  //shh_newFilter
  //shh_uninstallFilter
  //shh_getFilterChanges
  //shh_getMessages

  async eth_getAccount([address]: [string]): Promise<any> {
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      nonce: account.nonce,
      balance: account.balance,
      stateRoot: account.stateRoot,
      codeHash: account.codeHash
    };
  }

  async eth_getBalance([address]: [string]): Promise<any> {
    let account = await this.node.stateManager.getAccount(Address.fromString(address));
    return {
      balance: account.balance
    };
  }
}
