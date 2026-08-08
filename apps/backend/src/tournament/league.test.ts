import { describe, it, expect } from 'vitest';
import type { ParticipantDef } from '@u15/ws-types';
import { buildLeague } from './league.js';

function people(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `プレイヤー${i + 1}`, seed: i + 1, program: null,
  }));
}

const SINGLE = { doubleRoundRobin: false };

function pairsOf(ms: ReturnType<typeof buildLeague>): [string, string][] {
  return ms.map(m => [
    m.slotA.kind === 'participant' ? m.slotA.participantId : '',
    m.slotB.kind === 'participant' ? m.slotB.participantId : '',
  ]);
}

describe('buildLeague', () => {
  it('総当たりの試合数は n(n-1)/2', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      expect(buildLeague(people(n), SINGLE)).toHaveLength((n * (n - 1)) / 2);
    }
  });

  it('全ての組み合わせがちょうど1回ずつ現れる', () => {
    const ms = buildLeague(people(5), SINGLE);
    const seen = new Set(pairsOf(ms).map(([a, b]) => [a, b].sort().join('-')));
    expect(seen.size).toBe(10);
  });

  it('doubleRoundRobin では試合数が倍になり、先攻後攻が入れ替わる', () => {
    const single = buildLeague(people(4), SINGLE);
    const double = buildLeague(people(4), { doubleRoundRobin: true });
    expect(double).toHaveLength(single.length * 2);

    const firstHalf  = pairsOf(double).slice(0, single.length);
    const secondHalf = pairsOf(double).slice(single.length);
    expect(secondHalf).toEqual(firstHalf.map(([a, b]) => [b, a]));
  });

  it('同一節に同じ参加者が2回出ない', () => {
    for (const n of [4, 5, 6, 7]) {
      const ms = buildLeague(people(n), SINGLE);
      const byStage = new Map<number, string[]>();
      for (const m of ms) {
        const list = byStage.get(m.stage) ?? [];
        if (m.slotA.kind === 'participant') list.push(m.slotA.participantId);
        if (m.slotB.kind === 'participant') list.push(m.slotB.participantId);
        byStage.set(m.stage, list);
      }
      for (const [, list] of byStage) {
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it('奇数人では各節にちょうど1人だけ休みが出る', () => {
    const n  = 5;
    const ms = buildLeague(people(n), SINGLE);
    const stages = new Set(ms.map(m => m.stage));
    expect(stages.size).toBe(n); // 奇数人は n 節

    for (const s of stages) {
      const playing = ms.filter(m => m.stage === s).length * 2;
      expect(playing).toBe(n - 1); // 1人が休み
    }
  });

  it('偶数人では全員が毎節出場する', () => {
    const n  = 6;
    const ms = buildLeague(people(n), SINGLE);
    const stages = new Set(ms.map(m => m.stage));
    expect(stages.size).toBe(n - 1);
    for (const s of stages) {
      expect(ms.filter(m => m.stage === s).length * 2).toBe(n);
    }
  });

  it('明示 pairs は重複しないよう節へ振り分けられる', () => {
    const ms = buildLeague(people(4), {
      doubleRoundRobin: false,
      pairs: [['p1', 'p2'], ['p1', 'p3'], ['p3', 'p4']],
    });
    expect(ms).toHaveLength(3);
    // p1 が続くので第1節には入れない / p3-p4 は p1-p2 と両立するので同じ節
    expect(ms.find(m => m.id.startsWith('L-D1'))!.stage).toBe(0);
    const stagesById = new Map(ms.map(m => [pairsOf([m])[0]!.join('-'), m.stage]));
    expect(stagesById.get('p1-p2')).toBe(0);
    expect(stagesById.get('p3-p4')).toBe(0);
    expect(stagesById.get('p1-p3')).toBe(1);
  });

  it('1人以下では試合が成立しない', () => {
    expect(buildLeague(people(1), SINGLE)).toEqual([]);
    expect(buildLeague([], SINGLE)).toEqual([]);
  });
});
