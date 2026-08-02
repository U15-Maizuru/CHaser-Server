import type { ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { orderBySeed } from './bracket.js';

// リーグ (総当たり) の試合グラフを組み立てる純関数。
// 公式ルール「エントリー数が規定数に満たない場合、または規定数を超えて予選を行う場合には
// 総当たり戦 (リーグ方式) を実施することがある」に対応する。

function emptyMatch(
  id: string, stage: number, order: number, label: string, a: string, b: string,
): TournamentMatch {
  return {
    id, stage, order, label,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: null, resolvedB: null,
    byeA: false, byeB: false,
    status: 'pending',
  };
}

/**
 * 円卓法 (circle method) で総当たりを節に分割する。
 * 参加者が奇数のときはダミーを1つ足し、ダミーと当たる人がその節の休みになる。
 * 各節に同じ参加者が2回出ないことが保証される。
 */
function circleMethod(ids: string[]): [string, string][][] {
  const arr: (string | null)[] = [...ids];
  if (arr.length % 2 === 1) arr.push(null);
  const m = arr.length;
  if (m < 2) return [];

  const stages: [string, string][][] = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a !== null && a !== undefined && b !== null && b !== undefined) {
        pairs.push([a, b]);
      }
    }
    stages.push(pairs);
    // arr[0] を固定し、残りを右へ1つ回転させる
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(1, m - 1, ...rest);
  }
  return stages;
}

/** 明示的な対戦カードを、同じ参加者が重ならないように節へ貪欲に詰める */
function groupExplicitPairs(pairs: [string, string][]): [string, string][][] {
  const stages: [string, string][][] = [];
  const used:   Set<string>[]        = [];

  for (const [a, b] of pairs) {
    let s = 0;
    while (s < stages.length && (used[s]!.has(a) || used[s]!.has(b))) s++;
    if (s === stages.length) { stages.push([]); used.push(new Set()); }
    stages[s]!.push([a, b]);
    used[s]!.add(a);
    used[s]!.add(b);
  }
  return stages;
}

export interface BuildLeagueOptions {
  doubleRoundRobin: boolean;
  /** 明示的な対戦カード。省略時は総当たりを自動生成 */
  pairs?: [string, string][];
}

export function buildLeague(
  participants: ParticipantDef[],
  opts: BuildLeagueOptions,
): TournamentMatch[] {
  const ids = orderBySeed(participants).map(p => p.id);
  if (ids.length < 2) return [];

  let stages = opts.pairs && opts.pairs.length > 0
    ? groupExplicitPairs(opts.pairs)
    : circleMethod(ids);

  if (opts.doubleRoundRobin) {
    // 2巡目は先攻・後攻を入れ替える (1巡目で後攻だった側が先攻になる)
    const second = stages.map(pairs => pairs.map(([a, b]) => [b, a] as [string, string]));
    stages = [...stages, ...second];
  }

  const matches: TournamentMatch[] = [];
  stages.forEach((pairs, stage) => {
    pairs.forEach(([a, b], order) => {
      matches.push(emptyMatch(
        `L-D${stage + 1}M${order + 1}`,
        stage, order,
        `第${stage + 1}節 第${order + 1}試合`,
        a, b,
      ));
    });
  });
  return matches;
}
