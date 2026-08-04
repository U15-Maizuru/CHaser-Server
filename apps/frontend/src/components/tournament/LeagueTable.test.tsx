import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ResolvedParticipant, StandingRow, TournamentMatch } from '@u15/ws-types';
import { LeagueTable } from './LeagueTable';

// 星取表の要点は「行と列がエントリー順で固定されていること」。
// 順位順に並べ替えると、試合が確定するたびに表の行が動いて観客が追えなくなる。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function match(id: string, a: string, b: string, extra: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id, stage: 0, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'pending',
    ...extra,
  };
}

function standing(participantId: string, rank: number): StandingRow {
  return {
    participantId, played: 1, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, rank, tied: false,
  };
}

/** 星取表 (1つ目の table) の行見出し */
function crossTableRowNames(): string[] {
  const table = screen.getAllByRole('table')[0]!;
  return within(table).getAllByRole('row')
    .slice(1) // ヘッダ行を除く
    .map(r => within(r).getAllByRole('cell')[0]!.textContent ?? '');
}

describe('LeagueTable', () => {
  const matches = [
    match('L-D1M1', 'p1', 'p2'),
    match('L-D1M2', 'p1', 'p3'),
    match('L-D2M1', 'p2', 'p3'),
  ];

  it('星取表はエントリー順で、順位が入れ替わっても並び替えない', () => {
    // 順位表では C が1位、A が3位
    const standings = [standing('p3', 1), standing('p2', 2), standing('p1', 3)];
    render(<LeagueTable matches={matches} participants={participants} standings={standings} />);

    expect(crossTableRowNames()).toEqual(['A', 'B', 'C']);
  });

  it('順位表のほうは順位順のまま', () => {
    const standings = [standing('p3', 1), standing('p2', 2), standing('p1', 3)];
    render(<LeagueTable matches={matches} participants={participants} standings={standings} />);

    const table = screen.getAllByRole('table')[1]!;
    const names = within(table).getAllByRole('row').slice(1)
      .map(r => within(r).getAllByRole('cell')[1]!.textContent);
    expect(names).toEqual(['C', 'B', 'A']);
  });

  it('standings が空でも星取表は出る (1試合も終わっていない大会)', () => {
    render(<LeagueTable matches={matches} participants={participants} standings={[]} />);
    expect(crossTableRowNames()).toEqual(['A', 'B', 'C']);
  });

  it('これから行う試合のセルに ▶ を出す', () => {
    render(
      <LeagueTable
        matches={matches} participants={participants} standings={[]}
        upcomingMatchId="L-D2M1"
      />,
    );
    // B×C の2セル (両方向) が対象
    expect(screen.getAllByText('▶')).toHaveLength(2);
  });
});
