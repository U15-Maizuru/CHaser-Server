// WebSocket プロトコルの基本型と enum。バックエンド・フロントエンド共用。
// Do NOT duplicate these in apps/backend or apps/frontend.
//
// このファイルは他のどのモジュールも import しない (依存の根)。enum は実行時オブジェクト
// として実体化されるため、scoring.ts のようにここから値を参照するモジュールと index.ts が
// 相互参照になると初期化順の事故を招く。それを構造的に避けるために分離してある。

export interface Point { x: number; y: number }

// ゲーム開始時のカウントダウン秒数 (フロント表示・バックエンドのターン開始待機の両方で使う単一情報源)
export const START_COUNTDOWN_SECONDS = 3;

// Protocol enums (values must match the game engine integers)
export enum MapObject {
  NOTHING = 0,
  TARGET  = 1,
  BLOCK   = 2,
  ITEM    = 3,
}

/** アラウンドデータの1桁目。ゲームを続けるか終わるかをクライアントへ伝えるワイヤ値 */
export enum ConnectingStatus {
  FINISHED = 0,
  CONTINUE = 1,
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

export enum Action {
  WALK    = 0,
  LOOK    = 1,
  SEARCH  = 2,
  PUT     = 3,
  GETREADY = 4,
  UNKNOWN = 5,
}

export enum Rote {
  UP      = 0,
  DOWN    = 1,
  RIGHT   = 2,
  LEFT    = 3,
  UNKNOWN = 4,
}

// --- Game state ---

/**
 * 直近に実行された LOOK / SEARCH が調べた範囲。盤面演出専用のデータで、
 * ゲームロジックには影響しない。マスの座標はサーバー側で確定させて送るため、
 * フロントは探索範囲の幾何を知らなくてよい。
 */
export interface ScanInfo {
  team:   0 | 1;
  action: Action.LOOK | Action.SEARCH;
  rote:   Rote;
  /**
   * 9要素。自機から近い順に並ぶ (SEARCH は 1 マスずつ、LOOK は 3 マスずつが同じ距離の帯)。
   * クライアントに返る AroundData の順序 (絶対座標 row-major) とは別物。
   * 盤外の座標も含むので描画側で境界チェックすること
   */
  cells:  Point[];
}

export interface GameStateSnapshot {
  field: MapObject[][];
  size: Point;
  teamPos: [Point, Point];
  teamScore: [number, number];
  turnCount: number;
  leaveItems: number;
  playerNames: [string, string];
  /** このターンに LOOK/SEARCH が行われた場合のみ非 null */
  lastScan?: ScanInfo | null;
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

// --- 2ゲーム制: ゲーム結果 ---

export interface RoundResult {
  round:          0 | 1;
  winner:         Winner;
  reason:         Reason;
  /** 各プレイヤーの取得アイテム数 (COOL, HOT の順) */
  scores:         [number, number];
  remainingTurns: number;
  /**
   * 「一撃」— アタック/閉じ込めで勝った側への加点、自滅(自縛/衝突/通信エラー)で
   * 負けた側への罰点。決着理由は排他なので、1ゲームでどちらか一方だけが入る。
   * 係数と計算は scoring.ts の calculateBonusBreakdown にある
   */
  strikeBonus:    [number, number];
  /** 「総取り」— 勝者に、決着時点の残アイテム数に応じたボーナス (scoring.ts 参照) */
  sweepBonus:     [number, number];
  /** ゲーム開始時のプレイヤー名 */
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
  /** 現在のマップがどのソース由来か (選択状態そのもの)。全コントロール窓で共有される */
  mapSource:    MapSourceInfo;
  /** 観戦画面の表示・音声設定。コントロールパネルが決め、全観戦画面 (Electron / ブラウザ) に配信される */
  displayPrefs: DisplayPrefs;
}

/**
 * 観戦画面 (display window / ブラウザ観戦) の表示・音まわりの設定。
 * コントロールパネルが送り、サーバーが真実を持つ (`ServerStatusPayload.displayPrefs`)。
 * ダークモードと同じ理由でクライアントにキャッシュを持たない — ローカルの `localStorage` に
 * 置くと、観戦画面を複数ウィンドウ/複数端末で開いたときに互いに反映されない。
 */
export interface DisplayPrefs {
  muted:          boolean; // SE ミュート
  bgmMuted:       boolean; // BGM ミュート (SE 用の muted とは別)
  // 場面ごとに選ぶ BGM のファイル名 ('none' = 再生しない)。決着後 (result) を接続待ちと
  // 分けているのは、決着した盤面を見せる時間と次のプログラムを待つ時間とで会場の空気が
  // 違うため。大会の待機表 (standby) は接続待ちと同じ曲でよい
  bgmTrack:       string; // 対戦中
  bgmTrackWait:   string; // 接続待ち・大会待機中
  bgmTrackResult: string; // ゲーム終了 (決着した盤面を見せている間)
  bgmTrackAward:  string; // 表彰
  theme:        string;  // 'Jewel' | 'Light' | 'Heavy' | 'RPG'
  displayTitle: string;  // 観戦/表示画面のタイトル文字列
  // ダークモードで盤面を覆う幕の濃さ (0-1)。同じ濃さでも会場のプロジェクタ/照明では
  // 白く飛んだり真っ暗になったりするため、投影環境に合わせて調整できるようにしている
  veilAlpha:    number;
}

export const VEIL_ALPHA_MIN     = 0.2;
export const VEIL_ALPHA_MAX     = 0.95;
export const VEIL_ALPHA_DEFAULT = 0.55; // 視界と探索範囲だけが見える演出を保ちつつ、盤面全体の形は読める濃さ

export const DEFAULT_DISPLAY_PREFS: Readonly<DisplayPrefs> = {
  muted:          false,
  bgmMuted:       false,
  bgmTrack:       'none',
  bgmTrackWait:   'none',
  bgmTrackResult: 'none',
  bgmTrackAward:  'none',
  theme:          'Jewel',
  displayTitle:   'CHaser Server',
  veilAlpha:      VEIL_ALPHA_DEFAULT,
};

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
  /**
   * プログラムのソースから読み取った、そのプログラムが名乗るプレイヤー名
   * (= 対戦画面のスコアバーに出る名前)。大会エディタでプレイヤー名の初期値に使う。
   * ソースに書かれていなければ undefined。
   */
  declaredName?:  string;
}

/** 現在のマップの出どころ。'random' のときだけリセット・リピートで引き直す */
export type MapSourceKind = 'random' | 'catalog' | 'editor';

export interface MapSourceInfo {
  kind:         MapSourceKind;
  /** kind==='catalog' のとき: 選択中のマップライブラリのエントリ */
  catalogId?:   string;
  displayName?: string;
}

export interface MapParams {
  itemNum:  number;
  blockNum: number;
  turnNum:  number;
  mirror:   boolean;
  /** 省略時はバックエンド側で既定サイズ (15×17) を使用する */
  size?:    Point;
}

/**
 * ランダムマップ生成の既定パラメータ。
 *
 * バックエンドの生成関数 (GameSystem.createRandomMap)、ルームの初期マップ (MapManager)、
 * ステートレス生成の HTTP ルート、フロントエンドの入力欄の初期値がそれぞれ同じ数字を
 * 持っていて、片方だけ変えると「設定を送る前と後で盤面が違う」形で食い違う。
 */
export const DEFAULT_MAP_PARAMS: Readonly<Omit<MapParams, 'size'>> = {
  itemNum:  51,
  blockNum: 20,
  turnNum:  100,
  mirror:   true,
};

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

// --- Room / lobby ---

export interface RoomSummary {
  id:        string;
  phase:     ServerPhase;
  ports:     [number, number];
  createdAt: number;
}
