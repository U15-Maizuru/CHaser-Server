import { BaseClient } from '../network/BaseClient.js';
import { Action, type AroundData, MapObject, type Method, Rote, Team } from '../game/types.js';

// getAroundData (GameLogic.ts) の並び: 0=NW,1=N,2=NE,3=W,4=自分,5=E,6=SW,7=S,8=SE
const DIRS = [
  { rote: Rote.UP,    idx: 1 },
  { rote: Rote.DOWN,  idx: 7 },
  { rote: Rote.RIGHT, idx: 5 },
  { rote: Rote.LEFT,  idx: 3 },
] as const;

export class ComClient extends BaseClient {
  private readonly team: Team;

  constructor(slot: 0 | 1) {
    super();
    this.team = slot === 0 ? Team.COOL : Team.HOT;
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

  async waitReturnMethod(around: AroundData): Promise<Method> {
    const walkable = DIRS.filter(d => around.data[d.idx] !== MapObject.BLOCK);
    const toItem   = walkable.find(d => around.data[d.idx] === MapObject.ITEM);
    const choice    = toItem ?? walkable[Math.floor(Math.random() * walkable.length)];

    return { team: this.team, action: Action.WALK, rote: choice?.rote ?? Rote.UP };
  }

  async waitEndSharp(_around: AroundData): Promise<boolean> {
    return true;
  }
}
