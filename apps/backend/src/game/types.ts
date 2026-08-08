import { ConnectingStatus, MapObject, Winner, Reason, Action, Rote } from '@u15/ws-types';
import type { Point } from '@u15/ws-types';
export { ConnectingStatus, MapObject, Winner, Reason, Action, Rote } from '@u15/ws-types';
export type { Point, ScanInfo } from '@u15/ws-types';

export const TEAM_COUNT = 2;

export enum Team {
  COOL    = 0,
  HOT     = 1,
  UNKNOWN = 2,
}

export interface GameStatus {
  winner: Winner;
  reason: Reason;
}

// Action / Rote は @u15/ws-types が単一情報源 (フロントの手動操作 UI と共有するため)。
// バックエンドはゲーム関連の型をこのファイルに集約して import する。

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
