import fs from 'fs';
import net from 'net';
import levelup from 'levelup';
import PeerId from 'peer-id';
import { Peer } from '../src/peer';
import { NetworkManager } from '../src/index';
import { Protocol, ProtocolHandler } from '../src/types';
const memdown = require('memdown');

const path = './test/simpleNodeTest.txt';
// const defaultUdpPort = 9810;
// const defaultTcpPort = 4191;
// const ip = '192.168.0.50';
class SayHi implements Protocol {
  protocolString: string;
  beforeMakeHandler: (peer: Peer) => boolean | Promise<boolean>;
  makeHandler: (peer: Peer) => ProtocolHandler;
  constructor() {
    this.protocolString = 'SayHi';
    this.beforeMakeHandler = () => {
      return true;
    };
    this.makeHandler = (peer: Peer) => {
      console.log('makeHandler', peer.peerId);
      return new SayHiHandler(peer);
    };
  }
}

class SayHiHandler implements ProtocolHandler {
  peer: Peer;
  task: NodeJS.Timeout[] = [];
  constructor(peer: Peer) {
    this.peer = peer;
    this.task.push(
      setTimeout(() => {
        this.peer.send('SayHi', Buffer.from('hello'));
      }, 2000)
    );
  }
  async handshake() {
    return true;
  }
  async handle(data: Buffer) {
    const str = data.toString();
    if (str == 'hello') {
      // console.log('received hello message from peer: ', this.peer.peerId);
      this.peer.send('SayHi', Buffer.from('hi'));
    } else {
      // console.log('received hi message from peer: ', this.peer.peerId);
      this.task.push(
        setTimeout(() => {
          this.peer.send('SayHi', Buffer.from('hello'));
        }, 5000)
      );
    }
  }
  abort() {
    for (const task of this.task) {
      clearTimeout(task);
    }
    console.log('abort');
  }
}

export async function autoStartNodes(opts: { ip: string; udpPort: number; tcpPort: number; count?: number; bootEnr?: string }) {
  const nodes: Promise<NetworkManager>[] = [];
  const count = opts.count ? opts.count : 10;
  const ip = opts.ip;
  let udpPort = opts.udpPort;
  let tcpPort = opts.tcpPort;
  let bootEnr = opts.bootEnr;
  let boot: NetworkManager | undefined;

  if (!bootEnr) {
    let b = await bootNode(ip, udpPort, tcpPort);
    boot = b.bootNode;
    bootEnr = b.bootEnr;
  }
  for (let i = 1; i <= count; i++) {
    const ports = await getPorts(udpPort + 1, tcpPort + 1);
    nodes.push(createNode({ ip, tcpPort: ports.tcp, udpPort: ports.udp, bootNodes: [bootEnr] }));
    udpPort = ports.udp;
    tcpPort = ports.tcp;
    console.log('node', i, 'created');
  }
  console.log('auto start nodes success');
  return boot ? [boot, ...(await Promise.all(nodes))] : await Promise.all(nodes);
}

export async function bootNode(ip: string, udpPort: number, tcpPort: number) {
  let { udp, tcp } = await getPorts(udpPort, tcpPort);
  const bootNode = await createNode({ ip, tcpPort: tcp, udpPort: udp });
  const bootEnr = await bootNode.localEnr.encodeTxt();
  // fs.writeFile(path, bootEnr, (err) => {
  //   if (err) throw err;
  //   console.log('boot node enr:', bootEnr);
  // });
  return { bootNode, bootEnr };
}

export async function startNode(ip, tcpPort, udpPort, enr) {
  await createNode({ ip, tcpPort, udpPort, bootNodes: [enr] });
}

async function createNode(opts: { ip: string; tcpPort: number; udpPort: number; bootNodes?: string[] }) {
  const db = levelup(memdown());
  const node = new NetworkManager({
    peerId: await PeerId.create({ keyType: 'secp256k1' }),
    enable: true,
    protocols: [new SayHi()],
    nodedb: db,
    bootnodes: opts.bootNodes ? opts.bootNodes : [],
    tcpPort: opts.tcpPort,
    udpPort: opts.udpPort,
    nat: opts.ip
  });
  await node.init();
  await node.start();
  console.log('create node success', 'ip:', opts.ip, 'tcpPort:', opts.tcpPort, 'udpPort:', opts.udpPort);
  return node;
}

async function getPorts(udp: number, tcp: number) {
  while (await portIsOccupied(udp)) {
    udp++;
  }

  while (await portIsOccupied(tcp)) {
    tcp++;
  }
  return { udp, tcp };
}

function portIsOccupied(port: number) {
  return new Promise((resolve) => {
    var server = net.createServer().listen(port);
    server.on('listening', function () {
      server.close();
      console.log('The port【' + port + '】 is available.');
      resolve(false);
    });
    server.on('error', function (err) {
      if ((err as any).code === 'EADDRINUSE') {
        console.log('The port【' + port + '】 is occupied, please change other port.');
        resolve(true);
      }
    });
  });
}
