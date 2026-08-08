import type {
  GroupStanding, LeaguePoints, QualifierCandidate, QualifierSlot, StandingRow, TournamentMatch,
} from '@u15/ws-types';
import { groupLabel } from '@u15/ws-types';
import { computeStandings, type StandingsRankBy } from './standings.js';

// 予選の順位表から「決勝トーナメントの枠に誰が入るか」を決める純関数。
//
// 方針: **自動判定は必ず決定的に枠を埋める。** 同点処理を尽くしても並びが決まらないことは
// 通常運用で起こるが、そこで枠を空けてしまうと決勝トーナメントが始められなくなる。
// 順位表の「位置」で機械的に埋めたうえで、怪しいところに tied / ambiguous の印を立てる。
//
// 運営が最終的に決め直す道は2つある:
//   ・枠ごとの差し替え (overrides)  … 予選リーグ。「Aリーグ2位は誰か」を選ぶ
//   ・確認リストからの削除 (exclusions) … BOT対戦予選。多めに並べて人数まで削る
// どちらも autoPick を通るので、判定はここ1箇所に閉じている。

/** 手動指定のキー。state.json の qualifierOverrides と揃える */
export function qualifierKey(group: number, rank: number): string {
  return `${group}:${rank}`;
}

/** その予選グループの試合だけを取り出す */
export function matchesOfGroup(matches: TournamentMatch[], group: number): TournamentMatch[] {
  return matches.filter(m => m.group === group);
}

/** そのグループの全試合が確定したか。試合が0件 (1人リーグ) なら確定済み扱い */
export function isGroupFinished(matches: TournamentMatch[], group: number): boolean {
  return matchesOfGroup(matches, group).every(m => m.status === 'done');
}

/**
 * 予選グループごとの順位表。
 *
 * `participantIds` はエントリー順 (選手番号順) をそのまま保つ — 星取表の行・列に使うため。
 * 順位順に並べ替えたものを渡すと、試合が確定するたびに表の行が動いてしまう。
 * `computeStandings` の並びは `participantIds` の順に依存する (同点時の安定ソート) ので、
 * ここが決定的であることが自動判定の再現性そのものになる。
 */
export function computeGroupStandings(
  groups: string[][], matches: TournamentMatch[], lp: LeaguePoints,
  rankBy: StandingsRankBy = 'league-points',
): GroupStanding[] {
  return groups.map((participantIds, group) => ({
    group,
    label:     groupLabel(group),
    participantIds,
    standings: computeStandings(participantIds, matchesOfGroup(matches, group), lp, rankBy),
  }));
}

/**
 * 枠に入る人を順位表の位置から選ぶ。人数が足りなければ null (= 不戦)。
 *
 * **運営が確認リストから削除した人は最初から居なかったものとして詰める。** 除外を
 * 「その枠を空ける」ではなく「繰り上げる」と解釈するのが、削除UX の意味そのもの。
 */
function autoPick(
  standings: StandingRow[], rank: number, exclusions: ReadonlySet<string>,
): string | null {
  const remaining = exclusions.size === 0
    ? standings
    : standings.filter(s => !exclusions.has(s.participantId));
  return remaining[rank - 1]?.participantId ?? null;
}

/**
 * 同着が「上がる / 上がらない」の境目をまたいでいるか。
 *
 * 上位内だけで並んでいる (例: 上位2が両方1位で、2人とも上がる) のは運営が決めることが無いので
 * ambiguous ではない。決めるべきなのは「最後の枠と、その次の人が並んでいる」ときだけ。
 */
function isAmbiguous(
  standings: StandingRow[], rank: number, advancePerGroup: number,
  exclusions: ReadonlySet<string>,
): boolean {
  const remaining = exclusions.size === 0
    ? standings
    : standings.filter(s => !exclusions.has(s.participantId));
  const mine = remaining[rank - 1];
  const cut  = remaining[advancePerGroup];   // 最初の「上がらない人」
  return !!mine && !!cut && mine.rank === cut.rank;
}

/**
 * 決勝トーナメントの枠。
 *
 * 手動指定 (overrides) は予選が終わっていなくても優先する — 「最終的には人が決められる」を
 * 成り立たせるため。ただし指定された人がそのグループの所属でなければ黙って無視する
 * (参加者を入れ替えた古い state.json を読んでも壊れないように)。
 */
export function computeQualifiers(
  groupStandings:  GroupStanding[],
  matches:         TournamentMatch[],
  advancePerGroup: number,
  overrides:       Record<string, string | null> = {},
  exclusions:      readonly string[] = [],
): QualifierSlot[] {
  const slots: QualifierSlot[] = [];
  const excluded = new Set(exclusions);

  for (const g of groupStandings) {
    const finished = isGroupFinished(matches, g.group);
    const members  = new Set(g.participantIds);
    const gone     = new Set([...excluded].filter(id => members.has(id)));

    for (let rank = 1; rank <= advancePerGroup; rank++) {
      const raw    = overrides[qualifierKey(g.group, rank)];
      const manual = typeof raw === 'string' && members.has(raw) ? raw : null;

      // 参加者数がこの順位に足りない = 埋まりようがない枠。不戦として扱う
      const bye  = g.participantIds.length - gone.size < rank;
      const auto = !bye && finished ? autoPick(g.standings, rank, gone) : null;

      slots.push({
        group: g.group,
        rank,
        autoParticipantId:   auto,
        manualParticipantId: manual,
        participantId:       manual ?? auto,
        tied:      !bye && finished && rowAt(g.standings, rank, gone)?.tied === true,
        ambiguous: !bye && finished && isAmbiguous(g.standings, rank, advancePerGroup, gone),
        pending:   !bye && !finished && manual === null,
        bye,
      });
    }
  }

  return slots;
}

function rowAt(
  standings: StandingRow[], rank: number, exclusions: ReadonlySet<string>,
): StandingRow | undefined {
  const remaining = exclusions.size === 0
    ? standings
    : standings.filter(s => !exclusions.has(s.participantId));
  return remaining[rank - 1];
}

/**
 * 最終決定確認リスト。
 *
 * 上位 `advancePerGroup` 人に、**その最下位と同順位で並んだ人を全員足した**ものを候補にする。
 * ボーダーが同点なら候補が定員より多くなるので、運営はそこから削って人数を合わせる。
 * 削除済みの人も行として残す (取り消せるように) が、順位の計算からは外れている。
 *
 * 予選が終わっていなければ空 — 順位が決まらないので候補を出しようがない。
 */
export function computeQualifierCandidates(
  groupStandings:  GroupStanding[],
  matches:         TournamentMatch[],
  advancePerGroup: number,
  exclusions:      readonly string[] = [],
): QualifierCandidate[] {
  const out: QualifierCandidate[] = [];
  const excluded = new Set(exclusions);

  for (const g of groupStandings) {
    if (!isGroupFinished(matches, g.group)) continue;

    const gone      = new Set([...excluded].filter(id => g.participantIds.includes(id)));
    const remaining = g.standings.filter(s => !gone.has(s.participantId));

    // 定員の位置にいる人と同順位の人は全員候補。並びは順位表そのまま
    const cut      = remaining[advancePerGroup - 1];
    const takeRank = cut?.rank ?? null;
    const picked   = remaining.filter((s, i) =>
      i < advancePerGroup || (takeRank !== null && s.rank === takeRank));

    // ボーダーで決着していない = 定員より多く残っている
    const onBorder = takeRank !== null && picked.length > advancePerGroup;

    for (const s of picked) {
      out.push(candidateOf(s, false, onBorder && s.rank === takeRank));
    }
    // 削除済みは元の順位表の位置に関わらず末尾へ。取り消しの導線としてだけ残す
    for (const s of g.standings) {
      if (gone.has(s.participantId)) out.push(candidateOf(s, true, false));
    }
  }

  return out;
}

function candidateOf(s: StandingRow, excluded: boolean, onBorder: boolean): QualifierCandidate {
  return {
    participantId: s.participantId,
    rank:          s.rank,
    totalPoints:   s.totalPoints,
    strikePoints:  s.strikePoints,
    itemPoints:    s.itemPoints,
    excluded,
    onBorder,
  };
}

/**
 * `group-rank` スロット1つを解決する (progress.resolveMatches から呼ぶ)。
 *
 * 戻り値は resolveSlot の Resolved と同じ形:
 *   known=false … まだ決まらない (下流は pending のまま)
 *   bye=true    … この枠は不戦 (参加者が足りない)
 */
export function resolveGroupRank(
  groupIds:     string[],
  groupMatches: TournamentMatch[],
  lp:           LeaguePoints,
  rank:         number,
  override:     string | null | undefined,
  rankBy:       StandingsRankBy = 'league-points',
  exclusions:   readonly string[] = [],
): { id: string | null; bye: boolean; known: boolean } {
  // 手動指定が最優先。予選の途中でも運営の判断を通す
  if (typeof override === 'string' && groupIds.includes(override)) {
    return { id: override, bye: false, known: true };
  }

  const gone = new Set(exclusions.filter(id => groupIds.includes(id)));

  // 参加者が足りない枠は、予選を待たずに不戦と分かる
  if (groupIds.length - gone.size < rank) return { id: null, bye: true, known: true };

  if (!groupMatches.every(m => m.status === 'done')) {
    return { id: null, bye: false, known: false };
  }

  const id = autoPick(computeStandings(groupIds, groupMatches, lp, rankBy), rank, gone);
  // 順位表に行が無い (理論上ここには来ないが、来ても落とさない)
  return id === null ? { id: null, bye: true, known: true } : { id, bye: false, known: true };
}
