import type {
  OperatorDecisions,
  ResolvedParticipant,
  ServerStatusPayload,
  TournamentAutoPlay,
  TournamentDisplayView,
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

export interface Binding {
  roomId:       string;
  tournamentId: string;
  loaded:       LoadedTournament;
  armedMatchId: string | null;
  /** 観戦画面に出すもの。運営席の表示とは独立 (armedMatchId と同じくプロセス内の状態) */
  displayView:  TournamentDisplayView;
  /** 自動進行。armedMatchId と同じくプロセス内の状態なので bind のたびに切れている */
  autoPlay:     TournamentAutoPlay;
  /** 自動進行の判断材料。ServerManager の最新の status を持っておく */
  lastStatus:   ServerStatusPayload;
  /** 予約中の自動操作 (常に高々1つ) */
  autoTimer:    ReturnType<typeof setTimeout> | null;
  listener:     (st: ServerStatusPayload) => void;
  keepalive:    ReturnType<typeof setInterval>;
}

/** コマンドがルームと配信に触るための口。オーケストレータが自分を渡す */
export interface CommandEnv {
  rm: RoomManager;
  /** 状態を配信する。自動進行の次の一手もこの中で予約される */
  publish: (roomId: string) => void;
}

/** その部屋の ServerManager。ルームが消えていれば undefined */
export function managerOf(env: CommandEnv, b: Binding) {
  return env.rm.getRoom(b.roomId)?.manager;
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
  if (!b.armedMatchId) return;
  if (b.armedMatchId === matchId
    || downstreamOf(b.loaded.state.matches, matchId).has(b.armedMatchId)) {
    b.armedMatchId = null;
  }
}
