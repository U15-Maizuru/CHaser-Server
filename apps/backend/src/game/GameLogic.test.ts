import { describe, expect, it } from 'vitest';
import { createRandomMap } from './GameSystem.js';
import { countItems, GameState, getAroundData, judgeGame } from './GameLogic.js';
import { ConnectingStatus, MapObject, Reason, Team, Winner } from './types.js';

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
