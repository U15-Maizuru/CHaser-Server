// WebSocket でやりとりするメッセージの union。
// protocol.ts の型を参照するので、依存の順は protocol → messages。

import type {
  ClientType,
  DisplayPrefs,
  GameEndPayload,
  GameStateSnapshot,
  InlineMapData,
  MapParams,
  ProcessConfig,
  RoomSummary,
  ScoreData,
  ServerStatusPayload,
  TurnStartPayload,
} from './protocol.js';

// --- Commands (Frontend → Backend) ---

export type FrontendMessage =
  | { type: 'set_client';        payload: { slot: 0 | 1; clientType: ClientType; processConfig?: ProcessConfig } }
  | { type: 'delete_program';    payload: { slot: 0 | 1 } }
  | { type: 'request_start' }
  | { type: 'request_reset' }
  | { type: 'load_map';          payload: { catalogId: string } }
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
  | { type: 'set_display_prefs'; payload: Partial<DisplayPrefs> }
  | { type: 'manual_action';     payload: { slot: 0 | 1; action: number; rote: number } }
  | { type: 'create_room' }
  | { type: 'join_room';         payload: { roomId: string } }
  | { type: 'list_rooms' }
  | { type: 'destroy_room' };

// --- Room / lobby ---

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
