import { EventEmitter } from 'node:events';
import type { AroundData, Method } from '../game/types.js';

export abstract class BaseClient extends EventEmitter {
  name = '';
  ip = '';
  isDisconnected = false;

  abstract waitGetReady(): Promise<boolean>;
  abstract waitReturnMethod(around: AroundData): Promise<Method>;
  abstract waitEndSharp(around: AroundData): Promise<boolean>;

  startup(): void {}

  /**
   * 対戦の強制中断用。GameSession はこれを見て次のチェックポイントでループを終える。
   * 入力待ちの Promise で止まりうるクライアント (TCP/手動操作) は、待機中の Promise も
   * 解決させて run() を先に進めるために override すること (既定は isDisconnected を立てるだけ)。
   */
  forceDisconnect(): void {
    this.isDisconnected = true;
  }
}
