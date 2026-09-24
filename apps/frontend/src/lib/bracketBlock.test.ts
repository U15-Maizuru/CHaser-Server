import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, TournamentMatch } from '@u15/ws-types';
import { focusBracketBlock } from './bracketBlock';
import { centeredBracketLayout } from './centeredBracketLayout';

function m(
  id: string, stage: number, order: number, slotA: MatchSlotRef, slotB: MatchSlotRef,
): TournamentMatch {
  return {
    id, stage, order, label: id, slotA, slotB,
    resolvedA: null, resolvedB: null, byeA: false, byeB: false, status: 'pending',
  };
}
const P = (id: string): MatchSlotRef => ({ kind: 'participant', participantId: id });
const W = (id: string): MatchSlotRef => ({ kind: 'winner-of', matchId: id });
const L = (id: string): MatchSlotRef => ({ kind: 'loser-of', matchId: id });

/** n 回戦の完全な二分木 (3位決定戦つき)。1回戦は R0-0.. */
function bracket(rounds: number): TournamentMatch[] {
  const out: TournamentMatch[] = [];
  for (let i = 0; i < 2 ** (rounds - 1); i++) {
    out.push(m(`R0-${i}`, 0, i, P(`p${i * 2}`), P(`p${i * 2 + 1}`)));
  }
  for (let r = 1; r < rounds; r++) {
    for (let i = 0; i < 2 ** (rounds - 1 - r); i++) {
      out.push(m(`R${r}-${i}`, r, i, W(`R${r - 1}-${i * 2}`), W(`R${r - 1}-${i * 2 + 1}`)));
    }
  }
  const last = rounds - 1;
  out.push({
    ...m('THIRD', last, 1, L(`R${last - 1}-0`), L(`R${last - 1}-1`)),
    label: '3位決定戦',
  });
  return out;
}

const ids = (ms: TournamentMatch[]) => ms.map(x => x.id).sort();

describe('focusBracketBlock', () => {
  const sixteen = bracket(4);

  it('4回戦の1回戦の試合なら、その試合を含む山と決勝だけを返す (3位決定戦は含めない)', () => {
    const left = focusBracketBlock(sixteen, 'R0-1').matches;
    expect(ids(left)).toEqual(
      ['R0-0', 'R0-1', 'R0-2', 'R0-3', 'R1-0', 'R1-1', 'R2-0', 'R3-0'].sort(),
    );
    const right = focusBracketBlock(sixteen, 'R0-6').matches;
    expect(ids(right)).toEqual(
      ['R0-4', 'R0-5', 'R0-6', 'R0-7', 'R1-2', 'R1-3', 'R2-1', 'R3-0'].sort(),
    );
  });

  it('5回戦でも同じ (4回戦以上)', () => {
    const r = focusBracketBlock(bracket(5), 'R0-0').matches;
    expect(r).toHaveLength(8 + 4 + 2 + 1 + 1);
    expect(r.some(x => x.id === 'R0-15')).toBe(false);
  });

  it('3回戦以下は絞らない', () => {
    const eight = bracket(3);
    expect(focusBracketBlock(eight, 'R0-0')).toEqual({ matches: eight, side: null });
  });

  it('準々決勝以降が基準なら、準々決勝より前の回戦を落とす (左右の山と3位決定戦は残る)', () => {
    for (const target of ['R1-0', 'R2-0', 'R3-0', 'THIRD']) {
      const f = focusBracketBlock(sixteen, target);
      expect(f.side).toBeNull();
      expect(ids(f.matches)).toEqual(
        ['R1-0', 'R1-1', 'R1-2', 'R1-3', 'R2-0', 'R2-1', 'R3-0', 'THIRD'].sort(),
      );
    }
  });

  it('5回戦は準々決勝 (4回戦め) 以降で落とし、2回戦が基準なら絞らない', () => {
    const thirtyTwo = bracket(5);
    const late = focusBracketBlock(thirtyTwo, 'R2-0').matches;
    expect(late.every(x => x.stage >= 2)).toBe(true);
    expect(late).toHaveLength(4 + 2 + 1 + 1);
    expect(focusBracketBlock(thirtyTwo, 'R1-0')).toEqual({ matches: thirtyTwo, side: null });
  });

  it('準々決勝以降に絞った表は、列は準々決勝・準決勝・決勝・準決勝・準々決勝の5本になる', () => {
    const l = centeredBracketLayout(focusBracketBlock(sixteen, 'R2-0').matches);
    // 左の準々決勝・準決勝、中央の決勝、右の準決勝・準々決勝
    expect(l.columns).toHaveLength(5);
    const qf = l.nodes.filter(n => n.matchId.startsWith('R1-') && n.side === 0);
    expect(qf).toHaveLength(4);
  });

  it('基準が無い・見つからないときは絞らない', () => {
    expect(focusBracketBlock(sixteen, null)).toEqual({ matches: sixteen, side: null });
    expect(focusBracketBlock(sixteen, 'nope')).toEqual({ matches: sixteen, side: null });
  });

  it('元の表での左右を返し、描くと左山は左・右山は右に山が寄る (右山なら左が決勝)', () => {
    const cases = [['R0-1', 'left'], ['R0-6', 'right']] as const;
    for (const [target, side] of cases) {
      const f = focusBracketBlock(sixteen, target);
      expect(f.side).toBe(side);
      const l = centeredBracketLayout(f.matches, { soloSide: side });
      expect(new Set(l.nodes.map(n => n.matchId)).size).toBe(8);
      expect(l.columns).toHaveLength(4);
      const first = l.nodes.find(n => n.matchId === target)!;
      const final = l.nodes.find(n => n.matchId === 'R3-0')!;
      if (side === 'left') expect(first.x).toBeLessThan(final.x);
      else expect(first.x).toBeGreaterThan(final.x);
      // 決勝は端に来る (右山なら x=padding の左端)
      const xs = l.nodes.map(n => n.x);
      expect(final.x).toBe(side === 'left' ? Math.max(...xs) : Math.min(...xs));
    }
  });
});

describe('focusBracketBlock — 運営が選んだ型', () => {
  const sixteen = bracket(4);
  const focus = (view: Parameters<typeof focusBracketBlock>[2], target: string | null = null) =>
    focusBracketBlock(sixteen, target, view);

  it("'whole' は基準の試合があっても絞らない", () => {
    expect(focus('whole', 'R0-1')).toEqual({ matches: sixteen, side: null });
  });

  it("'left' / 'right' は基準の試合とは無関係に、その側の山と決勝だけ (3位決定戦なし)", () => {
    const left = focus('left', 'R0-6');
    expect(left.side).toBe('left');
    expect(ids(left.matches)).toEqual(
      ['R0-0', 'R0-1', 'R0-2', 'R0-3', 'R1-0', 'R1-1', 'R2-0', 'R3-0'].sort(),
    );
    const right = focus('right');
    expect(right.side).toBe('right');
    expect(ids(right.matches)).toEqual(
      ['R0-4', 'R0-5', 'R0-6', 'R0-7', 'R1-2', 'R1-3', 'R2-1', 'R3-0'].sort(),
    );
  });

  it("'quarter' は基準の試合とは無関係に、準々決勝から決勝まで (3位決定戦も残る)", () => {
    const f = focus('quarter', 'R0-1');
    expect(f.side).toBeNull();
    expect(ids(f.matches)).toEqual(
      ['R1-0', 'R1-1', 'R1-2', 'R1-3', 'R2-0', 'R2-1', 'R3-0', 'THIRD'].sort(),
    );
  });

  it("'quarter' は3回戦以下なら全体と同じ (準々決勝が1回戦以前になる)", () => {
    const eight = bracket(3);
    expect(ids(focusBracketBlock(eight, null, 'quarter').matches)).toEqual(ids(eight));
  });

  it("'left' / 'right' は2回戦の表でも効く", () => {
    const four = bracket(2);
    const left = focusBracketBlock(four, null, 'left');
    expect(ids(left.matches)).toEqual(['R0-0', 'R1-0']);
  });

  it("'left' / 'right' は山が2つ無い (1回戦だけの) 表なら全体", () => {
    const two = bracket(1).filter(x => x.id !== 'THIRD');
    expect(focusBracketBlock(two, null, 'left')).toEqual({ matches: two, side: null });
  });

  it("'auto' (既定) は基準の試合に従う", () => {
    expect(focus('auto', 'R0-1').side).toBe('left');
    expect(focus('auto', null)).toEqual({ matches: sixteen, side: null });
  });
});

