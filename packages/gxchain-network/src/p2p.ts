import Libp2pJS from 'libp2p';
import WebSockets from 'libp2p-websockets';
import MPLEX from 'libp2p-mplex';
import PeerId from 'peer-id';
import KadDHT from 'libp2p-kad-dht';
import TCP from 'libp2p-tcp';
import secio from 'libp2p-secio';
import Bootstrap from 'libp2p-bootstrap';

import { constants } from '@gxchain2/common';
import { INode } from '@gxchain2/interface';

import { Peer } from './peer';
import { Protocol, ETHProtocol } from './protocol';

let Libp2p: any = Libp2pJS;

function parseProtocol(name: string): Protocol {
  if (name === constants.GXC2_ETHWIRE) {
    return new ETHProtocol();
  }
  throw new Error(`Unkonw protocol: ${name}`);
}

export declare interface Libp2pNode {
  on(event: 'connected', listener: (peer: Peer) => void);
  on(event: 'error', listener: (peer: Peer) => void);
  once(event: 'connected', listener: (peer: Peer) => void);
  once(event: 'error', listener: (peer: Peer) => void);
}

export class Libp2pNode extends Libp2p {
  private readonly peers = new Map<string, Peer>();
  private readonly protocols: Protocol[];
  private readonly banned = new Map<string, number>();
  private readonly node: INode;
  private started: boolean = false;

  constructor(options: { node: INode; peerId: PeerId; bootnodes?: string[]; protocols: Set<string> }) {
    super({
      peerId: options.peerId,
      addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws']
      },
      modules: {
        transport: [TCP, WebSockets],
        streamMuxer: [MPLEX],
        connEncryption: [secio],
        // peerDiscovery: [Bootstrap],
        dht: KadDHT
      },
      config: {
        peerDiscovery: {
          autoDial: true
          /*
          bootstrap: {
            interval: 2000,
            enabled: true,
            list: options.bootnodes || []
          }
          */
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

    this.node = options.node;
    this.protocols = Array.from(options.protocols.values()).map((p) => parseProtocol(p));
  }

  getPeer(peerId: string) {
    return this.peers.get(peerId);
  }

  forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void) {
    this.peers.forEach(fn);
  }

  private createPeer(peerInfo: PeerId) {
    const peer = new Peer({ peerId: peerInfo.toB58String(), node: this });
    this.peers.set(peer.peerId, peer);
    return peer;
  }

  async init() {
    this.protocols.forEach((protocol) => {
      this.handle(protocol.protocolString, async ({ connection, stream }) => {
        try {
          const peerId: PeerId = connection.remotePeer;
          const id = peerId.toB58String();
          const peer = this.peers.get(id);
          if (peer) {
            await peer.acceptProtocol(stream, protocol.copy(), this.node.status);
            this.emit('connected', peer);
          }
        } catch (err) {
          this.emit('error', err);
        }
      });
    });
    super.on('peer:discovery', async (peerId: PeerId) => {
      try {
        const id = peerId.toB58String();
        if (this.peers.get(id) || this.isBanned(id)) {
          return;
        }
        const peer = this.createPeer(peerId);
        await Promise.all(this.protocols.map((protocol) => peer.installProtocol(this, peerId, protocol.copy(), this.node.status)));
        console.debug('Peer discovered:', peer.peerId);
        this.emit('connected', peer);
      } catch (err) {
        this.emit('error', err);
      }
    });
    this.connectionManager.on('peer:connect', (connect) => {
      try {
        const peer = this.createPeer(connect.remotePeer);
        console.debug('Peer connected:', peer.peerId);
      } catch (err) {
        this.emit('error', err);
      }
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
