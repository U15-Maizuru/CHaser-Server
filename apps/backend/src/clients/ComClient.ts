import { BaseClient } from '../network/BaseClient.js';
import { Action, type AroundData, type Method, Rote, Team } from '../game/types.js';

export class ComClient extends BaseClient {
  constructor() {
    super();
    this.name = 'CPU';
    this.ip = 'ローカル';
  }

  startup(): void {
    this.emit('connected');
    this.emit('ready');
  }

  async waitGetReady(): Promise<boolean> {
    return true;
  }

  async waitReturnMethod(_around: AroundData): Promise<Method> {
    return { team: Team.UNKNOWN, action: Action.SEARCH, rote: Rote.UP };
  }

  async waitEndSharp(_around: AroundData): Promise<boolean> {
    return true;
  }
}
