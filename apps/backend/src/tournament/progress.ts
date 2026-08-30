import type {
  LeaguePoints,
  MatchSlotRef,
  TournamentMatch,
  TournamentMatchResult,
} from '@u15/ws-types';
import { DEFAULT_LEAGUE_POINTS } from '@u15/ws-types';
import { qualifierKey, resolveGroupRank } from './qualifiers.js';
import type { StandingsRankBy } from './standings.js';

// 試合グラフの進行 (slot の解決・bye の自動確定・確定の取り消し) を行う純関数。
// 入力の配列は破壊せず、常に新しい配列を返す。

/**
 * `group-rank` (予選リーグの N 位) を解く材料。予選を持たない大会では空でよい。
 *
 * resolveMatches は captureResult / confirmResult / discardResult / setWalkover /
 * reopenMatch のすべてから内部で呼ばれるので、この文脈もその全部を素通しで流れる。
 */
export interface ResolveContext {
  /** group番号 → 参加者id (エントリー順)。順位計算の決定性はこの並びに依存する */
  groups?:             string[][];
  leaguePoints?:       LeaguePoints;
  /** 運営が差し替えた決勝進出者 (キーは `"<group>:<rank>"`) */
  qualifierOverrides?: Record<string, string | null>;
  /** 順位の付け方。予選リーグは勝ち点制、BOT対戦予選はポイント制 */
  rankBy?:             StandingsRankBy;
  /** 運営が最終決定確認リストから削除した参加者。順位表から除いて繰り上げる */
  qualifierExclusions?: readonly string[];
  /**
   * 大会運営を開始しているか (`TournamentState.startedAt !== null`)。**省略時は true。**
   *
   * false の間は bye の不戦勝を確定させない — 開始前の大会を「もう3試合終わっている」
   * ことにしないため。上がる選手が次の回戦に現れること自体は変わらない
   * (`resolveSlot` が不戦の枠を確定前でも解く)。
   *
   * 既定を true にしてあるのは**運営中の経路がすべて既定側**だから。開始前の状態を
   * 作るのは `buildMatches` (新規作成・リセット) だけなので、そこだけが false を渡す。
   */
  started?:             boolean;
}

/** rematchPending を落とした複製。「もう再試合待ちではない」経路 (確定・巻き戻し) で使う */
function withoutRematchPending(m: TournamentMatch): TournamentMatch {
  const next = { ...m };
  delete next.rematchPending;
  return next;
}

/** 枠を解いた結果。`known` が false なら「まだ分からない」(下流は pending のまま) */
interface Resolved { id: string | null; bye: boolean; known: boolean }

const UNKNOWN: Resolved = { id: null, bye: false, known: false };

/**
 * 対戦を行わずに決まる勝者。不戦の枠 (片側が bye) でだけ返り、それ以外は null。
 *
 * `winnerOf` と違って**確定 (`status === 'done'`) を要求しない** — 相手がいないので
 * 誰が上がるかは組み合わせが決まった時点で分かっている。運営開始前 (`started=false`) の
 * 大会でトーナメント表の次の回戦を埋めるのに使う。
 */
function walkoverWinnerOf(m: TournamentMatch): Resolved | null {
  if (!m.byeA && !m.byeB) return null;
  if (m.byeA && m.byeB)   return { id: null, bye: true, known: true };
  return { id: m.byeA ? m.resolvedB : m.resolvedA, bye: false, known: true };
}

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

function resolveSlot(
  ref: MatchSlotRef, byId: Map<string, TournamentMatch>, ctx: ResolveContext,
): Resolved {
  switch (ref.kind) {
    case 'participant':
      return { id: ref.participantId, bye: false, known: true };
    case 'bye':
      return { id: null, bye: true, known: true };
    case 'group-rank': {
      const groupIds = ctx.groups?.[ref.group];
      // 文脈が無いなら「まだ分からない」に倒す。空配列として扱うと参加者0人と読めてしまい、
      // 不戦勝として勝手に確定してしまう (文脈を渡し忘れた経路で静かに大会が壊れる)
      if (groupIds === undefined) return UNKNOWN;
      // **byId から取ること。** 引数の matches をそのまま見ると、このパスで bye が
      // 自動確定したぶんや、まだ resolvedA/B が埋まっていない組み立て直後の状態を読んでしまう。
      // 予選の stage は決勝トーナメントより必ず前なので、ここに来た時点で
      // そのリーグの試合は全て byId に入っている (単一パスで解ける根拠)。
      const groupMatches = [...byId.values()].filter(m => m.group === ref.group);
      return resolveGroupRank(
        groupIds, groupMatches, ctx.leaguePoints ?? DEFAULT_LEAGUE_POINTS, ref.rank,
        ctx.qualifierOverrides?.[qualifierKey(ref.group, ref.rank)],
        ctx.rankBy ?? 'league-points',
        ctx.qualifierExclusions ?? [],
      );
    }
    case 'winner-of': {
      const src = byId.get(ref.matchId);
      if (!src) return UNKNOWN;
      // 不戦の枠は対戦を待たずに上がる人が決まっている。運営を開始していない大会では
      // まだ確定させていない (started=false) が、次の回戦の顔ぶれとしては見せてよい
      if (src.status !== 'done') return walkoverWinnerOf(src) ?? UNKNOWN;
      const w = winnerOf(src);
      // 勝者がいない (両者棄権/bye同士) 場合は、この枠自体が bye として下流へ伝わる
      return { id: w, bye: w === null, known: true };
    }
    case 'loser-of': {
      const src = byId.get(ref.matchId);
      if (!src || src.status !== 'done') return UNKNOWN;
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
 * `group-rank` も同じ — 予選リーグは決勝トーナメントより前の stage に置かれる。
 */
export function resolveMatches(
  matches: TournamentMatch[], now = Date.now(), ctx: ResolveContext = {},
): TournamentMatch[] {
  const sorted = [...matches].sort((a, b) => a.stage - b.stage || a.order - b.order);
  const byId   = new Map<string, TournamentMatch>();
  const out    = new Map<string, TournamentMatch>();

  for (const src of sorted) {
    const m: TournamentMatch = { ...src };
    const ra = resolveSlot(m.slotA, byId, ctx);
    const rb = resolveSlot(m.slotB, byId, ctx);

    m.resolvedA = ra.id;
    m.resolvedB = rb.id;
    m.byeA      = ra.known && ra.bye;
    m.byeB      = rb.known && rb.bye;

    const bothKnown = ra.known && rb.known;

    if (!m.result && bothKnown && (m.byeA || m.byeB) && ctx.started !== false) {
      // 不戦勝。相手がいないので対戦は行わず、その場で確定させる
      // (運営を開始していない大会では確定させない — ResolveContext.started)
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
  ctx: ResolveContext = {},
): TournamentMatch[] {
  return resolveMatches(
    matches.map(m => (m.id === matchId ? { ...m, result, status: 'awaiting_confirm' as const } : m)),
    Date.now(), ctx,
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
  ctx: ResolveContext = {},
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
    return withoutRematchPending({ ...m, result, status: 'done' as const });
  }), now, ctx);
}

/** 運営裁定で不戦勝・両者棄権にする (対戦を行わずに確定させる) */
export function setWalkover(
  matches: TournamentMatch[], matchId: string, winnerSide: 0 | 1 | null, now = Date.now(),
  ctx: ResolveContext = {},
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
    return withoutRematchPending({ ...m, result, status: 'done' as const });
  }), now, ctx);
}

/**
 * 結果を捨てて未実施に戻す (やり直し / 同点の再試合)。下流も巻き戻す。
 *
 * `isRematch` (同点によるやり直し) は結果とともに消えてしまう `status` の代わりに、
 * 「まだ再試合が行われていない」ことをトーナメント表・リーグ表に示すための印。
 */
export function discardResult(
  matches: TournamentMatch[], matchId: string, rematchMapCatalogId?: string,
  ctx: ResolveContext = {}, isRematch = false,
): TournamentMatch[] {
  const cleared = clearFrom(matches, matchId, true);
  return resolveMatches(cleared.map(m => (
    m.id === matchId
      ? {
          ...m,
          ...(rematchMapCatalogId ? { rematchMapCatalogId } : {}),
          ...(isRematch ? { rematchPending: true as const } : {}),
        }
      : m
  )), Date.now(), ctx);
}

/**
 * ある試合に (推移的に) 依存する試合の ID 集合。自分自身は含まない。
 *
 * **`group-rank` 参照は「そのリーグの全試合」に依存している。** 予選の1試合が動けば順位表が
 * 変わり、決勝トーナメントの1回戦の決勝進出者が変わりうるため。これを数えないと、確定済みの
 * 準決勝の resolvedA/B だけが別人に書き換わり、「戦っていない相手に勝ったこと」になってしまう。
 */
export function downstreamOf(matches: TournamentMatch[], matchId: string): Set<string> {
  const sorted = [...matches].sort((a, b) => a.stage - b.stage || a.order - b.order);
  const hit    = new Set<string>([matchId]);
  const out    = new Set<string>();

  // 巻き込まれた試合が属する予選リーグ。予選の試合しか group を持たないので、
  // 同じリーグの他の試合が芋づるで入ることはない (リーグの試合は participant 参照しか持たない)
  const groupHit = new Set<number>();
  const start = matches.find(m => m.id === matchId);
  if (start?.group !== undefined) groupHit.add(start.group);

  for (const m of sorted) {
    const refs = [m.slotA, m.slotB];
    const depends = refs.some(r =>
      ((r.kind === 'winner-of' || r.kind === 'loser-of') && hit.has(r.matchId))
      || (r.kind === 'group-rank' && groupHit.has(r.group)));
    if (depends && m.id !== matchId) {
      hit.add(m.id);
      out.add(m.id);
      if (m.group !== undefined) groupHit.add(m.group);
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
export function reopenMatch(
  matches: TournamentMatch[], matchId: string, ctx: ResolveContext = {},
): TournamentMatch[] {
  return resolveMatches(clearFrom(matches, matchId, true), Date.now(), ctx);
}

function clearFrom(
  matches: TournamentMatch[], matchId: string, includeSelf: boolean,
): TournamentMatch[] {
  const ds = downstreamOf(matches, matchId);
  return matches.map(m => {
    const target = (includeSelf && m.id === matchId) || ds.has(m.id);
    if (!target) return m;
    const next = withoutRematchPending({ ...m, status: 'pending' });
    delete next.result;
    delete next.rematchMapCatalogId;
    return next;
  });
}
