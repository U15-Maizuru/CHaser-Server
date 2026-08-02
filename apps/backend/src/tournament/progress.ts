import type {
  MatchSlotRef,
  TournamentMatch,
  TournamentMatchResult,
} from '@u15/ws-types';
import { compareByPlayOrder } from '@u15/ws-types';

// 試合グラフの進行 (slot の解決・bye の自動確定・確定の取り消し) を行う純関数。
// 入力の配列は破壊せず、常に新しい配列を返す。

/** 確定済みの試合の勝者 participantId。両者棄権・bye 同士なら null */
function winnerOf(m: TournamentMatch): string | null {
  if (m.status !== 'done' || !m.result) return null;
  if (m.result.winnerSide === 0) return m.resolvedA;
  if (m.result.winnerSide === 1) return m.resolvedB;
  return null;
}

/** 確定済みの試合の敗者 participantId (3位決定戦用) */
function loserOf(m: TournamentMatch): string | null {
  if (m.status !== 'done' || !m.result) return null;
  if (m.result.winnerSide === 0) return m.resolvedB;
  if (m.result.winnerSide === 1) return m.resolvedA;
  return null;
}

interface Resolved { id: string | null; bye: boolean; known: boolean }

function resolveSlot(ref: MatchSlotRef, byId: Map<string, TournamentMatch>): Resolved {
  switch (ref.kind) {
    case 'participant':
      return { id: ref.participantId, bye: false, known: true };
    case 'bye':
      return { id: null, bye: true, known: true };
    case 'winner-of': {
      const src = byId.get(ref.matchId);
      if (!src || src.status !== 'done') return { id: null, bye: false, known: false };
      const w = winnerOf(src);
      // 勝者がいない (両者棄権/bye同士) 場合は、この枠自体が bye として下流へ伝わる
      return { id: w, bye: w === null, known: true };
    }
    case 'loser-of': {
      const src = byId.get(ref.matchId);
      if (!src || src.status !== 'done') return { id: null, bye: false, known: false };
      const l = loserOf(src);
      return { id: l, bye: l === null, known: true };
    }
  }
}

/** オーケストレータが管理する実行中ステータス。resolve では上書きしない */
const RUNTIME_STATUSES = new Set(['armed', 'in_progress']);

/**
 * 全試合の slot を解決し、bye による不戦勝を自動確定し、status を更新する。
 *
 * 上流の結果が下流へ伝播するので、stage 昇順・order 昇順に1パスで解ける
 * (winner-of / loser-of は必ず自分より前の stage を指す)。
 * 3位決定戦だけは決勝と同じ stage に置いてあるが、参照先は準決勝 (前の stage) なので問題ない。
 */
export function resolveMatches(matches: TournamentMatch[], now = Date.now()): TournamentMatch[] {
  const sorted = [...matches].sort((a, b) => a.stage - b.stage || a.order - b.order);
  const byId   = new Map<string, TournamentMatch>();
  const out    = new Map<string, TournamentMatch>();

  for (const src of sorted) {
    const m: TournamentMatch = { ...src };
    const ra = resolveSlot(m.slotA, byId);
    const rb = resolveSlot(m.slotB, byId);

    m.resolvedA = ra.id;
    m.resolvedB = rb.id;
    m.byeA      = ra.known && ra.bye;
    m.byeB      = rb.known && rb.bye;

    const bothKnown = ra.known && rb.known;

    if (!m.result && bothKnown && (m.byeA || m.byeB)) {
      // 不戦勝。相手がいないので対戦は行わず、その場で確定させる
      const winnerSide: 0 | 1 | null =
        m.byeA && m.byeB ? null : m.byeA ? 1 : 0;
      m.result = {
        roundResults: [],
        set:          null,
        decidedBy:    'walkover',
        winnerSide,
        capturedAt:   now,
        confirmedAt:  now,
      };
      m.status = 'done';
    } else if (m.result?.confirmedAt) {
      m.status = 'done';
    } else if (m.result) {
      m.status = 'awaiting_confirm';
    } else if (!bothKnown) {
      m.status = 'pending';
    } else if (RUNTIME_STATUSES.has(m.status)) {
      // armed / in_progress はオーケストレータの管理下。そのまま残す
    } else {
      m.status = 'ready';
    }

    byId.set(m.id, m);
    out.set(m.id, m);
  }

  // 呼び出し元が期待する並び (入力順) を保つ
  return matches.map(m => out.get(m.id) ?? m);
}

/** 試合に結果を書き込む (確定はしない)。confirmResult を経て done になる */
export function captureResult(
  matches: TournamentMatch[], matchId: string, result: TournamentMatchResult,
): TournamentMatch[] {
  return resolveMatches(
    matches.map(m => (m.id === matchId ? { ...m, result, status: 'awaiting_confirm' as const } : m)),
  );
}

/**
 * 結果を確定して勝者を下流へ伝播する。
 * winnerSide の上書き (同点時の手動決着) にも使う。
 */
export function confirmResult(
  matches: TournamentMatch[],
  matchId: string,
  patch: { winnerSide?: 0 | 1 | null; decidedBy?: TournamentMatchResult['decidedBy']; note?: string },
  now = Date.now(),
): TournamentMatch[] {
  return resolveMatches(matches.map(m => {
    if (m.id !== matchId || !m.result) return m;
    const result: TournamentMatchResult = {
      ...m.result,
      winnerSide:  patch.winnerSide !== undefined ? patch.winnerSide : m.result.winnerSide,
      decidedBy:   patch.decidedBy  ?? m.result.decidedBy,
      note:        patch.note       ?? m.result.note,
      confirmedAt: now,
    };
    return { ...m, result, status: 'done' as const };
  }), now);
}

/** 運営裁定で不戦勝・両者棄権にする (対戦を行わずに確定させる) */
export function setWalkover(
  matches: TournamentMatch[], matchId: string, winnerSide: 0 | 1 | null, now = Date.now(),
): TournamentMatch[] {
  return resolveMatches(matches.map(m => {
    if (m.id !== matchId) return m;
    const result: TournamentMatchResult = {
      roundResults: [],
      set:          null,
      decidedBy:    'walkover',
      winnerSide,
      capturedAt:   now,
      confirmedAt:  now,
    };
    return { ...m, result, status: 'done' as const };
  }), now);
}

/** 結果を捨てて未実施に戻す (やり直し / 同点の再試合)。下流も巻き戻す */
export function discardResult(
  matches: TournamentMatch[], matchId: string, rematchMapCatalogId?: string,
): TournamentMatch[] {
  const cleared = clearFrom(matches, matchId, true);
  return resolveMatches(cleared.map(m => (
    m.id === matchId && rematchMapCatalogId ? { ...m, rematchMapCatalogId } : m
  )));
}

/** ある試合に (推移的に) 依存する試合の ID 集合。自分自身は含まない */
export function downstreamOf(matches: TournamentMatch[], matchId: string): Set<string> {
  const sorted = [...matches].sort((a, b) => a.stage - b.stage || a.order - b.order);
  const hit    = new Set<string>([matchId]);
  const out    = new Set<string>();

  for (const m of sorted) {
    const refs = [m.slotA, m.slotB];
    const depends = refs.some(r =>
      (r.kind === 'winner-of' || r.kind === 'loser-of') && hit.has(r.matchId));
    if (depends && m.id !== matchId) {
      hit.add(m.id);
      out.add(m.id);
    }
  }
  return out;
}

/**
 * 下流に「失われては困る確定済みの結果」があるか (reopen で cascade が必要かの判定)。
 *
 * bye による自動確定は除く — 巻き戻しても resolveMatches が同じ結果に組み直すので、
 * 運営が失うものが無い。一方、運営が裁定した不戦勝 (bye でない walkover) は数える。
 */
export function hasConfirmedDownstream(matches: TournamentMatch[], matchId: string): boolean {
  const ds = downstreamOf(matches, matchId);
  return matches.some(m =>
    ds.has(m.id) && m.status === 'done' && !(m.byeA || m.byeB));
}

/** 確定を取り消す。下流の結果もまとめて消す */
export function reopenMatch(matches: TournamentMatch[], matchId: string): TournamentMatch[] {
  return resolveMatches(clearFrom(matches, matchId, true));
}

function clearFrom(
  matches: TournamentMatch[], matchId: string, includeSelf: boolean,
): TournamentMatch[] {
  const ds = downstreamOf(matches, matchId);
  return matches.map(m => {
    const target = (includeSelf && m.id === matchId) || ds.has(m.id);
    if (!target) return m;
    const next: TournamentMatch = { ...m, status: 'pending' };
    delete next.result;
    delete next.rematchMapCatalogId;
    return next;
  });
}

/** 次に実施すべき試合 (ready のうち実施順が最も早いもの。3位決定戦は決勝より先) */
export function nextReadyMatch(matches: TournamentMatch[]): TournamentMatch | null {
  return [...matches]
    .filter(m => m.status === 'ready')
    .sort(compareByPlayOrder)[0] ?? null;
}
