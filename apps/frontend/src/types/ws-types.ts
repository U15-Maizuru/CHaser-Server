// Mirror of apps/backend/src/network/ws-types.ts
// Keep in sync when adding new message types.

export const enum MapObject {
  NOTHING = 0,
  TARGET  = 1,
  BLOCK   = 2,
  ITEM    = 3,
}

export const enum Winner {
  COOL     = 0,
  HOT      = 1,
  DRAW     = 2,
  CONTINUE = 3,
  NONE     = 4,
}

export const enum Reason {
  SCORE    = 0,
  TRAPPED  = 1,
  CONFINED = 2,
  ATTACK   = 3,
  COLLISION = 4,
  FOULED   = 5,
  NONE     = 6,
}

export interface Point { x: number; y: number }

export interface GameStateSnapshot {
  field: MapObject[][];
  size: Point;
  teamPos: [Point, Point];
  teamScore: [number, number];
  turnCount: number;
  leaveItems: number;
  playerNames: [string, string];
}

export interface TurnStartPayload {
  turn: number;
  player: number;
}

export interface ScoreData {
  teamScore: [number, number];
  leaveItems: number;
}

export interface GameEndPayload {
  winner: Winner;
  reason: Reason;
  playerNames: [string, string];
  finalScore: [number, number];
}

// --- Server lifecycle ---
export type ClientType  = 'tcp' | 'cpu' | 'process';
export type ClientState = 'waiting' | 'connected' | 'ready';
export type ServerPhase = 'setup' | 'playing' | 'finished';

export interface ClientStatusPayload {
  type: ClientType;
  state: ClientState;
  name: string;
  ip: string;
  port: number;
}

export interface ServerStatusPayload {
  phase: ServerPhase;
  localIP: string;
  clients: [ClientStatusPayload, ClientStatusPayload];
}

// Backend → Frontend
export type WsMessage =
  | { type: 'game_state';    payload: GameStateSnapshot }
  | { type: 'turn_start';    payload: TurnStartPayload }
  | { type: 'score_update';  payload: ScoreData }
  | { type: 'game_end';      payload: GameEndPayload }
  | { type: 'server_status'; payload: ServerStatusPayload };

export interface ProcessConfig {
  programType: 'python' | 'bot';
  programPath: string;
  runtimeCommand: string;
}

export interface MapParams {
  itemNum:  number;
  blockNum: number;
  turnNum:  number;
  mirror:   boolean;
}

export interface InlineMapData {
  field: number[][];
  size: Point;
  turn: number;
  teamFirstPoint: [Point, Point];
}

// Frontend → Backend
export type FrontendMessage =
  | { type: 'set_client';    payload: { slot: 0 | 1; clientType: ClientType; processConfig?: ProcessConfig } }
  | { type: 'request_start' }
  | { type: 'request_reset' }
  | { type: 'load_map';      payload: { filePath: string } }
  | { type: 'set_map_params'; payload: MapParams }
  | { type: 'load_map_data'; payload: InlineMapData };
