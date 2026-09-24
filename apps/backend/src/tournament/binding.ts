import type {
  OperatorDecisions,
  ResolvedParticipant,
  ServerStatusPayload,
  TournamentAutoPlay,
  TournamentBracketView,
  TournamentDisplayView,
  TournamentGroupView,
  TournamentMatch,
} from '@u15/ws-types';
import { isGroupStageDone } from '@u15/ws-types';
import type { RoomManager } from '../RoomManager.js';
import { downstreamOf, resolveMatches, type ResolveContext } from './progress.js';
import { resolveContextOf, saveState, type LoadedTournament } from './TournamentStore.js';

// 「ある部屋で運営中の大会」1つぶんの状態と、それを書き換える最小の操作。
//
// 運営コマンド (matchCommands / qualifierCommands / autoPlayRunner) はここだけを土台にする。
// 保存 (state.json) と巻き戻しの後始末をこの層に閉じておくと、コマンドを足すたびに
// 「保存し忘れ」「armed の落とし忘れ」を書いて回らずに済む。

/** 運営操作を断る理由。メッセージはそのまま運営パネルに出る */
export class TournamentError extends Error {}

/**
 * 対戦を実行する場所。**同時に走らせる試合の数だけ持つ。**
 *
 * `lanes[0]` が主レーンで、大会を bind した部屋そのもの。副レーンは運営が並列数を
 * 指定したときに作る追加の部屋で、BOT対戦予選の予選試合だけを流す (`canRunInSideLane`)。
 *
 * **「今その場所で何が起きているか」だけをレーンに持たせる。** 試合グラフ (`loaded`) と
 * 自動進行の設定 (`autoPlay`) は大会に1つ — レーンごとに持つと結果の書き戻し先が分かれて
 * state.json が食い違う。
 */
export interface Lane {
  /** このレーンが対戦に使う部屋。観戦画面はここへ join して盤面を受け取る */
  roomId:       string;
  /** 主レーンか。副レーンは運営が並列数を下げたときに破棄される */
  primary:      boolean;
  /** このレーンで準備中・対戦中の試合 */
  armedMatchId: string | null;
  /** 自動進行の判断材料。そのレーンの ServerManager の最新の status */
  lastStatus:   ServerStatusPayload;
  /** そのレーンで予約中の自動操作 (レーンごとに高々1つ) */
  autoTimer:    ReturnType<typeof setTimeout> | null;
  listener:     (st: ServerStatusPayload) => void;
}

export interface Binding {
  /** 主レーンの部屋。運営パネルと観戦画面はここへ join する */
  roomId:       string;
  tournamentId: string;
  loaded:       LoadedTournament;
  /** 対戦を実行するレーン。`lanes[0]` が主レーン。並列実行しなければ要素1つ */
  lanes:        Lane[];
  /** 観戦画面に出すもの。運営席の表示とは独立 (レーンと同じくプロセス内の状態) */
  displayView:  TournamentDisplayView;
  /** 観戦画面のトーナメント表の型。displayView とは別軸 */
  bracketView:  TournamentBracketView;
  /** 観戦画面の予選リーグ表で出すリーグ。displayView とは別軸 */
  groupView:    TournamentGroupView;
  /** 自動進行。プロセス内の状態なので bind のたびに切れている */
  autoPlay:     TournamentAutoPlay;
  keepalive:    ReturnType<typeof setInterval>;
}

/** コマンドがルームと配信に触るための口。オーケストレータが自分を渡す */
export interface CommandEnv {
  rm: RoomManager;
  /** 状態を配信する。自動進行の次の一手もこの中で予約される */
  publish: (roomId: string) => void;
}

/** その部屋の ServerManager。ルームが消えていれば undefined */
export function managerOf(env: CommandEnv, roomId: string) {
  return env.rm.getRoom(roomId)?.manager;
}

/**
 * 主レーン。**決勝トーナメントと、大会全体に効く一手はここでしか行わない**
 * (決勝進出者の確定・デモの作り直し)。副レーンが同じ判断を二重に出さないための基準点。
 */
export function primaryLane(b: Binding): Lane {
  return b.lanes[0]!;
}

/** その部屋を担当しているレーン */
export function laneOfRoom(b: Binding, roomId: string): Lane | undefined {
  return b.lanes.find(l => l.roomId === roomId);
}

/** その試合を抱えているレーン */
export function laneOfMatch(b: Binding, matchId: string): Lane | undefined {
  return b.lanes.find(l => l.armedMatchId === matchId);
}

/** いずれかのレーンが実行中の試合 id。次に配る試合の候補から外すのに使う */
export function armedMatchIds(b: Binding): Set<string> {
  return new Set(
    b.lanes.map(l => l.armedMatchId).filter((id): id is string => id !== null),
  );
}

export function requireMatch(b: Binding, matchId: string): TournamentMatch {
  const m = b.loaded.state.matches.find(x => x.id === matchId);
  if (!m) throw new TournamentError('試合が見つかりません');
  return m;
}

export function requireParticipant(ps: ResolvedParticipant[], id: string): ResolvedParticipant {
  const p = ps.find(x => x.id === id);
  if (!p) throw new TournamentError('参加者が見つかりません');
  return p;
}

export function nameOf(b: Binding, participantId: string): string {
  return b.loaded.def.participants.find(p => p.id === participantId)?.name ?? participantId;
}

/** group-rank と「運営を開始したか」を解くための文脈 */
export function ctxOf(b: Binding): ResolveContext {
  return resolveContextOf(b.loaded);
}

/**
 * その大会の文脈で試合グラフを解き直す。
 *
 * **運営中の経路はこれを通すこと。** 文脈を渡し忘れると予選の順位が解けず、
 * `started` も落ちて bye が未確定のまま残る (デモが完走しない・不戦勝が立たない)。
 */
export function resolveFor(b: Binding, matches: TournamentMatch[]): TournamentMatch[] {
  return resolveMatches(matches, Date.now(), ctxOf(b));
}

/**
 * 試合グラフを差し替えて保存する。
 *
 * 予選が「終わっていない」状態に戻ったら決勝進出者の確定も外す。取り消して入れ直せば
 * 順位が変わっているかもしれないので、確定はやり直してもらう。
 * **試合を書き換える経路はすべてここを通る**ので、巻き戻しの種類ごとに書かなくてよい。
 */
export function commit(b: Binding, matches: TournamentMatch[]): void {
  const state = { ...b.loaded.state, matches, updatedAt: Date.now() };
  if (state.decisions.qualifiersConfirmed && !isGroupStageDone(matches)) {
    state.decisions = { ...state.decisions, qualifiersConfirmed: false };
  }
  b.loaded = { ...b.loaded, state };
  saveState(b.loaded.state);
}

/** 運営の判断 (state.json の decisions) を書き換える。保存は呼び出し側が行う */
export function decide(b: Binding, patch: (d: OperatorDecisions) => OperatorDecisions): void {
  b.loaded = {
    ...b.loaded,
    state: { ...b.loaded.state, decisions: patch(b.loaded.state.decisions), updatedAt: Date.now() },
  };
}

export function updateMatch(
  b: Binding, matchId: string, fn: (m: TournamentMatch) => TournamentMatch,
): void {
  commit(b, b.loaded.state.matches.map(m => (m.id === matchId ? fn(m) : m)));
}

/**
 * 巻き戻しで準備済みの試合まで消えたら、armed の記録も落とす。
 *
 * armedMatchId は ServerManager のスロット割り当てと対になっている。グラフ側だけ
 * pending に戻ると、statusBridge が「pending の試合を対戦中にする」という
 * 辻褄の合わない遷移をしてしまう。
 */
export function disarmIfCleared(b: Binding, matchId: string): void {
  if (b.lanes.every(l => l.armedMatchId === null)) return;
  const downstream = downstreamOf(b.loaded.state.matches, matchId);
  for (const lane of b.lanes) {
    if (!lane.armedMatchId) continue;
    if (lane.armedMatchId === matchId || downstream.has(lane.armedMatchId)) {
      lane.armedMatchId = null;
    }
  }
}
