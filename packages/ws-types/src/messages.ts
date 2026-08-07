// WebSocket でやりとりするメッセージの union。
// protocol.ts / tournament.ts の型を参照するので、依存の順は protocol → tournament → messages。

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
import type { TournamentDisplayView, TournamentStatePayload } from './tournament.js';

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
  | { type: 'destroy_room' }
  // --- 大会運営 ---
  | { type: 'tournament_bind';            payload: { tournamentId: string } }
  | { type: 'tournament_unbind' }
  | { type: 'tournament_arm_match';       payload: { matchId: string } }
  | { type: 'tournament_confirm_result';  payload: { matchId: string; winnerSide?: 0 | 1; note?: string } }
  | { type: 'tournament_discard_result';  payload: { matchId: string; rematchMapCatalogId?: string } }
  | { type: 'tournament_reopen_match';    payload: { matchId: string; cascade?: boolean } }
  | { type: 'tournament_set_walkover';    payload: { matchId: string; winnerSide: 0 | 1 | null } }
  | { type: 'tournament_assign_program';  payload: { participantId: string; catalogId: string | null } }
  /** 回戦 (stage) ごとのマップ差し替え。null は「大会の設定に従う」 */
  | { type: 'tournament_set_stage_map';   payload: { stage: number; mapCatalogId: string | null } }
  /** 決勝進出者の手動差し替え。participantId: null は「自動判定に戻す」 */
  | { type: 'tournament_set_qualifier';   payload: { group: number; rank: number; participantId: string | null; cascade?: boolean } }
  /** 決勝進出者の確定。true になるまで観戦画面は予選の最終結果を出し続ける */
  | { type: 'tournament_confirm_qualifiers'; payload: { confirmed: boolean } }
  /** 観戦画面に出すものを切り替える (運営席の表示とは連動しない) */
  | { type: 'tournament_set_display_view'; payload: { view: TournamentDisplayView } }
  | { type: 'tournament_rescan' };

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
  | { type: 'manual_request'; payload: { slot: 0 | 1; aroundData: number[] } }
  /** null = この部屋に大会が紐付いていない */
  | { type: 'tournament_state'; payload: TournamentStatePayload | null };
