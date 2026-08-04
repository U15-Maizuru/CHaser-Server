// 大会運営 (トーナメント / リーグ) の共有型。
//
// 用語 (docs/developer-manual.md §0 の対応表に従う):
//   ゲーム (round) = 1回の対戦             … RoundResult
//   試合   (set)   = 先後入替の2ゲーム     … SetResult / TournamentMatch
//   トーナメント/リーグ = 試合の連なり     … TournamentDefinition
//
// TournamentMatch の `match` は公式用語の「試合」を指し、既存の `set` と同じ粒度。
// ブラケット上のノードとして自然な語なのでこちらを使う。
// 回戦・節に `round` を使うと RoundResult.round (ゲーム番号 0|1) と同名で別軸になるため、
// `stage` という別名にしている。

import type { RoundResult } from './protocol.js';
import type { SetResult } from './scoring.js';

// --- 大会の定義 (tournament.json) ---

export type TournamentFormat = 'single-elimination' | 'league';

export interface LeaguePoints {
  win:  number;
  draw: number;
  loss: number;
}

export interface TournamentRules {
  /** 1試合を先後入替の2ゲームで行うか (公式ルールの既定。false は練習・リハーサル用) */
  doubleMode:       boolean;
  /** 大会全体で固定マップを使う場合のマップライブラリ ID */
  mapCatalogId:     string | null;
  /**
   * single-elimination のみ: 回戦 (stage) ごとのマップ。index が stage、null は
   * 「大会の設定 (mapCatalogId) に従う」。3位決定戦は決勝と同じ stage なので決勝と同じマップになる。
   */
  stageMaps:        (string | null)[];
  /** single-elimination のみ: 3位決定戦を行うか */
  thirdPlaceMatch:  boolean;
  /** league のみ: 勝ち点 (公式ルールは 勝利3 / 引き分け1 / 敗北0) */
  leaguePoints:     LeaguePoints;
  /** league のみ: 2回総当たりにするか */
  doubleRoundRobin: boolean;
}

/** 参加プログラムの指定方法。null は「未提出」(当日 tournament_assign_program で紐付ける) */
export type ParticipantProgram =
  | { kind: 'file';    file: string; displayName?: string }
  | { kind: 'builtin'; builtin: 'cpu' }
  | null;

export interface ParticipantDef {
  id:      string;
  name:    string;
  /** 組み合わせ表の選手番号。小さいほど第1ゲームで先攻になる。省略時は記載順 */
  seed?:   number;
  program: ParticipantProgram;
}

export interface TournamentDefinition {
  formatVersion: number;
  id:            string;
  name:          string;
  format:        TournamentFormat;
  rules:         TournamentRules;
  participants:  ParticipantDef[];
  /** 明示的な1回戦の並び。長さは2の冪、null は bye。省略時はシード順から自動生成 */
  bracket?:      { size: number; slots: (string | null)[] };
  /** 明示的な対戦カード。省略時は総当たりを自動生成 */
  schedule?:     { pairs: [string, string][] };
}

// --- 組み合わせの配置 (純関数) ---
//
// 試合グラフの組み立て本体は apps/backend/src/tournament/bracket.ts にあるが、
// 「1回戦をどう並べるか」の規則だけはここに置いて frontend と共有する。
// 大会データ作成 UI の組み合わせ編集が、サーバーが自動生成するのと寸分違わぬ並びを
// 初期値として見せる必要があるため (二重定義するとズレて必ず事故になる)。

/**
 * 標準シード順の位置並び。order(1)=[1], order(2n)=interleave(order(n), 2n+1-order(n))。
 * size=8 なら [1,8,4,5,2,7,3,6] — 第1シードと第2シードが決勝まで当たらない配置になる。
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

/** 参加者数を収める最小の2の冪。これにより bye 同士のカードが構造的に発生しない */
export function bracketSizeFor(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return Math.max(size, 1);
}

/** 回戦の数 (= 決勝までの stage 数)。size=8 なら 3 (1回戦・準決勝・決勝) */
export function stageCountFor(participantCount: number): number {
  const size = bracketSizeFor(participantCount);
  return size < 2 ? 0 : Math.log2(size);
}

/**
 * 回戦の名前。後ろから数えて決勝・準決勝・準々決勝、それ以前は「N回戦」。
 *
 * 試合グラフの組み立て (backend/tournament/bracket.ts) と、大会データ作成 UI の
 * 「回戦ごとのマップ」欄が同じ名前を出す必要があるのでここに置く。
 */
export function stageLabel(stage: number, totalStages: number): string {
  const fromLast = totalStages - 1 - stage;
  if (fromLast === 0) return '決勝';
  if (fromLast === 1) return '準決勝';
  if (fromLast === 2) return '準々決勝';
  return `${stage + 1}回戦`;
}

// --- 試合グラフ ---

export type MatchSlotRef =
  | { kind: 'participant'; participantId: string }
  | { kind: 'winner-of';   matchId: string }
  | { kind: 'loser-of';    matchId: string }   // 3位決定戦
  | { kind: 'bye' };

export type MatchStatus =
  | 'pending'           // 対戦相手がまだ確定していない
  | 'ready'             // 両者確定。arm できる
  | 'armed'             // スロットへ割り当て済み。運営が「ゲームスタート」を押すのを待っている
  | 'in_progress'       // 対戦中
  | 'awaiting_confirm'  // 全ゲーム終了。運営の確定待ち
  | 'done';             // 確定済み

/** 試合の決着理由。SetResult['decidedBy'] を包含し、運営裁定ぶんを足した別 union */
export type MatchDecidedBy = 'wins' | 'points' | 'walkover' | 'manual';

export interface TournamentMatchResult {
  /** 実施したゲーム (1 or 2)。既存のゲーム結果型をそのまま持つ */
  roundResults: RoundResult[];
  /** computeSetResult() の戻りを丸ごと保持する (改変しない) */
  set:          SetResult | null;
  decidedBy:    MatchDecidedBy;
  /** 勝者の side。両者棄権なら null */
  winnerSide:   0 | 1 | null;
  /** 手動決着の理由 (審判裁定 / 抽選 など) */
  note?:        string;
  /** 全ゲーム終了を検知した時刻 */
  capturedAt:   number;
  /** 運営が確定した時刻 */
  confirmedAt?: number;
}

export interface TournamentMatch {
  id:        string;   // 'R1M1' / 'SF1' / 'FINAL' / 'THIRD' / 'L-D1M2'
  stage:     number;   // トーナメント: 回戦 (0始まり)  リーグ: 節 (0始まり)
  label:     string;   // '1回戦 第1試合' / '準決勝' / '3位決定戦' / '第2節 第1試合'
  order:     number;   // 同一 stage 内の表示順
  slotA:     MatchSlotRef;   // side 0 (第1ゲームの COOL = 先攻)
  slotB:     MatchSlotRef;   // side 1 (第1ゲームの HOT  = 後攻)
  resolvedA: string | null;  // 確定した participantId。bye/未確定なら null
  resolvedB: string | null;
  byeA:      boolean;
  byeB:      boolean;
  status:    MatchStatus;
  result?:   TournamentMatchResult;
  /** 同点再試合で運営が選び直したマップ。次の arm で loadMap する */
  rematchMapCatalogId?: string;
}

/**
 * 敗者同士の試合 (3位決定戦)。
 *
 * 勝者戦 (決勝) と同じ stage に置かれるが、参照するのは前の stage の敗者なので
 * 依存関係は無く、どちらを先に実施してもよい。実施順は compareByPlayOrder が決める。
 */
export function isConsolationMatch(m: TournamentMatch): boolean {
  return m.slotA.kind === 'loser-of' || m.slotB.kind === 'loser-of';
}

/**
 * 実施順の比較。stage → (敗者戦が先) → order の昇順。
 *
 * **3位決定戦は決勝より先に実施する。** 決勝を大会の締めくくりにするための運営順で、
 * 両者に依存関係が無いから選べる順序でもある。
 *
 * `order` を入れ替えないのは、それが「同一 stage 内の表示順」だから —
 * トーナメント表では決勝が上、3位決定戦がその下に来るのが通例で、
 * 実施順と表示順は別物として扱う。
 */
export function compareByPlayOrder(a: TournamentMatch, b: TournamentMatch): number {
  if (a.stage !== b.stage) return a.stage - b.stage;
  const ca = isConsolationMatch(a) ? 0 : 1;
  const cb = isConsolationMatch(b) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  return a.order - b.order;
}

// --- 配信ペイロード ---

export interface ResolvedParticipant {
  id:                string;
  name:              string;
  seed:              number;
  /** プログラムライブラリのエントリ ID。未提出なら null */
  programCatalogId:  string | null;
  /** 内蔵 CPU を使う参加者 */
  builtinCpu:        boolean;
  /** 表示用のプログラム名 */
  programName:       string | null;
}

export interface StandingRow {
  participantId: string;
  played:        number;
  wins:          number;
  draws:         number;
  losses:        number;
  /** 勝ち点 (leaguePoints による) */
  points:        number;
  /** 全試合の合計ポイント (競技ルールの「ポイント」) */
  totalPoints:   number;
  rank:          number;
  /** 直接対決でも並び、同順位になった */
  tied:          boolean;
}

export interface TournamentSummary {
  id:           string;
  name:         string;
  format:       TournamentFormat;
  participants: number;
  /** 確定済みの試合数 / 全試合数 */
  progress:     [number, number];
  /** 現在どの部屋で運営中か */
  boundRoomId:  string | null;
}

export interface TournamentStatePayload {
  tournamentId: string;
  name:         string;
  format:       TournamentFormat;
  rules:        TournamentRules;
  participants: ResolvedParticipant[];
  matches:      TournamentMatch[];
  /** league のときのみ */
  standings:    StandingRow[] | null;
  /**
   * 回戦ごとの実効マップ (index = stage)。定義の rules.stageMaps に運営中の差し替えを
   * 重ねた結果で、null は「大会の設定 (rules.mapCatalogId) に従う」。
   * 表示・判定はこれだけを見ればよく、UI 側で解決順を再現しなくてよい。
   */
  stageMaps:    (string | null)[];
  armedMatchId: string | null;
  boundRoomId:  string;
  updatedAt:    number;
}

/** 永続化される進行状態 (server/tournament/<id>/state.json) */
export interface TournamentState {
  tournamentId: string;
  matches:      TournamentMatch[];
  /** participantId → プログラムライブラリのエントリ */
  programs:     Record<string, { catalogId: string; sha256: string } | undefined>;
  /**
   * 運営中に差し替えた回戦ごとのマップ (キーは stage の10進表記)。
   * catalogId はこの PC のライブラリでしか通じないので、programs と同じく
   * 配布物である tournament.json ではなくこちら側に持つ。
   */
  stageMapOverrides?: Record<string, string | null>;
  updatedAt:    number;
}
