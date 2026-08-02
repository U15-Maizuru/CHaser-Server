import { describe, expect, it } from 'vitest';
import { createRandomMap } from './GameSystem.js';
import { applyMethod, calculateBonusBreakdown, countItems, GameState, getAroundData, getScanCells, judgeGame, scanInfoFrom } from './GameLogic.js';
import { Action, ConnectingStatus, GameStatus, MapObject, Method, Reason, Rote, Team, Winner } from './types.js';

function makeState(overrides: Partial<GameState> = {}): GameState {
  const map = createRandomMap();
  return {
    map,
    teamPos: [{ ...map.teamFirstPoint[0] }, { ...map.teamFirstPoint[1] }],
    teamScore: [0, 0],
    turnCount: 100,
    leaveItems: countItems(map),
    isDisconnected: [false, false],
    ...overrides,
  };
}

/** 障害物・アイテムのない盤面。探索範囲のテストで「置いた1マス」だけを見分けるために使う。 */
function makeEmptyState(coolPos: { x: number; y: number }): GameState {
  const map = createRandomMap();
  const field = map.field.map(row => row.map(() => MapObject.NOTHING));
  return {
    map: { ...map, field },
    teamPos: [{ ...coolPos }, { x: map.size.x - 2, y: map.size.y - 2 }],
    teamScore: [0, 0],
    turnCount: 100,
    leaveItems: 0,
    isDisconnected: [false, false],
  };
}

describe('judgeGame', () => {
  it('ターン残あり・異常なし → CONTINUE', () => {
    const state = makeState();
    const result = judgeGame(state, 0);
    expect(result.winner).toBe(Winner.CONTINUE);
  });

  it('ターン0 → アイテム判定', () => {
    const state = makeState({ turnCount: 0, teamScore: [5, 3] });
    const result = judgeGame(state, 0);
    expect(result.winner).toBe(Winner.COOL);
    expect(result.reason).toBe(Reason.SCORE);
  });

  it('ターン0 同点 → DRAW', () => {
    const state = makeState({ turnCount: 0, teamScore: [4, 4] });
    const result = judgeGame(state, 0);
    expect(result.winner).toBe(Winner.DRAW);
  });

  it('切断 → FOULED', () => {
    const state = makeState({ isDisconnected: [true, false] });
    const result = judgeGame(state, 1);
    expect(result.winner).toBe(Winner.HOT);
    expect(result.reason).toBe(Reason.FOULED);
  });
});

describe('getAroundData', () => {
  it('周囲9マスのデータを返す', () => {
    const state = makeState();
    const around = getAroundData(state, Team.COOL);
    expect(around.data.length).toBe(9);
    expect(around.connect).toBe(ConnectingStatus.CONTINUE);
  });

  it('マップ外は BLOCK として返す', () => {
    const map = createRandomMap();
    // 左上角に強制移動
    const state: GameState = {
      map,
      teamPos: [{ x: 0, y: 0 }, map.teamFirstPoint[1]],
      teamScore: [0, 0],
      turnCount: 100,
      leaveItems: countItems(map),
      isDisconnected: [false, false],
    };
    const around = getAroundData(state, Team.COOL);
    // 左上角の場合、上・左・左上がマップ外 → BLOCK
    expect(around.data[0]).toBe(MapObject.BLOCK); // 左上
    expect(around.data[1]).toBe(MapObject.BLOCK); // 上
    expect(around.data[3]).toBe(MapObject.BLOCK); // 左
  });

  it('method を渡さなければ従来どおり自機中心の 3x3 を返す', () => {
    const state = makeState({ teamPos: [{ x: 5, y: 5 }, { x: 9, y: 9 }] });
    const around = getAroundData(state, Team.COOL);
    const expected = getScanCells({ x: 5, y: 5 }, Action.WALK, Rote.UNKNOWN)
      .map(c => state.map.field[c.y][c.x]);
    expect(around.data).toEqual(expected);
  });

  it('LOOK では指定方向の 3x3 を返す (自機中心とは別のマス)', () => {
    // 自機 (5,5) の 3 マス上 (5,2) にだけ ITEM を置く。
    // LOOK(UP) の範囲 (距離1〜3) には入るが、自機中心の 3x3 には入らない位置。
    const state = makeEmptyState({ x: 5, y: 5 });
    state.map.field[2][5] = MapObject.ITEM;
    const method: Method = { team: Team.COOL, action: Action.LOOK, rote: Rote.UP };

    // LOOK の中心は (5,3) なので row-major の index 1 が (5,2)
    expect(getAroundData(state, Team.COOL, method).data[1]).toBe(MapObject.ITEM);
    // 自機中心の 3x3 には含まれない
    expect(getAroundData(state, Team.COOL).data).not.toContain(MapObject.ITEM);
  });

  it('SEARCH では指定方向の直線 9 マスを近い順に返す', () => {
    // 自機 (5,10) の 7 マス上 (5,3) にだけ ITEM → SEARCH(UP) の index 6
    const state = makeEmptyState({ x: 5, y: 10 });
    state.map.field[3][5] = MapObject.ITEM;
    const method: Method = { team: Team.COOL, action: Action.SEARCH, rote: Rote.UP };
    expect(getAroundData(state, Team.COOL, method).data[6]).toBe(MapObject.ITEM);
    // ITEM は1マスだけなので、他は全て NOTHING
    expect(getAroundData(state, Team.COOL, method).data.filter(v => v === MapObject.ITEM)).toHaveLength(1);
  });
});

describe('getScanCells', () => {
  const origin = { x: 5, y: 5 };

  it('WALK/PUT は自機中心の 3x3 を row-major で返す', () => {
    for (const action of [Action.WALK, Action.PUT]) {
      const cells = getScanCells(origin, action, Rote.UP);
      expect(cells).toHaveLength(9);
      expect(cells[0]).toEqual({ x: 4, y: 4 });
      expect(cells[4]).toEqual(origin);
      expect(cells[8]).toEqual({ x: 6, y: 6 });
    }
  });

  it('LOOK は 2 マス先を中心とする 3x3 (= 距離 1〜3 の帯) を返す', () => {
    // UP: 中心 (5,3) → y は 2,3,4。自機 (5,5) と隣接し、間に隙間がないこと
    const up = getScanCells(origin, Action.LOOK, Rote.UP);
    expect(up).toHaveLength(9);
    expect(up[0]).toEqual({ x: 4, y: 2 });
    expect(up[4]).toEqual({ x: 5, y: 3 });
    expect(up[8]).toEqual({ x: 6, y: 4 });
    expect(up.some(c => c.y === origin.y - 1)).toBe(true); // 自機の真上に接している
    expect(up.some(c => c.y === origin.y)).toBe(false);    // 自機の行は含まない

    expect(getScanCells(origin, Action.LOOK, Rote.DOWN)[4]).toEqual({ x: 5, y: 7 });
    expect(getScanCells(origin, Action.LOOK, Rote.RIGHT)[4]).toEqual({ x: 7, y: 5 });
    expect(getScanCells(origin, Action.LOOK, Rote.LEFT)[4]).toEqual({ x: 3, y: 5 });
  });

  it('SEARCH は指定方向の直線 9 マスを近い順に返す', () => {
    const up = getScanCells(origin, Action.SEARCH, Rote.UP);
    expect(up).toHaveLength(9);
    expect(up[0]).toEqual({ x: 5, y: 4 }); // 距離1 (最も近い)
    expect(up[8]).toEqual({ x: 5, y: -4 }); // 距離9 (盤外座標もそのまま返す)

    expect(getScanCells(origin, Action.SEARCH, Rote.RIGHT)[0]).toEqual({ x: 6, y: 5 });
    expect(getScanCells(origin, Action.SEARCH, Rote.DOWN)[8]).toEqual({ x: 5, y: 14 });
    expect(getScanCells(origin, Action.SEARCH, Rote.LEFT)[8]).toEqual({ x: -4, y: 5 });
  });

  it('方向が UNKNOWN なら自機中心に縮退する', () => {
    expect(getScanCells(origin, Action.LOOK, Rote.UNKNOWN))
      .toEqual(getScanCells(origin, Action.WALK, Rote.UNKNOWN));
    expect(getScanCells(origin, Action.SEARCH, Rote.UNKNOWN).every(c => c.x === 5 && c.y === 5)).toBe(true);
  });
});

describe('scanInfoFrom', () => {
  const state = () => makeState({ teamPos: [{ x: 5, y: 5 }, { x: 9, y: 9 }] });

  it('LOOK/SEARCH のときだけ範囲を返す', () => {
    const look = scanInfoFrom(state(), 0, { team: Team.COOL, action: Action.LOOK, rote: Rote.UP });
    expect(look).not.toBeNull();
    expect(look!.team).toBe(0);
    expect(look!.action).toBe(Action.LOOK);
    expect(look!.cells).toHaveLength(9);

    // teamPos[1] = (9,9) なので LEFT の最も近いマスは (8,9)
    const search = scanInfoFrom(state(), 1, { team: Team.HOT, action: Action.SEARCH, rote: Rote.LEFT });
    expect(search!.team).toBe(1);
    expect(search!.cells[0]).toEqual({ x: 8, y: 9 });
  });

  it('WALK / PUT では null', () => {
    expect(scanInfoFrom(state(), 0, { team: Team.COOL, action: Action.WALK, rote: Rote.UP })).toBeNull();
    expect(scanInfoFrom(state(), 0, { team: Team.COOL, action: Action.PUT, rote: Rote.UP })).toBeNull();
  });

  it('方向が UNKNOWN なら null (縮退した範囲を描画側に渡さない)', () => {
    expect(scanInfoFrom(state(), 0, { team: Team.COOL, action: Action.SEARCH, rote: Rote.UNKNOWN })).toBeNull();
    expect(scanInfoFrom(state(), 0, { team: Team.COOL, action: Action.LOOK, rote: Rote.UNKNOWN })).toBeNull();
  });
});

describe('judgeGame — LOOK/SEARCH 実装後も 3x3 判定であること', () => {
  it('下敷き・囲まれ判定は自機中心の 3x3 のまま', () => {
    const map = createRandomMap();
    const field = map.field.map(row => [...row]);
    const p = { x: 5, y: 5 };
    // 自機の上下左右をブロックで囲む (囲まれ判定が成立する配置)
    field[p.y][p.x]     = MapObject.NOTHING;
    field[p.y - 1][p.x] = MapObject.BLOCK;
    field[p.y + 1][p.x] = MapObject.BLOCK;
    field[p.y][p.x - 1] = MapObject.BLOCK;
    field[p.y][p.x + 1] = MapObject.BLOCK;
    const state: GameState = {
      map: { ...map, field },
      teamPos: [p, { x: 1, y: 1 }],
      teamScore: [0, 0],
      turnCount: 100,
      leaveItems: countItems({ ...map, field }),
      isDisconnected: [false, false],
    };
    // COOL が囲まれている → HOT の勝ち
    const result = judgeGame(state, 1);
    expect(result.winner).toBe(Winner.HOT);
    expect([Reason.TRAPPED, Reason.CONFINED]).toContain(result.reason);
  });
});

describe('applyMethod', () => {
  // 盤面中央付近の1マスを固定的に ITEM/NOTHING にし、その左隣にプレイヤーを置いて
  // WALK(RIGHT) で決定論的にテストできるようにする
  function makeWalkState(itemAtTarget: boolean): { state: GameState; ix: number; iy: number } {
    const map = createRandomMap();
    const field = map.field.map(row => [...row]);
    const iy = Math.floor(map.size.y / 2);
    const ix = Math.floor(map.size.x / 2);
    field[iy][ix]     = itemAtTarget ? MapObject.ITEM : MapObject.NOTHING;
    field[iy][ix - 1] = MapObject.NOTHING; // プレイヤーの現在地は必ず NOTHING
    const state: GameState = {
      map: { ...map, field },
      teamPos: [{ x: ix - 1, y: iy }, map.teamFirstPoint[1]],
      teamScore: [0, 0],
      turnCount: 100,
      leaveItems: countItems({ ...map, field }),
      isDisconnected: [false, false],
    };
    return { state, ix, iy };
  }

  it('アイテムのあるマスへ WALK → 得点+1・leaveItems-1・移動先NOTHING・移動前マスがBLOCKになる', () => {
    const { state, ix, iy } = makeWalkState(true);
    const method: Method = { team: Team.COOL, action: Action.WALK, rote: Rote.RIGHT };
    const next = applyMethod(state, method);

    expect(next.teamPos[0]).toEqual({ x: ix, y: iy });
    expect(next.teamScore[0]).toBe(1);
    expect(next.leaveItems).toBe(state.leaveItems - 1);
    expect(next.map.field[iy][ix]).toBe(MapObject.NOTHING);       // 移動先: アイテムを取得して消える
    expect(next.map.field[iy][ix - 1]).toBe(MapObject.BLOCK);     // 移動前: 足跡がブロックになる
  });

  it('アイテムの無いマスへの通常 WALK → 移動前マスは変化しない', () => {
    const { state, ix, iy } = makeWalkState(false);
    const method: Method = { team: Team.COOL, action: Action.WALK, rote: Rote.RIGHT };
    const next = applyMethod(state, method);

    expect(next.teamPos[0]).toEqual({ x: ix, y: iy });
    expect(next.teamScore[0]).toBe(0);
    expect(next.map.field[iy][ix - 1]).toBe(MapObject.NOTHING);
  });

  it('ブロックのあるマスへ WALK → 移動が反映され、judgeGame が COLLISION 負けを返す (競技ルール1.④)', () => {
    const map = createRandomMap();
    const field = map.field.map(row => [...row]);
    const iy = Math.floor(map.size.y / 2);
    const ix = Math.floor(map.size.x / 2);
    field[iy][ix] = MapObject.BLOCK;
    field[iy][ix - 1] = MapObject.NOTHING;
    const state: GameState = {
      map: { ...map, field },
      teamPos: [{ x: ix - 1, y: iy }, map.teamFirstPoint[1]],
      teamScore: [0, 0],
      turnCount: 100,
      leaveItems: countItems({ ...map, field }),
      isDisconnected: [false, false],
    };
    const method: Method = { team: Team.COOL, action: Action.WALK, rote: Rote.RIGHT };
    const next = applyMethod(state, method);

    expect(next.teamPos[0]).toEqual({ x: ix, y: iy });

    const result = judgeGame(next, 0);
    expect(result.winner).toBe(Winner.HOT);
    expect(result.reason).toBe(Reason.COLLISION);
  });
});

describe('calculateBonusBreakdown', () => {
  function status(winner: Winner, reason: Reason): GameStatus {
    return { winner, reason };
  }

  it('reason=SCORE (ターン切れ) のときは両者とも一撃・総取りともに0', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.SCORE), [5, 3], 10);
    expect(strikeBonus).toEqual([0, 0]);
    expect(sweepBonus).toEqual([0, 0]);
  });

  it('勝者が定まらない (DRAW) 決着では加点対象が無いので両者0', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.DRAW, Reason.TRAPPED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, 0]);
    expect(sweepBonus).toEqual([0, 0]);
  });

  it('ATTACK (アタック) では勝者に一撃 +50、総取りは+6×残アイテム', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.ATTACK), [5, 3], 10);
    expect(strikeBonus).toEqual([50, 0]);
    expect(sweepBonus).toEqual([60, 0]);
  });

  it('TRAPPED (閉じ込め) でも勝者に一撃 +50、総取りは+6×残アイテム', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.TRAPPED), [5, 3], 10);
    expect(strikeBonus).toEqual([50, 0]);
    expect(sweepBonus).toEqual([60, 0]);
  });

  it('CONFINED (自縛) では敗者に一撃 -3×自スコアの罰点、勝者に +50 は付かない', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.CONFINED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([60, 0]);
  });

  it('COLLISION (衝突) では敗者に一撃 -3×自スコアの罰点、総取りは勝者に+6×残アイテム', () => {
    // HOT が衝突負けして COOL が勝利 → 敗者(HOT, スコア3)に -3*3 = -9
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.COLLISION), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([60, 0]);
  });

  it('FOULED (通信エラー) でも COLLISION と同様に敗者へ罰点', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.FOULED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([60, 0]);
  });

  it('HOT が勝者の場合はインデックスが反転する', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.HOT, Reason.COLLISION), [5, 3], 2);
    expect(strikeBonus).toEqual([-15, 0]); // COOL (スコア5) の反則負け → -3*5
    expect(sweepBonus).toEqual([0, 12]);   // HOT の総取り → 6*2
  });

  it('HOT がアタックで勝った場合は HOT 側に +50 が入る', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.HOT, Reason.ATTACK), [5, 3], 2);
    expect(strikeBonus).toEqual([0, 50]);
    expect(sweepBonus).toEqual([0, 12]);
  });
});
