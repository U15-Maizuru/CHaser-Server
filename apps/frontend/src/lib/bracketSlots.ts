import {
  balanceBracketHalves, bracketSizeFor, pointSymmetricBracketOrder, seedOrder,
} from '@u15/ws-types';

// 大会データ作成 UI の「組み合わせを手動で指定する」ための純関数。
//
// スロット配列は buildBracket の `bracket.slots` と同じ形式:
//   長さは2の冪、先頭から2つずつが1回戦の1カード、null は bye。
// 配置の規則そのもの (seedOrder / bracketSizeFor) は @u15/ws-types にあり、
// バックエンドの自動生成と同一のものを使う。

/**
 * シード順 (= 参加者の並び順) から既定のスロット配置を作る。
 *
 * **buildBracket の自動生成と寸分違わぬ並びにすること。** 点対称化
 * (pointSymmetricBracketOrder) とバランス取り (balanceBracketHalves) まで含めて
 * 同じものを同じ順に通す — ここがズレると、エディタで見せた組み合わせと
 * 実際に組まれる組み合わせが違うことになる。
 */
export function autoSlots(participantIds: string[]): (string | null)[] {
  const size  = bracketSizeFor(participantIds.length);
  const slots = seedOrder(size).map(seedNo => participantIds[seedNo - 1] ?? null);
  return balanceBracketHalves(pointSymmetricBracketOrder(slots), id => id === null);
}

/**
 * 参加者を足し引きしたあとのスロット配置を作り直す。
 *
 * 運営が手で組んだ配置は極力壊さない: まだ有効な参加者はその位置に残し、
 * 消えた参加者・重複だけを空け、未配置の参加者を前から空きスロットへ入れる。
 */
export function fitSlots(slots: (string | null)[], participantIds: string[]): (string | null)[] {
  const size  = bracketSizeFor(participantIds.length);
  const valid = new Set(participantIds);
  const used  = new Set<string>();

  const out: (string | null)[] = [];
  for (let i = 0; i < size; i++) {
    const s = slots[i] ?? null;
    if (s !== null && valid.has(s) && !used.has(s)) {
      out.push(s);
      used.add(s);
    } else {
      out.push(null);
    }
  }

  const missing = participantIds.filter(id => !used.has(id));
  for (let i = 0; i < size && missing.length > 0; i++) {
    if (out[i] === null) out[i] = missing.shift()!;
  }
  return out;
}

/** 1回戦のカード (2スロットずつ) に区切る。表示用 */
export function slotPairs(slots: (string | null)[]): [string | null, string | null][] {
  const pairs: [string | null, string | null][] = [];
  for (let i = 0; i + 1 < slots.length; i += 2) {
    pairs.push([slots[i] ?? null, slots[i + 1] ?? null]);
  }
  return pairs;
}

/** 生成される試合数を数える (保存前のプレビュー用) */
export function matchCountOf(
  format: 'single-elimination' | 'league',
  n: number,
  opts: { thirdPlaceMatch: boolean; doubleRoundRobin: boolean },
): number {
  if (format === 'league') {
    return (n * (n - 1) / 2) * (opts.doubleRoundRobin ? 2 : 1);
  }
  const size = bracketSizeFor(n);
  if (size < 2) return 0;
  // 勝ち上がりは size-1 試合。3位決定戦は準決勝が成立する4人以上のときだけ増える
  return (size - 1) + (opts.thirdPlaceMatch && size >= 4 ? 1 : 0);
}
