import type { MapObject, Point, Reason, Winner } from '../game/types.js';

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

// --- Server lifecycle (Backend → Frontend) ---
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

export type WsMessage =
  | { type: 'game_state';    payload: GameStateSnapshot }
  | { type: 'turn_start';    payload: TurnStartPayload }
  | { type: 'score_update';  payload: ScoreData }
  | { type: 'game_end';      payload: GameEndPayload }
  | { type: 'server_status'; payload: ServerStatusPayload };

// --- Commands (Frontend → Backend) ---
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

export type FrontendMessage =
  | { type: 'set_client';    payload: { slot: 0 | 1; clientType: ClientType; processConfig?: ProcessConfig } }
  | { type: 'request_start' }
  | { type: 'request_reset' }
  | { type: 'load_map';      payload: { filePath: string } }
  | { type: 'set_map_params'; payload: MapParams }
  | { type: 'load_map_data'; payload: InlineMapData };
