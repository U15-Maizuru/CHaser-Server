// Shared WebSocket protocol types used by both backend and frontend.
// Do NOT duplicate these in apps/backend or apps/frontend.

export interface Point { x: number; y: number }

// 試合開始時のカウントダウン秒数 (フロント表示・バックエンドのターン開始待機の両方で使う単一情報源)
export const START_COUNTDOWN_SECONDS = 3;

// Protocol enums (values must match the game engine integers)
export enum MapObject {
  NOTHING = 0,
  TARGET  = 1,
  BLOCK   = 2,
  ITEM    = 3,
}

export enum Winner {
  COOL     = 0,
  HOT      = 1,
  DRAW     = 2,
  CONTINUE = 3,
  NONE     = 4,
}

export enum Reason {
  SCORE     = 0,
  TRAPPED   = 1,
  CONFINED  = 2,
  ATTACK    = 3,
  COLLISION = 4,
  FOULED    = 5,
  NONE      = 6,
}

// --- Game state ---

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

// --- 2試合制: ラウンド結果 ---

export interface RoundResult {
  round:          0 | 1;
  winner:         Winner;
  reason:         Reason;
  /** 各チームの取得アイテム数 (COOL, HOT の順) */
  scores:         [number, number];
  remainingTurns: number;
  /** 「一撃」— 反則負け(自縛/衝突/通信エラー)の場合のみ、敗者に -3×自スコアの罰点 (それ以外は0) */
  strikeBonus:    [number, number];
  /** 「総取り」— 勝者に、決着時点の残アイテム数×7 のボーナス */
  sweepBonus:     [number, number];
  /** ラウンド開始時のプレイヤー名 */
  playerNames:    [string, string];
}

// --- Server lifecycle ---

export type ClientType  = 'tcp' | 'cpu' | 'process' | 'manual';
export type ClientState = 'waiting' | 'connected' | 'ready';
export type ServerPhase = 'setup' | 'playing' | 'finished';

export interface ClientStatusPayload {
  type:   ClientType;
  state:  ClientState;
  name:   string;
  ip:     string;
  port:   number;
  error?: string;
}

export interface ServerStatusPayload {
  phase:        ServerPhase;
  localIP:      string;
  clients:      [ClientStatusPayload, ClientStatusPayload];
  doubleMode:   boolean;
  repeatMode:   boolean;
  demoMode:     boolean;
  currentRound: 0 | 1;
  roundResults: RoundResult[];
  darkMode:     boolean;
  /** 現在のマップがパラメータからのランダム生成ではなく、ファイル読み込み/インライン(エディタ)由来かどうか */
  mapIsCustom:  boolean;
}

// --- Commands (Frontend → Backend) ---

export interface ProcessConfig {
  programType:    'python' | 'bot';
  programPath:    string;
  runtimeCommand: string;
  libPath?:       string;
}

// --- Program library (対戦用プログラムの保存先。lib.pyCHaser 等の import 用ヘルパー
// ("library" = /api/libs 系) とは無関係の別概念) ---

export interface CatalogEntry {
  id:             string;
  displayName:    string;
  programPath:    string;
  programType:    'python' | 'bot';
  runtimeCommand: string;
  uploadedAt:     number;
  demoEnabled:    boolean; // デモモードのランダム対戦候補に含めるか
}

export interface MapParams {
  itemNum:  number;
  blockNum: number;
  turnNum:  number;
  mirror:   boolean;
  /** 省略時はバックエンド側で既定サイズ (15×17) を使用する */
  size?:    Point;
}

export interface InlineMapData {
  field:          number[][];
  size:           Point;
  turn:           number;
  teamFirstPoint: [Point, Point];
}

// --- Map library (アップロード/エディタ保存されたマップの永続カタログ。
// プログラムライブラリ (CatalogEntry) と同じグローバル共有の考え方) ---

export interface MapCatalogEntry {
  id:          string;
  displayName: string;
  mapPath:     string;
  uploadedAt:  number;
  size:        Point;
  turn:        number;
  blockCount:  number;
  itemCount:   number;
}

export type FrontendMessage =
  | { type: 'set_client';        payload: { slot: 0 | 1; clientType: ClientType; processConfig?: ProcessConfig } }
  | { type: 'delete_program';    payload: { slot: 0 | 1 } }
  | { type: 'request_start' }
  | { type: 'request_reset' }
  | { type: 'load_map';          payload: { filePath: string } }
  | { type: 'set_map_params';    payload: MapParams }
  | { type: 'load_map_data';     payload: InlineMapData }
  | { type: 'set_double_mode';   payload: { enabled: boolean } }
  | { type: 'set_repeat_mode';   payload: { enabled: boolean } }
  | { type: 'set_demo_mode';     payload: { enabled: boolean } }
  | { type: 'set_turn_delay';    payload: { ms: number } }
  | { type: 'set_tcp_timeout';   payload: { ms: number } }
  | { type: 'set_log_dir';       payload: { dir: string } }
  | { type: 'set_python_command'; payload: { command: string } }
  | { type: 'request_next_round' }
  | { type: 'request_repeat' }
  | { type: 'set_dark_mode';     payload: { enabled: boolean } }
  | { type: 'manual_action';     payload: { slot: 0 | 1; action: number; rote: number } }
  | { type: 'create_room' }
  | { type: 'join_room';         payload: { roomId: string } }
  | { type: 'list_rooms' }
  | { type: 'destroy_room' };

// --- Room / lobby ---

export interface RoomSummary {
  id:        string;
  phase:     ServerPhase;
  ports:     [number, number];
  createdAt: number;
}

export type LobbyMessage =
  | { type: 'room_created'; payload: { roomId: string; ports: [number, number] } }
  | { type: 'room_joined';  payload: { roomId: string; ports: [number, number] } }
  | { type: 'room_list';    payload: { rooms: RoomSummary[] } }
  | { type: 'error';        payload: { message: string } };

// --- Messages (Backend → Frontend) ---

export type WsMessage =
  | { type: 'game_state';    payload: GameStateSnapshot }
  | { type: 'turn_start';    payload: TurnStartPayload }
  | { type: 'score_update';  payload: ScoreData }
  | { type: 'game_end';      payload: GameEndPayload }
  | { type: 'server_status'; payload: ServerStatusPayload }
  | { type: 'manual_request'; payload: { slot: 0 | 1; aroundData: number[] } };
