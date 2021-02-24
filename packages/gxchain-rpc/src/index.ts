import express from 'express';
import expressws from 'express-ws';
import * as http from 'http';
import { EventEmitter } from 'events';

import { Node } from '@gxchain2/core';

import { JsonRPCMiddleware } from './jsonrpcmiddleware';
import { Controller } from './controller';

export class RpcServer extends EventEmitter {
  protected readonly port: number;
  protected readonly host: string;
  protected running: boolean = false;
  protected controller: Controller;
  constructor(port: number, host: string, node: Node) {
    super();
    this.port = port;
    this.host = host;
    this.controller = new Controller(node);
  }

  start() {
    return new Promise<boolean>((resolve) => {
      if (this.running) {
        this.emit('error', new Error('RPC and WS server already started!'));
        resolve(false);
        return;
      }
      try {
        this.running = true;
        const app = express();
        const server = http.createServer(app);
        expressws(app, server);
        const jsonmid = new JsonRPCMiddleware({ methods: this.controller as any });

        app.use(express.json({ type: '*/*' }));
        app.use(jsonmid.makeMiddleWare((err) => this.emit('error', err)));
        app.ws('/', (ws) => {
          jsonmid.wrapWs(ws, (err) => this.emit('error', err));
          ws.on('error', (err) => this.emit('error', err));
          ws.on('close', () => {});
        });

        server.once('error', (err) => {
          server.removeAllListeners();
          this.emit('error', err);
          resolve(false);
        });
        server.listen(this.port, this.host, () => {
          console.log(`rpc server listening on ${this.host.indexOf('.') === -1 ? '[' + this.host + ']' : this.host}:${this.port}`);
          server.removeAllListeners('error');
          server.on('error', (err) => {
            this.emit('error', err);
          });
          resolve(true);
        });
      } catch (err) {
        this.running = false;
        this.emit('error', err);
        resolve(false);
      }
    });
  }
}
