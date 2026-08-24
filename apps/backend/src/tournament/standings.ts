import type { LeaguePoints, RoundResult, StandingRow, TournamentMatch } from '@u15/ws-types';
import {
  idxForSide, roundItemPointsFor, roundStrikeBonusFor, roundSweepBonusFor,
} from '@u15/ws-types';

// 順位表を求める純関数。並べ方は2系統ある (rankBy)。
//
// ① 'league-points' — 総当たりリーグ。公式ルール:
//    「総当たり戦は勝ち点制にて順位を決定し、勝利:3点、敗北:0点、引き分け:1点とする。
//      ・勝ち点が同じ場合は、全試合の合計ポイントにて順位を決定する。
//      ・勝ち点・合計ポイントが同点の場合は、直接対決の結果にて順位を決定する。」
//
// ② 'total-points' — BOT対戦予選 (舞鶴大会ルール)。全員が同じ BOT としか戦っていないので直接対決が
//    存在せず、勝敗も「同じ基準器に勝てたか」でしかない。そこで**ポイントそのもの**で測り、
//    同点は合計ポイントの内訳 (一撃 → アイテム) で割る。それでも並んだら同着とし、
//    運営が最終決定確認リストで決める (機械的に決めない)。
//
// ③ 'koryu-bot-score' — BOT対戦予選 (交流大会ルール)。得点式が
//    アイテム数×3±残りターン数 (koryuBotRoundScore) に変わるだけで、
//    「同点は同着として運営が決める」という考え方は②と同じ。舞鶴大会のボーナス内訳
//    (一撃/アイテム) は交流大会ルールでは意味を持たないため、タイブレークに使わない。
//
// **①は変えない。** 公式ルールがタイブレークの連鎖を定めているので、②③はその外側に足す別系統。

export type StandingsRankBy = 'league-points' | 'total-points' | 'koryu-bot-score';

interface Tally {
  played: number; wins: number; draws: number; losses: number;
  points: number; totalPoints: number;
  /** totalPoints の内訳 (合計 = item + strike + sweep) */
  itemPoints: number; strikePoints: number; sweepPoints: number;
  /** 素のアイテム数・残りターン数の合計。交流大会ルールの得点式の根拠を確認するため */
  items: number; remainingTurns: number;
}

function emptyTally(): Tally {
  return {
    played: 0, wins: 0, draws: 0, losses: 0, points: 0, totalPoints: 0,
    itemPoints: 0, strikePoints: 0, sweepPoints: 0,
    items: 0, remainingTurns: 0,
  };
}

/** 確定済みの試合だけを対象にする (未消化があっても壊れない) */
function finishedMatches(matches: TournamentMatch[]): TournamentMatch[] {
  return matches.filter(m => m.status === 'done' && m.result);
}

function tallyOne(
  t: Tally, isWinner: boolean, isDraw: boolean, myPoints: number,
  rrs: RoundResult[], side: 0 | 1, lp: LeaguePoints,
): void {
  t.played++;
  t.totalPoints += myPoints;
  // 内訳は roundResults から積む。set は不戦勝で null になるが roundResults は必ずある
  for (const rr of rrs) {
    t.itemPoints   += roundItemPointsFor(rr, side);
    t.strikePoints += roundStrikeBonusFor(rr, side);
    t.sweepPoints  += roundSweepBonusFor(rr, side);
    t.items          += rr.scores[idxForSide(side, rr.round)];
    t.remainingTurns += rr.remainingTurns;
  }
  if (isDraw)        { t.draws++;  t.points += lp.draw; }
  else if (isWinner) { t.wins++;   t.points += lp.win;  }
  else               { t.losses++; t.points += lp.loss; }
}

/** 直接対決の勝ち点 (同点グループ内だけの小さなリーグ戦) */
function headToHeadPoints(
  group: Set<string>, matches: TournamentMatch[], lp: LeaguePoints,
): Map<string, number> {
  const pts = new Map<string, number>();
  for (const id of group) pts.set(id, 0);

  for (const m of finishedMatches(matches)) {
    const a = m.resolvedA;
    const b = m.resolvedB;
    if (!a || !b || !group.has(a) || !group.has(b)) continue;
    const w = m.result!.winnerSide;
    if (w === null)   { pts.set(a, pts.get(a)! + lp.draw); pts.set(b, pts.get(b)! + lp.draw); }
    else if (w === 0) { pts.set(a, pts.get(a)! + lp.win);  pts.set(b, pts.get(b)! + lp.loss); }
    else              { pts.set(b, pts.get(b)! + lp.win);  pts.set(a, pts.get(a)! + lp.loss); }
  }
  return pts;
}

export function computeStandings(
  participantIds: string[],
  matches:        TournamentMatch[],
  lp:             LeaguePoints,
  rankBy:         StandingsRankBy = 'league-points',
): StandingRow[] {
  const tallies = new Map<string, Tally>();
  for (const id of participantIds) tallies.set(id, emptyTally());

  for (const m of finishedMatches(matches)) {
    const { winnerSide, set, roundResults } = m.result!;
    const a = m.resolvedA;
    const b = m.resolvedB;
    // 不戦勝 (相手が bye) は勝敗表に載せない。実際には対戦していないため
    if (!a || !b) continue;

    const isDraw = winnerSide === null;
    const ta = tallies.get(a);
    const tb = tallies.get(b);
    if (ta) tallyOne(ta, winnerSide === 0, isDraw, set?.totals[0] ?? 0, roundResults, 0, lp);
    if (tb) tallyOne(tb, winnerSide === 1, isDraw, set?.totals[1] ?? 0, roundResults, 1, lp);
  }

  const base = participantIds.map(id => ({ id, t: tallies.get(id) ?? emptyTally() }));

  if (rankBy === 'total-points')       return rankByTotalPoints(base);
  if (rankBy === 'koryu-bot-score') return rankByKoryuBotScore(base);
  return rankByLeaguePoints(base, matches, lp);
}

/** ① 勝ち点 → ② 全試合の合計ポイント → ③ 直接対決 */
function rankByLeaguePoints(
  base: { id: string; t: Tally }[], matches: TournamentMatch[], lp: LeaguePoints,
): StandingRow[] {
  base.sort((x, y) => y.t.points - x.t.points || y.t.totalPoints - x.t.totalPoints);

  // ①②が並んだグループの中だけ直接対決で並べ替える
  const rows: StandingRow[] = [];
  let i = 0;
  let rank = 1;
  while (i < base.length) {
    let j = i + 1;
    while (
      j < base.length &&
      base[j]!.t.points      === base[i]!.t.points &&
      base[j]!.t.totalPoints === base[i]!.t.totalPoints
    ) j++;

    const groupIds = base.slice(i, j).map(x => x.id);
    if (groupIds.length > 1) {
      const h2h = headToHeadPoints(new Set(groupIds), matches, lp);
      groupIds.sort((x, y) => (h2h.get(y) ?? 0) - (h2h.get(x) ?? 0));

      let k = 0;
      while (k < groupIds.length) {
        let l = k + 1;
        const hk = h2h.get(groupIds[k]!) ?? 0;
        while (l < groupIds.length && (h2h.get(groupIds[l]!) ?? 0) === hk) l++;
        const tied = l - k > 1;
        for (let x = k; x < l; x++) {
          const id = groupIds[x]!;
          rows.push(toRow(id, tallyOf(base, id), rank, tied));
        }
        rank += l - k;
        k = l;
      }
    } else {
      const id = groupIds[0]!;
      rows.push(toRow(id, tallyOf(base, id), rank, false));
      rank += 1;
    }
    i = j;
  }

  return rows;
}

/**
 * ① 合計ポイント → ② 一撃ボーナス → ③ アイテムポイント。
 *
 * ②③が有効なタイブレークになるのは `合計 = アイテム×10 + 一撃 + 総取り` の3成分だから。
 * 合計と一撃が並んでも総取りの差でアイテムポイントは違いうるので、
 * 「総取りで拾った人より、自分でアイテムを取った人を上に置く」という順序になる。
 */
function rankByTotalPoints(base: { id: string; t: Tally }[]): StandingRow[] {
  base.sort((x, y) =>
    y.t.totalPoints  - x.t.totalPoints
    || y.t.strikePoints - x.t.strikePoints
    || y.t.itemPoints   - x.t.itemPoints);

  return rankSortedGroups(base, (a, b) =>
    a.totalPoints === b.totalPoints
    && a.strikePoints === b.strikePoints
    && a.itemPoints === b.itemPoints);
}

/**
 * 交流大会ルールの BOT対戦予選: totalPoints (= koryuBotRoundScore の合計) だけで順位を付ける。
 * 舞鶴大会ルールの一撃/アイテムポイント内訳は交流大会ルールでは存在しないので、それ以上の
 * タイブレークはせず、並んだら同着として運営の最終決定確認リストに委ねる。
 */
function rankByKoryuBotScore(base: { id: string; t: Tally }[]): StandingRow[] {
  base.sort((x, y) => y.t.totalPoints - x.t.totalPoints);
  return rankSortedGroups(base, (a, b) => a.totalPoints === b.totalPoints);
}

/**
 * ソート済みの base を、隣接する同着グループ (isTied) ごとに rank を振って StandingRow へ変換する。
 * rank は同着のぶんだけ飛ぶ (1,2,2,4) — league 側 (rankByLeaguePoints) と同じ数え方。
 */
function rankSortedGroups(
  base: { id: string; t: Tally }[], isTied: (a: Tally, b: Tally) => boolean,
): StandingRow[] {
  const rows: StandingRow[] = [];
  let i = 0;
  while (i < base.length) {
    let j = i + 1;
    while (j < base.length && isTied(base[j]!.t, base[i]!.t)) j++;

    const tied = j - i > 1;
    for (let k = i; k < j; k++) rows.push(toRow(base[k]!.id, base[k]!.t, i + 1, tied));
    i = j;
  }

  return rows;
}

function tallyOf(base: { id: string; t: Tally }[], id: string): Tally {
  return base.find(x => x.id === id)?.t ?? emptyTally();
}

function toRow(participantId: string, t: Tally, rank: number, tied: boolean): StandingRow {
  return {
    participantId,
    played:       t.played,
    wins:         t.wins,
    draws:        t.draws,
    losses:       t.losses,
    points:       t.points,
    totalPoints:  t.totalPoints,
    itemPoints:   t.itemPoints,
    strikePoints: t.strikePoints,
    sweepPoints:  t.sweepPoints,
    items:          t.items,
    remainingTurns: t.remainingTurns,
    rank,
    tied,
  };
}
