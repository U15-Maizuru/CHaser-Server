import { describe, expect, it } from 'vitest';
import {
  aroundDataToString,
  createRandomMap,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  getTeamName,
  getRoteVector,
  methodFromString,
} from './GameSystem.js';
import { Action, ConnectingStatus, MapObject, Rote, Team } from './types.js';

describe('getTeamName', () => {
  it('COOL を返す', () => expect(getTeamName(Team.COOL)).toBe('COOL'));
  it('HOT を返す', () => expect(getTeamName(Team.HOT)).toBe('HOT'));
  it('UNKNOWN を返す', () => expect(getTeamName(Team.UNKNOWN)).toBe('UNKNOWN'));
});

describe('getRoteVector', () => {
  it('UP は (0,-1)', () => expect(getRoteVector(Rote.UP)).toEqual({ x: 0, y: -1 }));
  it('DOWN は (0,1)', () => expect(getRoteVector(Rote.DOWN)).toEqual({ x: 0, y: 1 }));
  it('RIGHT は (1,0)', () => expect(getRoteVector(Rote.RIGHT)).toEqual({ x: 1, y: 0 }));
  it('LEFT は (-1,0)', () => expect(getRoteVector(Rote.LEFT)).toEqual({ x: -1, y: 0 }));
  it('UNKNOWN は (0,0)', () => expect(getRoteVector(Rote.UNKNOWN)).toEqual({ x: 0, y: 0 }));
});

describe('methodFromString', () => {
  it('"wu" → WALK + UP', () => {
    const m = methodFromString('wu');
    expect(m.action).toBe(Action.WALK);
    expect(m.rote).toBe(Rote.UP);
  });
  it('"ld" → LOOK + DOWN', () => {
    const m = methodFromString('ld');
    expect(m.action).toBe(Action.LOOK);
    expect(m.rote).toBe(Rote.DOWN);
  });
  it('"pr" → PUT + RIGHT', () => {
    const m = methodFromString('pr');
    expect(m.action).toBe(Action.PUT);
    expect(m.rote).toBe(Rote.RIGHT);
  });
  it('"sl" → SEARCH + LEFT', () => {
    const m = methodFromString('sl');
    expect(m.action).toBe(Action.SEARCH);
    expect(m.rote).toBe(Rote.LEFT);
  });
  it('不正文字 → UNKNOWN', () => {
    const m = methodFromString('zz');
    expect(m.action).toBe(Action.UNKNOWN);
    expect(m.rote).toBe(Rote.UNKNOWN);
  });
});

describe('aroundDataToString', () => {
  it('9要素の文字列を生成する', () => {
    const around = {
      connect: ConnectingStatus.CONTINUE,
      data: [0, 1, 2, 3, 0, 1, 2, 3, 0] as MapObject[],
    };
    expect(aroundDataToString(around)).toBe('1012301230');
  });
});

describe('createRandomMap', () => {
  it('デフォルトサイズのマップを生成する', () => {
    const map = createRandomMap();
    expect(map.size.x).toBe(DEFAULT_MAP_WIDTH);
    expect(map.size.y).toBe(DEFAULT_MAP_HEIGHT);
    expect(map.field.length).toBe(DEFAULT_MAP_HEIGHT);
    expect(map.field[0].length).toBe(DEFAULT_MAP_WIDTH);
  });

  it('COOL は盤面左側に配置される', () => {
    for (let i = 0; i < 10; i++) {
      const map = createRandomMap();
      const cool = map.teamFirstPoint[0];
      expect(cool.x).toBeLessThanOrEqual(Math.floor(map.size.x / 2));
    }
  });

  it('外周にブロックがない', () => {
    const map = createRandomMap();
    for (let x = 0; x < map.size.x; x++) {
      expect(map.field[0][x]).not.toBe(MapObject.BLOCK);
      expect(map.field[map.size.y - 1][x]).not.toBe(MapObject.BLOCK);
    }
    for (let y = 0; y < map.size.y; y++) {
      expect(map.field[y][0]).not.toBe(MapObject.BLOCK);
      expect(map.field[y][map.size.x - 1]).not.toBe(MapObject.BLOCK);
    }
  });

  it('チーム初期位置にアイテムがない (周囲8マス含む)', () => {
    const map = createRandomMap();
    for (const fp of map.teamFirstPoint) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = fp.x + dx;
          const ny = fp.y + dy;
          if (nx >= 0 && nx < map.size.x && ny >= 0 && ny < map.size.y) {
            expect(map.field[ny][nx]).not.toBe(MapObject.ITEM);
          }
        }
      }
    }
  });

  it('チーム初期位置は外周マスに配置されない (開始直後の囲まれ判定を防ぐ)', () => {
    for (let i = 0; i < 10; i++) {
      const map = createRandomMap();
      for (const fp of map.teamFirstPoint) {
        expect(fp.x).not.toBe(0);
        expect(fp.x).not.toBe(map.size.x - 1);
        expect(fp.y).not.toBe(0);
        expect(fp.y).not.toBe(map.size.y - 1);
      }
    }
  });

  it('チーム初期位置に隣接する4マスにブロックがない (開始直後の囲まれ判定を防ぐ)', () => {
    for (let i = 0; i < 10; i++) {
      const map = createRandomMap();
      for (const fp of map.teamFirstPoint) {
        const neighbors = [
          { x: fp.x, y: fp.y - 1 },
          { x: fp.x, y: fp.y + 1 },
          { x: fp.x - 1, y: fp.y },
          { x: fp.x + 1, y: fp.y },
        ];
        for (const n of neighbors) {
          expect(map.field[n.y][n.x]).not.toBe(MapObject.BLOCK);
        }
      }
    }
  });
});
