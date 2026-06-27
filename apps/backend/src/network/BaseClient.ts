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
}
