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
 * 円卓法の初期配置。**先頭 (リストの1番目) を固定、2番目を末尾に置く**ことで、
 * 第1節が必ず「1番目 vs 2番目」の対戦になるようにする (残り3番目以降は降順で並べるだけで、
 * 総当たりが成立する制約自体は崩さない)。
 *
 * 奇数人はダミーを**先頭の直後**に挟む。末尾に足すと2番目の位置がずれて
 * 「1番目 vs 2番目」が第1節に来なくなるため。
 */
function initialOrder(ids: string[]): (string | null)[] {
  if (ids.length < 2) return [...ids];
  const [first, second, ...rest] = ids;
  const tail = [...rest].reverse();
  return ids.length % 2 === 0
    ? [first!, ...tail, second!]
    : [first!, null, ...tail, second!];
}

/**
 * 円卓法 (circle method) で総当たりを節に分割する。
 * 参加者が奇数のときはダミーを1つ足し、ダミーと当たる人がその節の休みになる。
 * 各節に同じ参加者が2回出ないことが保証される。
 */
function circleMethod(ids: string[]): [string, string][][] {
  const arr = initialOrder(ids);
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

/**
 * 各節を実施順に処理しながら、先攻(side0)-後攻(side1)の差が小さい方を先攻にする貪欲法。
 *
 * 単純に「これまでの先攻回数」だけを比べると、奇数人 (休みの節がある) では休みの節の
 * タイミング次第で偏りが残る — 休んだ回数ぶん比較の土台がズレるため。「先攻-後攻」の差
 * (2*先攻回数-消化試合数と同じ) で比べると、休みを挟んでも「今どれだけ先攻に傾いているか」
 * を正しく比較できる。同点のときは交互に譲ることで、特定の1人 (アンカー) だけが同点のたびに
 * 先攻を取り続ける偏りも防ぐ。この2つで、参加者ごとの先攻回数の差は最大でも2に収まる
 * (人数を2〜30で全数確認済み。既定の「バランスしない」場合は人数-1まで開くことがある)。
 *
 * 2巡総当たり (doubleRoundRobin) の2巡目は全ペアの先後を丸ごと入れ替えるミラーリングなので、
 * 1巡目にどう割り当てても2巡通せば全員ぴったり半々になる。そのためこの処理はミラーリングの
 * **前** に無条件で適用してよい (害がない)。
 */
function balanceSideCounts(stages: [string, string][][]): [string, string][][] {
  const diff = new Map<string, number>(); // 先攻回数 - 後攻回数
  let tieBreak = false;
  return stages.map(pairs => pairs.map(([a, b]) => {
    const da = diff.get(a) ?? 0;
    const db = diff.get(b) ?? 0;
    let slotA: string, slotB: string;
    if (da === db) {
      [slotA, slotB] = tieBreak ? [b, a] : [a, b];
      tieBreak = !tieBreak;
    } else {
      [slotA, slotB] = da < db ? [a, b] : [b, a];
    }
    diff.set(slotA, (diff.get(slotA) ?? 0) + 1);
    diff.set(slotB, (diff.get(slotB) ?? 0) - 1);
    return [slotA, slotB] as [string, string];
  }));
}

export interface BuildLeagueOptions {
  doubleRoundRobin: boolean;
  /** 明示的な対戦カード。省略時は総当たりを自動生成 */
  pairs?: [string, string][];
  /**
   * 先攻(side0)/後攻(side1)の回数をなるべく均等にするか (1ゲーム制のリーグ戦用)。
   * 運営が手書きした対戦カード (`pairs`) には適用しない — 意図的な順序として尊重する。
   */
  balanceSides?: boolean;
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

  if (opts.balanceSides && !(opts.pairs && opts.pairs.length > 0)) {
    stages = balanceSideCounts(stages);
  }

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
