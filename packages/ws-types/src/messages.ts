// WebSocket でやりとりするメッセージの union。
// protocol.ts / tournament.ts の型を参照するので、依存の順は protocol → tournament → messages。

import type {
  AnnouncementState,
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
import type {
  AutoPlayTieBreak, TournamentDisplayView, TournamentStatePayload,
} from './tournament.js';

// --- Commands (Frontend → Backend) ---

export type FrontendMessage =
  | { type: 'set_client';        payload: { slot: 0 | 1; clientType: ClientType; processConfig?: ProcessConfig } }
  | { type: 'delete_program';    payload: { slot: 0 | 1 } }
  | { type: 'request_start' }
  | { type: 'request_reset' }
  | { type: 'load_map';          payload: { catalogId: string } }
  | { type: 'set_map_params';    payload: MapParams }
  | { type: 'load_map_data';     payload: InlineMapData }
  /** マップ管理画面からの手動プレビュー。対戦設定 (load_map) には影響しない。null で解除 */
  | { type: 'preview_map';       payload: { mapId: string | null } }
  | { type: 'set_double_mode';   payload: { enabled: boolean } }
  | { type: 'set_repeat_mode';   payload: { enabled: boolean } }
  | { type: 'set_demo_mode';     payload: { enabled: boolean } }
  | { type: 'set_turn_delay';    payload: { ms: number } }
  | { type: 'set_tcp_timeout';   payload: { ms: number } }
  | { type: 'set_ports';         payload: { ports: [number, number] } }
  | { type: 'set_log_dir';       payload: { dir: string } }
  | { type: 'set_python_command'; payload: { command: string } }
  | { type: 'request_next_round' }
  | { type: 'request_repeat' }
  | { type: 'set_dark_mode';     payload: { enabled: boolean } }
  | { type: 'set_display_prefs'; payload: Partial<DisplayPrefs> }
  /**
   * 観客席に出す運営アナウンス。文面 (title/body) と表示 (visible) を別々に送れる
   * ように差分で受ける — 出したまま文面だけ直す・文面を残したまま消す、の両方をするため
   */
  | { type: 'set_announcement';  payload: Partial<AnnouncementState> }
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
  /** 先攻・後攻の入れ替え。ready の試合だけに効く (armMatch 前まで) */
  | { type: 'tournament_swap_sides';      payload: { matchId: string } }
  /** 回戦 (stage) ごとのマップ差し替え。null は「大会の設定に従う」 */
  | { type: 'tournament_set_stage_map';   payload: { stage: number; mapCatalogId: string | null } }
  /**
   * 試合ごとのマップ差し替え (3位決定戦のみ)。決勝と同じ stage を共有するため、
   * stage 単位の指定では書き分けられない。null は「決勝と同じマップに戻す」
   */
  | { type: 'tournament_set_match_map';   payload: { matchId: string; mapCatalogId: string | null } }
  /** 決勝進出者の手動差し替え。participantId: null は「自動判定に戻す」 */
  | { type: 'tournament_set_qualifier';   payload: { group: number; rank: number; participantId: string | null; cascade?: boolean } }
  /**
   * 最終決定確認リストからの削除 / 取り消し。削除された人を除いた順位で決勝進出者が決まる。
   * 同ポイントで並んだボーダーを運営が決めるための操作
   */
  | { type: 'tournament_exclude_qualifier'; payload: { participantId: string; excluded: boolean; cascade?: boolean } }
  /** 決勝進出者の確定。true になるまで観戦画面は予選の最終結果を出し続ける */
  | { type: 'tournament_confirm_qualifiers'; payload: { confirmed: boolean } }
  /** 観戦画面に出すものを切り替える (運営席の表示とは連動しない) */
  | { type: 'tournament_set_display_view'; payload: { view: TournamentDisplayView } }
  /**
   * 自動進行の切り替え。`loop` は「全試合が終わったら最初からやり直す」(デモモード)、
   * `announce` は「次の試合を準備する前にアナウンス画面を挟む」、
   * `tieBreak` は「勝ち上がりの同点で止まる / 抽選で決めて続ける」。
   * 省略した項目は今の設定を保つ (どれか1つだけを押せるようにするため)
   */
  | { type: 'tournament_set_auto_play';   payload: { enabled: boolean; loop?: boolean; announce?: boolean; tieBreak?: AutoPlayTieBreak } }
  /**
   * 同時に走らせる試合の数 (レーン数)。1 なら1試合ずつ順に実行する。
   *
   * 2 以上にできるのは BOT対戦予選のある大会だけで、増やした副レーンには予選試合しか
   * 流れない (`canRunInSideLane`)。レーンごとにルームと TCP ポート対を確保するので、
   * どのレーンも空いているときにしか変更できない
   */
  | { type: 'tournament_set_lane_count';  payload: { count: number } }
  /** 空いているレーンへ、次に実施すべき試合をまとめて配る (並列実行の運営操作) */
  | { type: 'tournament_arm_next' }
  /**
   * 準備済みのレーンをまとめて開始する。
   *
   * コントロール窓は主レーンの部屋にしか開かないので、**副レーンの「ゲームスタート」は
   * 運営パネルからしか押せない。** 並列実行中の開始操作はこれ1つにまとめる
   */
  | { type: 'tournament_start_lanes' }
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
