import { describe, expect, it } from 'vitest';
import { autoSlots, fitSlots, matchCountOf, slotPairs } from './bracketSlots';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('autoSlots', () => {
  it('8人は標準シード順に並ぶ (左右は点対称なので第2シードは右下)', () => {
    expect(autoSlots(ids(8))).toEqual(['p1', 'p8', 'p4', 'p5', 'p3', 'p6', 'p2', 'p7']);
  });

  it('5人はサイズ8になり、余りが bye になる', () => {
    const slots = autoSlots(ids(5));
    expect(slots).toHaveLength(8);
    expect(slots.filter(s => s === null)).toHaveLength(3);
  });

  it('自動生成では bye 同士のカードが発生しない', () => {
    for (let n = 2; n <= 33; n++) {
      const pairs = slotPairs(autoSlots(ids(n)));
      expect(pairs.some(([a, b]) => a === null && b === null)).toBe(false);
    }
  });

  it('7人は左右を入れ替えて左山を多くする (buildBracket と同じ並び)', () => {
    expect(autoSlots(ids(7))).toEqual(['p3', 'p6', 'p2', 'p7', 'p4', 'p5', 'p1', null]);
  });

  it('どのブロックでも上 (左) の人数が下 (右) を下回らない', () => {
    const count = (list: (string | null)[]) => list.filter(s => s !== null).length;
    for (let n = 2; n <= 33; n++) {
      const walk = (slots: (string | null)[], path: string) => {
        if (slots.length < 4) return;
        const half = slots.length / 2;
        const up = slots.slice(0, half), down = slots.slice(half);
        expect({ n, path, ok: count(up) >= count(down) }).toEqual({ n, path, ok: true });
        walk(up, path + '上');
        walk(down, path + '下');
      };
      walk(autoSlots(ids(n)), '');
    }
  });
});

describe('fitSlots', () => {
  it('有効な配置はその位置に残る', () => {
    const slots = ['p3', 'p1', 'p4', 'p2'];
    expect(fitSlots(slots, ids(4))).toEqual(['p3', 'p1', 'p4', 'p2']);
  });

  it('参加者を消すと、その枠だけが bye になる', () => {
    const slots = ['p3', 'p1', 'p4', 'p2'];
    expect(fitSlots(slots, ['p1', 'p2', 'p3'])).toEqual(['p3', 'p1', null, 'p2']);
  });

  it('参加者を足すと、前の空き枠へ入る', () => {
    const slots = ['p1', null, 'p2', null];
    expect(fitSlots(slots, ['p1', 'p2', 'p3'])).toEqual(['p1', 'p3', 'p2', null]);
  });

  it('重複していたら後ろの方を空ける', () => {
    const slots = ['p1', 'p1', 'p2', null];
    expect(fitSlots(slots, ['p1', 'p2', 'p3'])).toEqual(['p1', 'p3', 'p2', null]);
  });

  it('人数が2の冪をまたぐとスロット数も広がる', () => {
    expect(fitSlots(['p1', 'p2', 'p3', 'p4'], ids(5))).toHaveLength(8);
  });

  it('全参加者がちょうど1回ずつ現れる', () => {
    const out = fitSlots(['p9', 'p9', null, 'p2'], ids(6));
    const placed = out.filter((s): s is string => s !== null);
    expect([...placed].sort()).toEqual([...ids(6)].sort());
  });
});

describe('matchCountOf', () => {
  it('トーナメントは size-1 試合', () => {
    const o = { thirdPlaceMatch: false, doubleRoundRobin: false };
    expect(matchCountOf('single-elimination', 8, o)).toBe(7);
    expect(matchCountOf('single-elimination', 5, o)).toBe(7); // サイズ8
    expect(matchCountOf('single-elimination', 2, o)).toBe(1);
    expect(matchCountOf('single-elimination', 1, o)).toBe(0);
  });

  it('3位決定戦は準決勝が成立する4人以上でのみ増える', () => {
    const o = { thirdPlaceMatch: true, doubleRoundRobin: false };
    expect(matchCountOf('single-elimination', 4, o)).toBe(4);
    expect(matchCountOf('single-elimination', 2, o)).toBe(1);
  });

  it('リーグは n(n-1)/2、2回総当たりで倍', () => {
    expect(matchCountOf('league', 4, { thirdPlaceMatch: false, doubleRoundRobin: false })).toBe(6);
    expect(matchCountOf('league', 4, { thirdPlaceMatch: false, doubleRoundRobin: true })).toBe(12);
  });
});
