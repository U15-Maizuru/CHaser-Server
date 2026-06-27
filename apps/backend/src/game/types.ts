import { MapObject, Winner, Reason } from '@u15/ws-types';
import type { Point } from '@u15/ws-types';
export { MapObject, Winner, Reason } from '@u15/ws-types';
export type { Point } from '@u15/ws-types';

export const TEAM_COUNT  = 2;
export const ROUND_COUNT = 2;

export enum Team {
  COOL    = 0,
  HOT     = 1,
  UNKNOWN = 2,
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
  cause:  Cause;
}

export enum ConnectingStatus {
  FINISHED = 0,
  CONTINUE = 1,
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
  team:   Team;
  action: Action;
  rote:   Rote;
}

export interface AroundData {
  connect: ConnectingStatus;
  data:    MapObject[];
}

export interface GameMap {
  field:          MapObject[][];
  turn:           number;
  name:           string;
  size:           Point;
  teamFirstPoint: [Point, Point];
  textureDirPath: string;
}
