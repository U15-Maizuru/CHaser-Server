import { describe, expect, it } from 'vitest';
import { createRandomMap } from './GameSystem.js';
import { applyMethod, calculateBonusBreakdown, countItems, GameState, getAroundData, judgeGame } from './GameLogic.js';
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

  it('TRAPPED (閉じ込め) は減点対象外 → 一撃0、総取りのみ+7×残アイテム', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.TRAPPED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, 0]);
    expect(sweepBonus).toEqual([70, 0]);
  });

  it('CONFINED (自縛) では敗者に一撃 -3×自スコアの罰点、総取りは勝者に+7×残アイテム', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.CONFINED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([70, 0]);
  });

  it('COLLISION (衝突) では敗者に一撃 -3×自スコアの罰点、総取りは勝者に+7×残アイテム', () => {
    // HOT が衝突負けして COOL が勝利 → 敗者(HOT, スコア3)に -3*3 = -9
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.COLLISION), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([70, 0]);
  });

  it('FOULED (通信エラー) でも COLLISION と同様に敗者へ罰点', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.COOL, Reason.FOULED), [5, 3], 10);
    expect(strikeBonus).toEqual([0, -9]);
    expect(sweepBonus).toEqual([70, 0]);
  });

  it('HOT が勝者の場合はインデックスが反転する', () => {
    const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status(Winner.HOT, Reason.COLLISION), [5, 3], 2);
    expect(strikeBonus).toEqual([-15, 0]); // COOL (スコア5) の反則負け → -3*5
    expect(sweepBonus).toEqual([0, 14]);   // HOT の総取り → 7*2
  });
});
