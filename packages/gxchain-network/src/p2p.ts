const Libp2p = require('libp2p');
import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';

import { constants } from '@gxchain2/common';

import { Peer } from './peer';
import { Protocol, ETHProtocol } from './protocol';

// TODO: impl this.
function parseProtocol(name: string) {
  return new ETHProtocol();
}

export class Libp2pNode extends Libp2p {
  readonly peerId: PeerId;
  private readonly peers = new Map<string, Peer>();
  private readonly protocols: Protocol[];
  private readonly banned = new Map<string, number>();
  private started: boolean = false;

  constructor(peerId: PeerId, options: any) {
    super({
      peerInfo: peerId,
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/40404', '/ip4/0.0.0.0/tcp/40405/ws']
      },
      modules: {
        transport: [TCP, WebSockets],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        peerDiscovery: [Bootstrap],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: options.bootnodes ?? []
          }
        },
        dht: {
          kBucketSize: 20
        },
        EXPERIMENTAL: {
          dht: false,
          pubsub: false
        }
      }
    });

    this.peerId = peerId;
    this.protocols = Array.from(options.protocols as Set<string>).map((p) => parseProtocol(p));
  }

  getPeer(peerId: string) {
    return this.peers.get(peerId);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peers.forEach(fn);
  }

  getPeerInfo(connection: any) {
    return new Promise<any>((resolve, reject) => {
      connection.getPeerInfo((err: any, info: any) => {
        if (err) {
          return reject(err);
        }
        resolve(info);
      });
    });
  }

  createPeer(peerInfo: PeerId) {
    const peer = new Peer(peerInfo.toB58String());
    this.peers.set(peer.peerId, peer);
    return peer;
  }

  async init() {
    this.protocols.forEach((protocol) => {
      this.handle(protocol.protocolString, async ({ connection, stream }) => {
        try {
          const peerInfo = await this.getPeerInfo(connection);
          const id = peerInfo.id.toB58String();
          const peer = this.peers.get(id);
          if (peer) {
            // TODO: impl this.
            await peer.acceptProtocol(stream, protocol.copy(), undefined);
            this.emit('connected', peer);
          }
        } catch (err) {
          this.emit('error', err);
        }
      });
    });
    this.on('peer:discovery', async (peerInfo) => {
      try {
        const id = peerInfo.id.toB58String();
        if (this.peers.get(id) || this.isBanned(id)) {
          return;
        }
        const peer = this.createPeer(peerInfo.id);
        this.protocols.forEach((protocol) => {
          // TODO: fix this.
          peer.installProtocol(this, peerInfo.id, protocol.copy(), undefined);
        });
        console.debug(`Peer discovered: ${peer}`);
        this.emit('connected', peer);
      } catch (err) {
        this.emit('error', err);
      }
    });
    this.on('peer:connect', (peerInfo) => {
      try {
        const peer = this.createPeer(peerInfo);
        console.debug(`Peer connected: ${peer}`);
      } catch (err) {
        this.emit('error', err);
      }
    });
    this.on('error', (err) => {
      this.emit('error', err);
    });

    // start libp2p
    await this.start();
    console.log('Libp2p has started', this.peerId!.toB58String());
    this.multiaddrs.forEach((ma) => {
      console.log(ma.toString() + '/p2p/' + this.peerId!.toB58String());
    });

    this.started = true;
  }

  ban(peerId: string, maxAge = 60000): boolean {
    if (!this.started) {
      return false;
    }
    this.banned.set(peerId, Date.now() + maxAge);
    return true;
  }

  isBanned(peerId: string): boolean {
    const expireTime = this.banned.get(peerId);
    if (expireTime && expireTime > Date.now()) {
      return true;
    }
    this.banned.delete(peerId);
    return false;
  }

  async abort() {
    if (this.started) {
      for (const [peerId, peer] of this.peers) {
        peer.abort();
      }
      await this.stop();
      this.started = false;
    }
  }
}
