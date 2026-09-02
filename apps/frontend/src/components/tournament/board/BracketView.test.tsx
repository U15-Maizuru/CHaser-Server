import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import { BracketView } from './BracketView';
import { playerCardHeight } from './PlayerCard';

// トーナメント表は「1人1カード」を絶対配置で並べ、対になる2枚の間に対戦カードを挟む。
// レイアウト (centeredBracketLayout) はカードの高さを**1つの値**として受け取るので、
// 所属のある人と無い人でカードの高さが変わると、対戦カードと接続線の行き先がずれる。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function match(id: string, stage: number, a: string, b: string): TournamentMatch {
  return {
    id, stage, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'ready',
  };
}

const matches = [
  match('SF1', 0, 'p1', 'p2'),
  match('SF2', 0, 'p3', 'p4'),
  {
    ...match('FINAL', 1, 'p1', 'p3'),
    slotA: { kind: 'winner-of' as const, matchId: 'SF1' },
    slotB: { kind: 'winner-of' as const, matchId: 'SF2' },
  },
];

/** 描かれたプレイヤーカードの高さ (px)。不戦の枠は隠されるので出てこない */
function cardHeights(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>('[style*="position: absolute"]')]
    .map(el => el.style.height)
    .filter(h => h !== '')
    .map(h => Number.parseInt(h, 10));
}

describe('BracketView の所属表示', () => {
  it('所属を持つ人が1人でもいれば、全カードが同じ (所属つきの) 高さになる', () => {
    const withAff = participants.map(p =>
      (p.id === 'p1' ? { ...p, affiliation: '舞鶴中学校' } : p));
    const { container } = render(<BracketView matches={matches} participants={withAff} />);

    // A は準決勝と決勝 (勝ち上がり先) の両方のカードに出る
    expect(screen.getAllByText('舞鶴中学校').length).toBeGreaterThan(0);

    // 所属を持たない B・C・D のカードも、A と同じ高さで場所を空ける
    const tall = playerCardHeight(true);
    const heights = cardHeights(container).filter(h => h >= tall);
    expect(heights.length).toBeGreaterThan(0);
    expect(new Set(heights)).toEqual(new Set([tall]));
  });

  it('誰も所属を持たない大会では、これまでどおり1行ぶんの高さのまま', () => {
    const { container } = render(<BracketView matches={matches} participants={participants} />);

    const short = playerCardHeight(false);
    const heights = cardHeights(container).filter(h => h >= short);
    expect(new Set(heights)).toEqual(new Set([short]));
    expect(short).toBeLessThan(playerCardHeight(true));
  });
});
