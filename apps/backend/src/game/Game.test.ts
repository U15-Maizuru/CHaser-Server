import { describe, expect, it, vi } from 'vitest';
import { GameSession } from './Game.js';
import { StableLog } from '../log/StableLog.js';
import { BaseClient } from '../network/BaseClient.js';
import { Action, MapObject, Reason, Rote, Winner, type AroundData, type GameMap, type Method } from './types.js';

/** GetReady/EndSharp フェーズの応答を固定で返すテスト用クライアント。EndSharp の可否だけ差し替え可能。 */
class FakeClient extends BaseClient {
  endSharpOk = true;
  waitGetReadyCalls = 0;
  waitReturnMethodCalls = 0;
  waitEndSharpCalls = 0;

  constructor(private readonly method: Method) { super(); }

  async waitGetReady(): Promise<boolean> {
    this.waitGetReadyCalls++;
    return true;
  }

  async waitReturnMethod(_around: AroundData): Promise<Method> {
    this.waitReturnMethodCalls++;
    return this.method;
  }

  async waitEndSharp(_around: AroundData): Promise<boolean> {
    this.waitEndSharpCalls++;
    return this.endSharpOk;
  }
}

/** 5x5 の障害物なしマップ。COOL=(1,2), HOT=(3,2)。field は呼び出し側で上書きする。 */
function makeMap(overrides: Partial<GameMap> = {}): GameMap {
  const size = { x: 5, y: 5 };
  return {
    field: Array.from({ length: size.y }, () => Array(size.x).fill(MapObject.NOTHING)),
    turn: 10,
    name: 'test',
    size,
    teamFirstPoint: [{ x: 1, y: 2 }, { x: 3, y: 2 }],
    textureDirPath: '',
    ...overrides,
  };
}

describe('GameSession.run — 決着処理', () => {
  it('GetReadyフェーズ直後の判定で決着した場合、ログ・相手への通知・gameEndが行われる', async () => {
    const map = makeMap();
    map.field[2][2] = MapObject.BLOCK; // COOL が WALK(RIGHT) で衝突するマス

    const cool = new FakeClient({ team: 0, action: Action.WALK, rote: Rote.RIGHT });
    const hot  = new FakeClient({ team: 1, action: Action.LOOK, rote: Rote.UNKNOWN });
    const log  = new StableLog();
    const writeSpy = vi.spyOn(log, 'write');

    const session = new GameSession();
    const gameEndSpy = vi.fn();
    session.on('gameEnd', gameEndSpy);

    const result = await session.run([cool, hot], map, log);

    expect(result.status.winner).toBe(Winner.HOT);
    expect(result.status.reason).toBe(Reason.COLLISION);
    expect(gameEndSpy).toHaveBeenCalledTimes(1);
    expect(gameEndSpy).toHaveBeenCalledWith(result);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('[決着]'));
    // 相手 (HOT) には対局終了が通知される
    expect(hot.waitGetReadyCalls).toBe(1);
    expect(hot.waitReturnMethodCalls).toBe(1);
    // HOT 自身のターンは回ってこない (COOL のターン中に決着)
    expect(hot.waitEndSharpCalls).toBe(0);
  });

  it('EndSharpフェーズ後の判定 (通信断による決着) でも、ログ・相手への通知・gameEndが行われる', async () => {
    const map = makeMap(); // 障害物なし・安全な移動

    const cool = new FakeClient({ team: 0, action: Action.WALK, rote: Rote.RIGHT });
    const hot  = new FakeClient({ team: 1, action: Action.LOOK, rote: Rote.UNKNOWN });
    cool.endSharpOk = false; // EndSharp に失敗 → 切断扱い
    const log = new StableLog();
    const writeSpy = vi.spyOn(log, 'write');

    const session = new GameSession();
    const gameEndSpy = vi.fn();
    session.on('gameEnd', gameEndSpy);

    const result = await session.run([cool, hot], map, log);

    expect(result.status.winner).toBe(Winner.HOT);
    expect(result.status.reason).toBe(Reason.FOULED);
    expect(gameEndSpy).toHaveBeenCalledTimes(1);
    expect(gameEndSpy).toHaveBeenCalledWith(result);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('[決着]'));
    expect(hot.waitGetReadyCalls).toBe(1);
    expect(hot.waitReturnMethodCalls).toBe(1);
    // COOL は GetReady フェーズの判定は通過し、EndSharp まで進んでいる
    expect(cool.waitEndSharpCalls).toBe(1);
  });
});
