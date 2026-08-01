import { describe, expect, it, vi } from 'vitest';
import { GameSession } from './Game.js';
import { StableLog } from '../log/StableLog.js';
import { BaseClient } from '../network/BaseClient.js';
import { Action, MapObject, Reason, Rote, Winner, type AroundData, type GameMap, type Method, type ScanInfo } from './types.js';

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

/** 各フェーズでサーバーから渡された around データを記録するクライアント */
class RecordingClient extends BaseClient {
  readonly beforeData: number[][] = [];
  readonly afterData:  number[][] = [];

  constructor(private readonly method: Method) { super(); }

  async waitGetReady(): Promise<boolean> { return true; }

  async waitReturnMethod(around: AroundData): Promise<Method> {
    this.beforeData.push([...around.data]);
    return this.method;
  }

  async waitEndSharp(around: AroundData): Promise<boolean> {
    this.afterData.push([...around.data]);
    return true;
  }
}

describe('GameSession.run — LOOK/SEARCH の探索範囲', () => {
  // COOL=(1,2) の真上 (1,1) にだけ ITEM を置いた 5x5 マップ。
  // 自機中心の 3x3 では index 1、LOOK(UP) の範囲 (中心 (1,0)) では index 7 に現れる。
  function makeLookMap() {
    const map = makeMap({ turn: 1 });
    map.field[1][1] = MapObject.ITEM;
    return map;
  }

  it('GetReady フェーズの around は常に自機中心の 3x3 (method 確定前のため)', async () => {
    const cool = new RecordingClient({ team: 0, action: Action.LOOK, rote: Rote.UP });
    const hot  = new RecordingClient({ team: 1, action: Action.WALK, rote: Rote.RIGHT });

    await new GameSession().run([cool, hot], makeLookMap());

    // 自機中心 3x3 の index 1 = 真上 (1,1)
    expect(cool.beforeData[0][1]).toBe(MapObject.ITEM);
    // LOOK の範囲 (index 7) には現れない = 行動依存になっていない
    expect(cool.beforeData[0][7]).not.toBe(MapObject.ITEM);
  });

  it('EndSharp フェーズの around は LOOK の範囲になる (クライアントの look() の戻り値)', async () => {
    const cool = new RecordingClient({ team: 0, action: Action.LOOK, rote: Rote.UP });
    const hot  = new RecordingClient({ team: 1, action: Action.WALK, rote: Rote.RIGHT });

    await new GameSession().run([cool, hot], makeLookMap());

    // LOOK(UP) の中心は (1,0)、その 3x3 の index 7 が (1,1)
    expect(cool.afterData[0][7]).toBe(MapObject.ITEM);
  });

  it('LOOK/SEARCH では位置が変わらない', async () => {
    const cool = new RecordingClient({ team: 0, action: Action.SEARCH, rote: Rote.RIGHT });
    const hot  = new RecordingClient({ team: 1, action: Action.LOOK,   rote: Rote.LEFT });

    const result = await new GameSession().run([cool, hot], makeMap({ turn: 1 }));

    expect(result.state.teamPos[0]).toEqual({ x: 1, y: 2 });
    expect(result.state.teamPos[1]).toEqual({ x: 3, y: 2 });
  });

  it('stateUpdate に LOOK/SEARCH の探索範囲が載り、それ以外の行動では null', async () => {
    const cool = new RecordingClient({ team: 0, action: Action.SEARCH, rote: Rote.RIGHT });
    const hot  = new RecordingClient({ team: 1, action: Action.WALK,   rote: Rote.LEFT });

    const session = new GameSession();
    const scans: (ScanInfo | null | undefined)[] = [];
    session.on('stateUpdate', (_state, scan?: ScanInfo | null) => { scans.push(scan); });

    await session.run([cool, hot], makeMap({ turn: 1 }));

    // 初期状態 (scan なし) → COOL の SEARCH → HOT の WALK
    expect(scans[0] ?? null).toBeNull();

    const coolScan = scans[1];
    expect(coolScan).toBeTruthy();
    expect(coolScan!.team).toBe(0);
    expect(coolScan!.action).toBe(Action.SEARCH);
    expect(coolScan!.cells).toHaveLength(9);
    expect(coolScan!.cells[0]).toEqual({ x: 2, y: 2 }); // COOL=(1,2) の右隣

    expect(scans[2] ?? null).toBeNull(); // WALK では演出データを出さない
  });

  it('方向が不正な LOOK では探索範囲を出さない (縮退した範囲を描画側に渡さない)', async () => {
    const cool = new RecordingClient({ team: 0, action: Action.LOOK, rote: Rote.UNKNOWN });
    const hot  = new RecordingClient({ team: 1, action: Action.WALK, rote: Rote.LEFT });

    const session = new GameSession();
    const scans: (ScanInfo | null | undefined)[] = [];
    session.on('stateUpdate', (_state, scan?: ScanInfo | null) => { scans.push(scan); });

    await session.run([cool, hot], makeMap({ turn: 1 }));

    expect(scans.every(s => (s ?? null) === null)).toBe(true);
  });
});
