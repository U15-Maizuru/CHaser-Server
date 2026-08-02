import type { LeaguePoints, StandingRow, TournamentMatch } from '@u15/ws-types';

// リーグの順位表を求める純関数。
//
// 公式ルール「総当たり戦は勝ち点制にて順位を決定し、勝利:3点、敗北:0点、引き分け:1点とする。
//   ・勝ち点が同じ場合は、全試合の合計ポイントにて順位を決定する。
//   ・勝ち点・合計ポイントが同点の場合は、直接対決の結果にて順位を決定する。」

interface Tally {
  played: number; wins: number; draws: number; losses: number;
  points: number; totalPoints: number;
}

function emptyTally(): Tally {
  return { played: 0, wins: 0, draws: 0, losses: 0, points: 0, totalPoints: 0 };
}

/** 確定済みの試合だけを対象にする (未消化があっても壊れない) */
function finishedMatches(matches: TournamentMatch[]): TournamentMatch[] {
  return matches.filter(m => m.status === 'done' && m.result);
}

function tallyOne(
  t: Tally, isWinner: boolean, isDraw: boolean, myPoints: number, lp: LeaguePoints,
): void {
  t.played++;
  t.totalPoints += myPoints;
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
): StandingRow[] {
  const tallies = new Map<string, Tally>();
  for (const id of participantIds) tallies.set(id, emptyTally());

  for (const m of finishedMatches(matches)) {
    const { winnerSide, set } = m.result!;
    const a = m.resolvedA;
    const b = m.resolvedB;
    // 不戦勝 (相手が bye) は勝敗表に載せない。実際には対戦していないため
    if (!a || !b) continue;

    const isDraw = winnerSide === null;
    const ta = tallies.get(a);
    const tb = tallies.get(b);
    if (ta) tallyOne(ta, winnerSide === 0, isDraw, set?.totals[0] ?? 0, lp);
    if (tb) tallyOne(tb, winnerSide === 1, isDraw, set?.totals[1] ?? 0, lp);
  }

  // ① 勝ち点 → ② 全試合の合計ポイント で並べる
  const base = participantIds.map(id => ({ id, t: tallies.get(id) ?? emptyTally() }));
  base.sort((x, y) => y.t.points - x.t.points || y.t.totalPoints - x.t.totalPoints);

  // ③ ①②が並んだグループの中だけ直接対決で並べ替える
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
          rows.push(toRow(id, tallies.get(id) ?? emptyTally(), rank, tied));
        }
        rank += l - k;
        k = l;
      }
    } else {
      const id = groupIds[0]!;
      rows.push(toRow(id, tallies.get(id) ?? emptyTally(), rank, false));
      rank += 1;
    }
    i = j;
  }

  return rows;
}

function toRow(participantId: string, t: Tally, rank: number, tied: boolean): StandingRow {
  return {
    participantId,
    played:      t.played,
    wins:        t.wins,
    draws:       t.draws,
    losses:      t.losses,
    points:      t.points,
    totalPoints: t.totalPoints,
    rank,
    tied,
  };
}
