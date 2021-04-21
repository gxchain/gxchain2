import { Address, bufferToHex, BN } from 'ethereumjs-util';
import { keyFileName, keyStore } from './key';
import { Account } from 'web3-core';
import { Wallet, Accountinfo, urlcompare } from './accounts';
import { AccountCache } from './accountcache';
import { Transaction } from '@ethereumjs/tx';
import { FunctionalMap, createBufferFunctionalMap } from '@gxchain2/utils';
import { Accounts } from 'web3-eth-accounts';
import { KeystoreWallet } from './wallet';
import path from 'path';

const web3accounts = new Accounts();

export class KeyStore {
  storage: keyStore;
  cache: AccountCache;
  unlocked: FunctionalMap<Buffer, Account>;
  wallets: Wallet[];

  constructor(keydir: string, ks: keyStore) {
    this.storage = ks;
    this.unlocked = createBufferFunctionalMap<Account>();
    this.cache = new AccountCache(keydir);
    let accs = this.cache.accounts;
    this.wallets = [];
    for (let i = 0; i < accs.length; i++) {
      this.wallets.push(new KeystoreWallet(accs[i], this));
    }
  }

  getDecryptedKey(a: Accountinfo, auth: string) {
    const account = this.cache.find(a);
    const key = this.storage.getkey(a.address, a.url.Path, auth);
    return [account, key];
  }

  signHash(a: Accountinfo, hash: Buffer) {
    const unlockedKey = this.unlocked.get(a.address.toBuffer());
    if (!unlockedKey) {
      throw new Error('password or unlock');
    }
    return web3accounts.sign(hash.toString(), unlockedKey.privateKey);
  }

  signHashWithPassphrase(a: Accountinfo, passphrase: string, hash: Buffer) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return web3accounts.sign(hash.toString(), key.privateKeyb);
  }

  signTx(a: Accountinfo, tx: Transaction) {
    const unlockedKey = this.unlocked.get(a.address.toBuffer());
    if (!unlockedKey) {
      throw new Error('password or unlock');
    }
    return tx.sign(Buffer.from(unlockedKey.privateKey));
  }

  signTxWithPassphrase(a: Accountinfo, passphrase: string, tx: Transaction) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return tx.sign(Buffer.from(key.privateKey));
  }

  importKey(key: any, passphrase: string) {
    const addr = Address.fromString(key.address);
    const a: Accountinfo = { address: addr, url: { Scheme: 'keystore', Path: path.join(this.storage.joinPath(keyFileName(addr))) } };
    this.storage.storekey(a.url.Path, key, passphrase);
    this.cache.add(a);
    this.refreshwallets();
    return a;
  }

  update(a: Accountinfo, passphrase: string, newpassphrase: string) {
    const [account, key] = this.getDecryptedKey(a, passphrase);
    return this.storage.storekey(a.url.Path, key, newpassphrase);
  }

  newaccount(passphrase: string) {
    const key = web3accounts.create();
    const addr = Address.fromString(key.address);
    const account: Accountinfo = { address: addr, url: { Path: this.storage.joinPath(keyFileName(addr)), Scheme: 'keystore' } };
    this.storage.storekey(account.url.Path, key, passphrase);
    this.cache.add(account);
    this.refreshwallets();
    return account;
  }

  refreshwallets() {
    const accs = this.cache.accounts();
    const wallets: Wallet[] = [];
    for (const account of accs) {
      while (this.wallets.length > 0 && urlcompare(this.wallets[0].url(), account.url) < 0) {
        this.wallets = this.wallets.slice(1);
      }
      if (this.wallets.length == 0 || urlcompare(this.wallets[0].url(), account.url) > 0) {
        const wallet = new KeystoreWallet(account, this);
        wallets.push(wallet);
        continue;
      }
      if (this.wallets[0].accounts()[0] == account) {
        wallets.push(this.wallets[0]);
        this.wallets = this.wallets.slice(1);
        continue;
      }
    }

    this.wallets = wallets;
  }
}
