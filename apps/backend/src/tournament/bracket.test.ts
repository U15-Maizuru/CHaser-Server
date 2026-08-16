import { describe, it, expect } from 'vitest';
import type { ParticipantDef } from '@u15/ws-types';
import { bracketSizeFor, seedOrder } from '@u15/ws-types';
import { buildBracket, orderBySeed, sideCoin } from './bracket.js';
import { captureResult, confirmResult, resolveMatches } from './progress.js';

function people(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`,
    name: `プレイヤー${i + 1}`,
    seed: i + 1,
    program: null,
  }));
}

const OPTS = { thirdPlaceMatch: false };

describe('seedOrder', () => {
  it('標準シード順を生成する', () => {
    expect(seedOrder(1)).toEqual([1]);
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
});

describe('bracketSizeFor', () => {
  it('参加者数を収める最小の2の冪を返す', () => {
    expect(bracketSizeFor(2)).toBe(2);
    expect(bracketSizeFor(3)).toBe(4);
    expect(bracketSizeFor(5)).toBe(8);
    expect(bracketSizeFor(8)).toBe(8);
    expect(bracketSizeFor(9)).toBe(16);
  });
});

describe('orderBySeed', () => {
  it('seed 指定者が昇順で先、未指定者は記載順で後ろ', () => {
    const ps: ParticipantDef[] = [
      { id: 'c', name: 'C', program: null },
      { id: 'a', name: 'A', seed: 1, program: null },
      { id: 'd', name: 'D', program: null },
      { id: 'b', name: 'B', seed: 5, program: null },   // 飛び番でも順序関係だけ使う
    ];
    expect(orderBySeed(ps).map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('sideCoin', () => {
  it('同じ種なら何度呼んでも同じ結果 (Math.random ではなく決定的)', () => {
    const a = sideCoin('cup-1:SF1');
    expect(sideCoin('cup-1:SF1')).toBe(a);
    expect(sideCoin('cup-1:SF1')).toBe(a);
  });

  it('種が違えば結果が変わりうる (大会・試合ごとに独立して決まる)', () => {
    const results = new Set([
      sideCoin('cup-1:SF1'), sideCoin('cup-1:SF2'), sideCoin('cup-2:SF1'), sideCoin('cup-3:FINAL'),
    ]);
    // 4通り全部が同じ値になる (=定数関数) ことはない、というだけの緩い確認
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('buildBracket', () => {
  it('8人フルシードは 1-8 / 4-5 / 2-7 / 3-6 で組まれる', () => {
    const ms = buildBracket(people(8), OPTS).filter(m => m.stage === 0);
    const pairs = ms.map(m => [
      m.slotA.kind === 'participant' ? m.slotA.participantId : null,
      m.slotB.kind === 'participant' ? m.slotB.participantId : null,
    ]);
    expect(pairs).toEqual([
      ['p01', 'p08'],
      ['p04', 'p05'],
      ['p02', 'p07'],
      ['p03', 'p06'],
    ]);
  });

  it('8人ならラウンドは 1回戦/準決勝/決勝 の3段・計7試合', () => {
    const ms = buildBracket(people(8), OPTS);
    expect(ms).toHaveLength(7);
    expect(ms.filter(m => m.stage === 0)).toHaveLength(4);
    expect(ms.filter(m => m.stage === 1)).toHaveLength(2);
    expect(ms.filter(m => m.stage === 2)).toHaveLength(1);
    expect(ms.find(m => m.stage === 2)!.id).toBe('FINAL');
    expect(ms.filter(m => m.stage === 1).map(m => m.id)).toEqual(['SF1', 'SF2']);
  });

  it('5人ならサイズ8・bye3つで、bye同士のカードは1つも出ない', () => {
    const first = buildBracket(people(5), OPTS).filter(m => m.stage === 0);
    expect(first).toHaveLength(4);

    const byeCount = first.reduce((n, m) =>
      n + (m.slotA.kind === 'bye' ? 1 : 0) + (m.slotB.kind === 'bye' ? 1 : 0), 0);
    expect(byeCount).toBe(3);

    const bothBye = first.filter(m => m.slotA.kind === 'bye' && m.slotB.kind === 'bye');
    expect(bothBye).toHaveLength(0);
  });

  it('2人なら決勝1試合だけ', () => {
    const ms = buildBracket(people(2), OPTS);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.id).toBe('FINAL');
    expect(ms[0]!.label).toBe('決勝');
  });

  it('1人・0人では試合が成立しない', () => {
    expect(buildBracket(people(1), OPTS)).toEqual([]);
    expect(buildBracket([], OPTS)).toEqual([]);
  });

  it('thirdPlaceMatch は準決勝2つの loser-of を参照する', () => {
    const ms = buildBracket(people(4), { thirdPlaceMatch: true });
    const third = ms.find(m => m.id === 'THIRD');
    expect(third).toBeDefined();
    expect(third!.slotA).toEqual({ kind: 'loser-of', matchId: 'SF1' });
    expect(third!.slotB).toEqual({ kind: 'loser-of', matchId: 'SF2' });
    expect(third!.label).toBe('3位決定戦');
  });

  it('2人では3位決定戦を作らない (準決勝が存在しない)', () => {
    const ms = buildBracket(people(2), { thirdPlaceMatch: true });
    expect(ms.find(m => m.id === 'THIRD')).toBeUndefined();
  });

  it('sideSeed を省略すると今まで通り slotA が常に若いシード側になる', () => {
    const ms = buildBracket(people(2), OPTS);
    expect(ms[0]!.slotA).toEqual({ kind: 'participant', participantId: 'p01' });
    expect(ms[0]!.slotB).toEqual({ kind: 'participant', participantId: 'p02' });
  });

  it('sideSeed を渡すと試合ごとのコイントスで slotA/slotB が入れ替わりうる', () => {
    // sideCoin('cup-b:FINAL') は false (入れ替えなし)、sideCoin('cup-a:FINAL') は true (入れ替え)
    const noSwap = buildBracket(people(2), { ...OPTS, sideSeed: 'cup-b' })[0]!;
    expect(noSwap.slotA).toEqual({ kind: 'participant', participantId: 'p01' });
    expect(noSwap.slotB).toEqual({ kind: 'participant', participantId: 'p02' });

    const swapped = buildBracket(people(2), { ...OPTS, sideSeed: 'cup-a' })[0]!;
    expect(swapped.slotA).toEqual({ kind: 'participant', participantId: 'p02' });
    expect(swapped.slotB).toEqual({ kind: 'participant', participantId: 'p01' });
  });

  it('明示 slots を尊重する', () => {
    const ms = buildBracket(people(4), {
      thirdPlaceMatch: false,
      slots: ['p03', 'p01', 'p02', 'p04'],
    }).filter(m => m.stage === 0);
    expect(ms.map(m => [
      m.slotA.kind === 'participant' ? m.slotA.participantId : null,
      m.slotB.kind === 'participant' ? m.slotB.participantId : null,
    ])).toEqual([['p03', 'p01'], ['p02', 'p04']]);
  });

  it('明示 slots で両側 bye になったカードも詰まらず下流へ伝播する', () => {
    // 手書きの slots では自動生成と違い bye 同士が起こりうる
    const ms = resolveMatches(buildBracket(people(2), {
      thirdPlaceMatch: false,
      slots: ['p01', 'p02', null, null],
    }));

    const empty = ms.find(m => m.id === 'SF2')!;
    expect(empty.byeA).toBe(true);
    expect(empty.byeB).toBe(true);
    expect(empty.status).toBe('done');
    expect(empty.result!.winnerSide).toBeNull();

    // 決勝は SF1 の結果待ちなのでまだ pending。ただし SF2 側は「勝者不在の枠」= bye と解決済み
    const final = ms.find(m => m.id === 'FINAL')!;
    expect(final.byeB).toBe(true);
    expect(final.status).toBe('pending');

    // SF1 が決まれば、決勝は不戦勝として自動確定し詰まらない
    const done = resolveMatches(confirmResult(
      captureResult(ms, 'SF1', {
        roundResults: [], set: null, decidedBy: 'wins', winnerSide: 0, capturedAt: 1,
      }),
      'SF1', {},
    ));
    const final2 = done.find(m => m.id === 'FINAL')!;
    expect(final2.status).toBe('done');
    expect(final2.result!.decidedBy).toBe('walkover');
    expect(final2.resolvedA).toBe('p01');
  });
});
