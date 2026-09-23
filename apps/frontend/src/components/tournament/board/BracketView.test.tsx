import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import { BracketView } from './BracketView';
import { playerCardHeight } from './PlayerCard';
import { GOLD_LIGHT } from '../../../ui';
import { toRgb } from '../../../test/colorAssertions';

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

const isGold = (el: HTMLElement) => el.style.background === toRgb(GOLD_LIGHT);

// finishedId (直前に確定した試合) は、その試合の勝者/敗者が新しく上がった
// 「次のラウンドの枠」を金色にする。試合そのものではなく、参照している先を金色にする
describe('BracketView の直近の注目枠 (finishedId)', () => {
  const semisFinalThird: TournamentMatch[] = [
    match('SF1', 0, 'p1', 'p2'),
    match('SF2', 0, 'p3', 'p4'),
    {
      ...match('FINAL', 1, 'p1', 'p3'),
      label: '決勝',
      slotA: { kind: 'winner-of' as const, matchId: 'SF1' },
      slotB: { kind: 'winner-of' as const, matchId: 'SF2' },
    },
    {
      ...match('THIRD', 1, 'p2', 'p4'),
      label: '3位決定戦',
      order: 1,
      slotA: { kind: 'loser-of' as const, matchId: 'SF1' },
      slotB: { kind: 'loser-of' as const, matchId: 'SF2' },
    },
  ];

  it('準決勝が終わると、決勝と3位決定戦の当該枠の両方が金色になる', () => {
    render(<BracketView matches={semisFinalThird} participants={participants} finishedId="SF1" />);

    // FINAL/THIRD ともに side0 (SF1 を参照する側) だけが金色、side1 (SF2 側) は金色でない
    const [finalSide0, finalSide1] = screen.getAllByTitle('決勝');
    const [thirdSide0, thirdSide1] = screen.getAllByTitle('3位決定戦');
    expect(isGold(finalSide0!)).toBe(true);
    expect(isGold(finalSide1!)).toBe(false);
    expect(isGold(thirdSide0!)).toBe(true);
    expect(isGold(thirdSide1!)).toBe(false);
  });

  it('終わった準決勝自身のカードは金色にならない (通常の試合終了カードの色で足りる)', () => {
    render(<BracketView matches={semisFinalThird} participants={participants} finishedId="SF1" />);

    const [sf1Side0, sf1Side1] = screen.getAllByTitle('SF1');
    expect(isGold(sf1Side0!)).toBe(false);
    expect(isGold(sf1Side1!)).toBe(false);
  });

  it('finishedId が無ければ、どの枠も金色にならない', () => {
    render(<BracketView matches={semisFinalThird} participants={participants} />);

    expect(screen.getAllByTitle('決勝').some(isGold)).toBe(false);
    expect(screen.getAllByTitle('3位決定戦').some(isGold)).toBe(false);
  });
});
