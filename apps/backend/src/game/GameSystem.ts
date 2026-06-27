import fs from 'node:fs';
import path from 'node:path';
import {
  Action,
  AroundData,
  ConnectingStatus,
  GameMap,
  MapObject,
  Method,
  Point,
  Rote,
  TEAM_COUNT,
  Team,
} from './types.js';

export const DEFAULT_MAP_WIDTH = 15;
export const DEFAULT_MAP_HEIGHT = 17;

export function getTeamName(team: Team): string {
  if (team === Team.COOL) return 'COOL';
  if (team === Team.HOT) return 'HOT';
  return 'UNKNOWN';
}

export function getRoteVector(rote: Rote): Point {
  switch (rote) {
    case Rote.UP:    return { x:  0, y: -1 };
    case Rote.RIGHT: return { x:  1, y:  0 };
    case Rote.DOWN:  return { x:  0, y:  1 };
    case Rote.LEFT:  return { x: -1, y:  0 };
    default:         return { x:  0, y:  0 };
  }
}

export function methodFromString(str: string): Omit<Method, 'team'> {
  let action: Action;
  switch (str[0]) {
    case 'w': action = Action.WALK;   break;
    case 'l': action = Action.LOOK;   break;
    case 's': action = Action.SEARCH; break;
    case 'p': action = Action.PUT;    break;
    default:  action = Action.UNKNOWN;
  }
  let rote: Rote;
  switch (str[1]) {
    case 'u': rote = Rote.UP;      break;
    case 'd': rote = Rote.DOWN;    break;
    case 'r': rote = Rote.RIGHT;   break;
    case 'l': rote = Rote.LEFT;    break;
    default:  rote = Rote.UNKNOWN;
  }
  return { action, rote };
}

export function aroundDataToString(around: AroundData): string {
  let str = String(around.connect);
  for (let i = 0; i < 9; i++) {
    str += String(around.data[i]);
  }
  return str;
}

export function aroundDataFinish(around: AroundData): AroundData {
  return {
    connect: ConnectingStatus.FINISHED,
    data: [MapObject.NOTHING, ...around.data.slice(1)] as MapObject[],
  };
}

export function createDefaultMap(): GameMap {
  const size: Point = { x: DEFAULT_MAP_WIDTH, y: DEFAULT_MAP_HEIGHT };
  return {
    field: Array.from({ length: size.y }, () => Array(size.x).fill(MapObject.NOTHING)),
    turn: 100,
    name: '[DEFAULT MAP]',
    size,
    teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    textureDirPath: 'Jewel',
  };
}

function mirrorPoint(pos: Point, size: Point): Point {
  const cx = Math.floor(size.x / 2);
  const cy = Math.floor(size.y / 2);
  return { x: cx * 2 - pos.x, y: cy * 2 - pos.y };
}

function uniformNorm(p: Point): number {
  return Math.max(Math.abs(p.x), Math.abs(p.y));
}

function checkBlockRole(pos: Point, map: GameMap): boolean {
  // 外周禁止
  if (pos.x === 0 || pos.x === map.size.x - 1 || pos.y === 0 || pos.y === map.size.y - 1)
    return false;
  // Search終点禁止
  for (let i = 0; i < TEAM_COUNT; i++) {
    const fp = map.teamFirstPoint[i];
    if ((pos.x === fp.x && Math.abs(pos.y - fp.y) === 9)) return false;
  }
  return true;
}

export function createRandomMap(
  size: Point = { x: DEFAULT_MAP_WIDTH, y: DEFAULT_MAP_HEIGHT },
  blockNum = 20,
  itemNum = 51,
  turn = 100,
  mirror = true,
): GameMap {
  const map = createDefaultMap();
  map.size = size;
  map.turn = turn;
  map.name = '[RANDOM MAP]';
  map.field = Array.from({ length: size.y }, () => Array(size.x).fill(MapObject.NOTHING));

  const rand = (n: number) => Math.floor(Math.random() * n);

  // COOL 配置 (盤面左側)
  while (true) {
    const pos: Point = { x: rand(size.x), y: rand(size.y) };
    if (uniformNorm({ x: pos.x - Math.floor(size.x / 2), y: pos.y - Math.floor(size.y / 2) }) <= 1) continue;
    if (pos.x < Math.floor(size.x / 2) || (pos.x === Math.floor(size.x / 2) && pos.y < Math.floor(size.y / 2))) {
      map.teamFirstPoint[0] = pos;
      break;
    }
  }

  if (mirror) {
    map.teamFirstPoint[1] = mirrorPoint(map.teamFirstPoint[0], size);
  } else {
    while (true) {
      const pos: Point = { x: rand(size.x), y: rand(size.y) };
      if (uniformNorm({ x: pos.x - Math.floor(size.x / 2), y: pos.y - Math.floor(size.y / 2) }) <= 1) continue;
      if (pos.x > Math.floor(size.x / 2) || (pos.x === Math.floor(size.x / 2) && pos.y >= Math.floor(size.y / 2))) {
        map.teamFirstPoint[1] = pos;
        break;
      }
    }
  }

  // ブロック配置
  let placed = 0;
  while (placed < blockNum) {
    const pos: Point = { x: rand(size.x), y: rand(size.y) };
    const mp = mirrorPoint(pos, size);
    if (
      checkBlockRole(pos, map) &&
      (pos.x !== map.teamFirstPoint[0].x || pos.y !== map.teamFirstPoint[0].y) &&
      (pos.x !== map.teamFirstPoint[1].x || pos.y !== map.teamFirstPoint[1].y) &&
      map.field[pos.y][pos.x] !== MapObject.BLOCK &&
      !(pos.x === Math.floor(size.x / 2) && pos.y === Math.floor(size.y / 2))
    ) {
      map.field[pos.y][pos.x] = MapObject.BLOCK;
      if (mirror) {
        map.field[mp.y][mp.x] = MapObject.BLOCK;
        placed += 2;
      } else {
        placed++;
      }
    }
  }

  // アイテム配置
  let itemPlaced = 0;
  if (mirror) {
    map.field[Math.floor(size.y / 2)][Math.floor(size.x / 2)] = MapObject.ITEM;
    itemPlaced++;
  }
  while (itemPlaced < itemNum) {
    const pos: Point = { x: rand(size.x), y: rand(size.y) };
    const mp = mirrorPoint(pos, size);
    const tooCloseToTeam =
      uniformNorm({ x: map.teamFirstPoint[0].x - pos.x, y: map.teamFirstPoint[0].y - pos.y }) <= 1 ||
      uniformNorm({ x: map.teamFirstPoint[1].x - pos.x, y: map.teamFirstPoint[1].y - pos.y }) <= 1;
    if (
      !tooCloseToTeam &&
      map.field[pos.y][pos.x] !== MapObject.ITEM &&
      map.field[pos.y][pos.x] !== MapObject.BLOCK
    ) {
      map.field[pos.y][pos.x] = MapObject.ITEM;
      itemPlaced++;
      if (mirror) {
        map.field[mp.y][mp.x] = MapObject.ITEM;
        itemPlaced++;
      }
    }
  }

  return map;
}

export function importMap(filename: string): GameMap | null {
  let content: string;
  try {
    content = fs.readFileSync(filename, 'latin1');
  } catch {
    return null;
  }

  const map = createDefaultMap();
  const lines = content.split(/\r?\n/);
  let row = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const key = line[0];
    const val = line.slice(2);

    if (key === 'N') {
      map.name = val;
    } else if (key === 'T') {
      map.turn = parseInt(val, 10);
    } else if (key === 'S') {
      const [w, h] = val.split(',').map(Number);
      map.size = { x: w, y: h };
      map.field = Array.from({ length: h }, () => Array(w).fill(MapObject.NOTHING));
    } else if (key === 'D') {
      map.field[row] = val.split(',').map(n => parseInt(n, 10) as MapObject);
      map.size = { ...map.size, x: map.field[row].length };
      row++;
    } else {
      // チーム初期位置 (C: / H:)
      for (let i = 0; i < TEAM_COUNT; i++) {
        if (key === getTeamName(i as Team)[0]) {
          const [x, y] = val.split(',').map(Number);
          map.teamFirstPoint[i] = { x, y };
          break;
        }
      }
    }
  }

  return map;
}

export function exportMap(map: GameMap, filename: string): boolean {
  try {
    const name = path.basename(filename).replace('.map', '');
    const lines: string[] = [];
    lines.push(`N:${name}`);
    lines.push(`T:${map.turn}`);
    lines.push(`S:${map.size.x},${map.size.y}`);
    for (const row of map.field) {
      lines.push(`D:${row.join(',')}`);
    }
    for (let i = 0; i < TEAM_COUNT; i++) {
      const fp = map.teamFirstPoint[i];
      lines.push(`${getTeamName(i as Team)[0]}:${fp.x},${fp.y}`);
    }
    fs.writeFileSync(filename, lines.join('\n') + '\n');
    return true;
  } catch {
    return false;
  }
}
