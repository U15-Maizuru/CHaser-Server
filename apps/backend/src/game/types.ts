export interface Point {
  x: number;
  y: number;
}

export const TEAM_COUNT = 2;
export const ROUND_COUNT = 2;

export enum Team {
  COOL = 0,
  HOT = 1,
  UNKNOWN = 2,
}

export enum Winner {
  COOL = 0,
  HOT = 1,
  DRAW = 2,
  CONTINUE = 3,
  NONE = 4,
}

export enum Reason {
  SCORE,
  TRAPPED,
  CONFINED,
  ATTACK,
  COLLISION,
  FOULED,
  NONE,
}

export enum Cause {
  NOGETREADY,
  RESEND,
  UNKNOWNACTION,
  UNKNOWNROTE,
  NONE,
}

export interface GameStatus {
  winner: Winner;
  reason: Reason;
  cause: Cause;
}

export enum ConnectingStatus {
  FINISHED = 0,
  CONTINUE = 1,
}

export enum MapObject {
  NOTHING = 0,
  TARGET = 1,
  BLOCK = 2,
  ITEM = 3,
}

export enum MapOverlay {
  NOTHING,
  LOOK,
  SEARCH,
  GETREADY,
  BLIND,
  ERASE,
}

export enum Action {
  WALK,
  LOOK,
  SEARCH,
  PUT,
  GETREADY,
  UNKNOWN,
}

export enum Rote {
  UP,
  DOWN,
  RIGHT,
  LEFT,
  UNKNOWN,
}

export interface Method {
  team: Team;
  action: Action;
  rote: Rote;
}

export interface AroundData {
  connect: ConnectingStatus;
  data: MapObject[]; // 9要素: 3x3の周囲マス
}

export interface GameMap {
  field: MapObject[][];
  turn: number;
  name: string;
  size: Point;
  teamFirstPoint: [Point, Point];
  textureDirPath: string;
}
