import { describe, expect, it } from 'vitest';
import type { ParticipantDef, TournamentDefinition } from '@u15/ws-types';
import { isPairingManual, shuffledSeedOrder, withSeedOrder } from './seedShuffle.js';

const people = (n: number, extra: Partial<ParticipantDef> = {}): ParticipantDef[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, seed: i + 1, program: null, ...extra,
  }));

function def(over: Partial<TournamentDefinition> = {}): TournamentDefinition {
  return {
    formatVersion: 1, id: 'cup', name: 'cup',
    match: { doubleMode: false },
    stage: { format: 'single-elimination', thirdPlaceMatch: false, map: { catalogId: null, bracketStages: [] } },
    participants: people(8),
    ...over,
  } as TournamentDefinition;
}

/** 決定的な乱数列 */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('isPairingManual', () => {
  it('手で組んだ並びがなければ手動ではない', () => {
    expect(isPairingManual(def())).toBe(false);
  });

  it('決勝トーナメントの並び (bracket.slots) を持てば手動', () => {
    const slots = people(8).map(p => p.id);
    expect(isPairingManual(def({ bracket: { size: 8, slots } }))).toBe(true);
  });

  it('リーグ戦の対戦カード (schedule.pairs) を持てば手動', () => {
    expect(isPairingManual(def({ schedule: { pairs: [['p1', 'p2']] } }))).toBe(true);
  });

  it('予選リーグの振り分け (participant.group) を持てば手動', () => {
    expect(isPairingManual(def({ participants: people(8, { group: 0 }) }))).toBe(true);
  });
});

describe('shuffledSeedOrder', () => {
  it('全参加者を1度ずつ含む並べ替えを返す', () => {
    const order = shuffledSeedOrder(def(), Math.random)!;
    expect([...order].sort()).toEqual(people(8).map(p => p.id).sort());
  });

  it('乱数で並びが決まる (同じ乱数なら同じ並び)', () => {
    const a = shuffledSeedOrder(def(), seq(0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.6));
    const b = shuffledSeedOrder(def(), seq(0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.6));
    expect(a).toEqual(b);
    expect(a).not.toEqual(people(8).map(p => p.id));
  });

  it('手動の組み合わせは null (今の並びを保つ)', () => {
    expect(shuffledSeedOrder(def({ schedule: { pairs: [['p1', 'p2']] } }))).toBeNull();
  });

  it('BOT対戦予選は組み合わせが無いので null', () => {
    const bot = def({
      stage: {
        format: 'bot-then-bracket', advanceCount: 4, thirdPlaceMatch: false,
        bot: { program: null, participantSide: 0 },
        qualifyingDoubleMode: false,
        map: { catalogId: null, bracketStages: [] },
      },
    } as unknown as Partial<TournamentDefinition>);
    expect(shuffledSeedOrder(bot)).toBeNull();
  });
});

describe('withSeedOrder', () => {
  it('先頭を選手番号 1 として seed を振り直す。参加者の記載順は変えない', () => {
    const out = withSeedOrder(def({ participants: people(3) }), ['p3', 'p1', 'p2']);
    expect(out.participants.map(p => [p.id, p.seed])).toEqual([['p1', 2], ['p2', 3], ['p3', 1]]);
  });

  it('元の定義は書き換えない', () => {
    const d = def({ participants: people(3) });
    withSeedOrder(d, ['p3', 'p1', 'p2']);
    expect(d.participants.map(p => p.seed)).toEqual([1, 2, 3]);
  });

  it('null / 省略なら定義をそのまま返す', () => {
    const d = def();
    expect(withSeedOrder(d, null)).toBe(d);
    expect(withSeedOrder(d, undefined)).toBe(d);
  });

  it('今の参加者の並べ替えになっていなければ無視する (参加者を差し替えた古い state.json)', () => {
    const d = def({ participants: people(3) });
    expect(withSeedOrder(d, ['p1', 'p2'])).toBe(d);              // 足りない
    expect(withSeedOrder(d, ['p1', 'p2', 'zz'])).toBe(d);        // 知らない人
    expect(withSeedOrder(d, ['p1', 'p1', 'p2'])).toBe(d);        // 重複
  });
});
