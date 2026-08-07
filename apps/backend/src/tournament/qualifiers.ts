import type {
  GroupStanding, LeaguePoints, QualifierSlot, StandingRow, TournamentMatch,
} from '@u15/ws-types';
import { groupLabel } from '@u15/ws-types';
import { computeStandings } from './standings.js';

// 予選リーグの順位表から「決勝トーナメントの枠に誰が入るか」を決める純関数。
//
// 方針: **自動判定は必ず決定的に枠を埋める。** 公式ルールの同点処理 (勝ち点 → 合計ポイント
// → 直接対決) でも並びが決まらないことは通常運用で起こるが、そこで枠を空けてしまうと
// 決勝トーナメントが始められなくなる。順位表の「位置」で機械的に埋めたうえで、
// 怪しいところに tied / ambiguous の印を立て、運営が差し替えられるようにする。

/** 手動指定のキー。state.json の qualifierOverrides と揃える */
export function qualifierKey(group: number, rank: number): string {
  return `${group}:${rank}`;
}

/** その予選リーグの試合だけを取り出す */
export function matchesOfGroup(matches: TournamentMatch[], group: number): TournamentMatch[] {
  return matches.filter(m => m.group === group);
}

/** そのリーグの全試合が確定したか。試合が0件 (1人リーグ) なら確定済み扱い */
export function isGroupFinished(matches: TournamentMatch[], group: number): boolean {
  return matchesOfGroup(matches, group).every(m => m.status === 'done');
}

/**
 * 予選リーグごとの順位表。
 *
 * `participantIds` はエントリー順 (選手番号順) をそのまま保つ — 星取表の行・列に使うため。
 * 順位順に並べ替えたものを渡すと、試合が確定するたびに表の行が動いてしまう。
 * `computeStandings` の並びは `participantIds` の順に依存する (同点時の安定ソート) ので、
 * ここが決定的であることが自動判定の再現性そのものになる。
 */
export function computeGroupStandings(
  groups: string[][], matches: TournamentMatch[], lp: LeaguePoints,
): GroupStanding[] {
  return groups.map((participantIds, group) => ({
    group,
    label:     groupLabel(group),
    participantIds,
    standings: computeStandings(participantIds, matchesOfGroup(matches, group), lp),
  }));
}

/** 枠に入る人を順位表の位置から選ぶ。人数が足りなければ null (= 不戦) */
function autoPick(standings: StandingRow[], rank: number): string | null {
  return standings[rank - 1]?.participantId ?? null;
}

/**
 * 同着が「上がる / 上がらない」の境目をまたいでいるか。
 *
 * 上位内だけで並んでいる (例: 上位2が両方1位で、2人とも上がる) のは運営が決めることが無いので
 * ambiguous ではない。決めるべきなのは「最後の枠と、その次の人が並んでいる」ときだけ。
 */
function isAmbiguous(standings: StandingRow[], rank: number, advancePerGroup: number): boolean {
  const mine = standings[rank - 1];
  const cut  = standings[advancePerGroup];   // 最初の「上がらない人」
  return !!mine && !!cut && mine.rank === cut.rank;
}

/**
 * 決勝トーナメントの枠。
 *
 * 手動指定 (overrides) は予選が終わっていなくても優先する — 「最終的には人が決められる」を
 * 成り立たせるため。ただし指定された人がそのリーグの所属でなければ黙って無視する
 * (参加者を入れ替えた古い state.json を読んでも壊れないように)。
 */
export function computeQualifiers(
  groupStandings:  GroupStanding[],
  matches:         TournamentMatch[],
  advancePerGroup: number,
  overrides:       Record<string, string | null> = {},
): QualifierSlot[] {
  const slots: QualifierSlot[] = [];

  for (const g of groupStandings) {
    const finished = isGroupFinished(matches, g.group);
    const members  = new Set(g.participantIds);

    for (let rank = 1; rank <= advancePerGroup; rank++) {
      const raw    = overrides[qualifierKey(g.group, rank)];
      const manual = typeof raw === 'string' && members.has(raw) ? raw : null;

      // 参加者数がこの順位に足りない = 埋まりようがない枠。不戦として扱う
      const bye  = g.participantIds.length < rank;
      const auto = !bye && finished ? autoPick(g.standings, rank) : null;

      slots.push({
        group: g.group,
        rank,
        autoParticipantId:   auto,
        manualParticipantId: manual,
        participantId:       manual ?? auto,
        tied:      !bye && finished && (g.standings[rank - 1]?.tied ?? false),
        ambiguous: !bye && finished && isAmbiguous(g.standings, rank, advancePerGroup),
        pending:   !bye && !finished && manual === null,
        bye,
      });
    }
  }

  return slots;
}

/**
 * `group-rank` スロット1つを解決する (progress.resolveMatches から呼ぶ)。
 *
 * 戻り値は resolveSlot の Resolved と同じ形:
 *   known=false … まだ決まらない (下流は pending のまま)
 *   bye=true    … この枠は不戦 (参加者が足りない)
 */
export function resolveGroupRank(
  groupIds:   string[],
  groupMatches: TournamentMatch[],
  lp:         LeaguePoints,
  rank:       number,
  override:   string | null | undefined,
): { id: string | null; bye: boolean; known: boolean } {
  // 手動指定が最優先。予選の途中でも運営の判断を通す
  if (typeof override === 'string' && groupIds.includes(override)) {
    return { id: override, bye: false, known: true };
  }

  // 参加者が足りない枠は、予選を待たずに不戦と分かる
  if (groupIds.length < rank) return { id: null, bye: true, known: true };

  if (!groupMatches.every(m => m.status === 'done')) {
    return { id: null, bye: false, known: false };
  }

  const id = autoPick(computeStandings(groupIds, groupMatches, lp), rank);
  // 順位表に行が無い (理論上ここには来ないが、来ても落とさない)
  return id === null ? { id: null, bye: true, known: true } : { id, bye: false, known: true };
}
