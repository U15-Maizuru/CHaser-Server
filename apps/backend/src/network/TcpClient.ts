import net from 'node:net';
import { aroundDataToString, methodFromString } from '../game/GameSystem.js';
import { Action, type AroundData, type Method, Rote, Team } from '../game/types.js';
import { BaseClient } from './BaseClient.js';
import { sanitizeName } from '../playerName.js';

const IGNORE_INVALID = 10;

const UNKNOWN_METHOD: Method = { team: Team.UNKNOWN, action: Action.UNKNOWN, rote: Rote.UNKNOWN };

export class TcpClient extends BaseClient {
  private server: net.Server;
  private socket: net.Socket | null = null;
  private rxBuf = '';
  private pendingRead: ((line: string | null) => void) | null = null;
  private timeout: number;

  constructor(timeout = 10_000) {
    super();
    this.timeout = timeout;
    this.server = net.createServer();
  }

  /** 実行中でも変更できるように — 待機中の readLine() には反映されないが、次回以降のタイムアウトから有効になる。 */
  updateTimeout(ms: number): void {
    this.timeout = ms;
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  /** Resolves once a client connects and sends its player name. */
  waitForClient(): Promise<void> {
    return new Promise((resolve) => {
      this.server.once('connection', (socket) => {
        this.server.close();
        this.socket = socket;
        this.ip = socket.remoteAddress ?? '';
        this.isDisconnected = false;

        socket.on('close', () => this.onDisconnect());
        socket.on('error', () => this.onDisconnect());
        this.emit('connected');

        // First data arriving on the socket is the player name.
        socket.once('data', (data) => {
          const str = data.toString('utf8');
          const nlIdx = str.indexOf('\n');
          if (nlIdx !== -1) {
            this.name = sanitizeName(str.slice(0, nlIdx));
            if (nlIdx + 1 < str.length) this.rxBuf += str.slice(nlIdx + 1);
          } else {
            this.name = sanitizeName(str);
          }
          socket.on('data', (d) => this.onData(d));
          this.emit('ready');
          resolve();
        });
      });
    });
  }

  close(): void {
    this.socket?.destroy();
    if (this.server.listening) this.server.close();
  }

  forceDisconnect(): void {
    this.close();
  }

  private onData(data: Buffer): void {
    this.rxBuf += data.toString('utf8');
    this.tryResolve();
  }

  private tryResolve(): void {
    if (!this.pendingRead) return;
    const nlIdx = this.rxBuf.indexOf('\n');
    if (nlIdx === -1) return;
    const line = this.rxBuf.slice(0, nlIdx + 1);
    this.rxBuf = this.rxBuf.slice(nlIdx + 1);
    const resolve = this.pendingRead;
    this.pendingRead = null;
    resolve(line);
  }

  private onDisconnect(): void {
    this.isDisconnected = true;
    if (this.pendingRead) {
      const resolve = this.pendingRead;
      this.pendingRead = null;
      resolve(null);
    }
    this.emit('disconnected');
  }

  private readLine(): Promise<string | null> {
    const nlIdx = this.rxBuf.indexOf('\n');
    if (nlIdx !== -1) {
      const line = this.rxBuf.slice(0, nlIdx + 1);
      this.rxBuf = this.rxBuf.slice(nlIdx + 1);
      return Promise.resolve(line);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRead = null;
        this.isDisconnected = true;
        resolve(null);
      }, this.timeout);

      this.pendingRead = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  private async waitResponse(): Promise<string | null> {
    let ignore = 0;
    while (ignore < IGNORE_INVALID) {
      const line = await this.readLine();
      if (line === null) {
        this.isDisconnected = true;
        return null;
      }
      if (line === '\n' || line === '\r\n' || line.trim() === '') {
        ignore++;
        continue;
      }
      if (!line.endsWith('\n')) {
        this.isDisconnected = true;
        return null;
      }
      return line;
    }
    this.isDisconnected = true;
    return null;
  }

  async waitGetReady(): Promise<boolean> {
    if (this.isDisconnected || !this.socket) return false;
    this.socket.write('@\r\n');
    const res = await this.waitResponse();
    return res === 'gr\r\n';
  }

  async waitReturnMethod(around: AroundData): Promise<Method> {
    if (this.isDisconnected || !this.socket) return { ...UNKNOWN_METHOD };
    this.socket.write(aroundDataToString(around) + '\r\n');
    const res = await this.waitResponse();
    if (!res) return { ...UNKNOWN_METHOD };
    return { ...methodFromString(res.trim()), team: Team.UNKNOWN };
  }

  async waitEndSharp(around: AroundData): Promise<boolean> {
    if (this.isDisconnected || !this.socket) return false;
    this.socket.write(aroundDataToString(around) + '\r\n');
    const res = await this.waitResponse();
    return res === '#\r\n';
  }
}
