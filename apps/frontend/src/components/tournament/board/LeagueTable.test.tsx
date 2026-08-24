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
    points: 0, totalPoints: 0, itemPoints: 0, strikePoints: 0, sweepPoints: 0,
    items: 0, remainingTurns: 0, rank, tied: false,
  };
}

/** 順位表 (2つ目の table) のデータ行 */
function standingsRows(): HTMLElement[] {
  const table = screen.getAllByRole('table')[1]!;
  return within(table).getAllByRole('row').slice(1) as HTMLElement[];
}

/** その行に色がついているか (通過圏の強調) */
const highlighted = (row: HTMLElement) => row.style.background !== '';

/** その行の下に通過ラインが引かれているか */
const hasCutLine = (row: HTMLElement) =>
  within(row).getAllByRole('cell')[0]!.style.borderBottomWidth === '2px';

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

  // 予選リーグで観客と運営が見たいのは優勝者ではなく「通過ライン」。
  // 1位だけを金色にすると、あと1つで上がれる境目が分からない
  describe('決勝トーナメントの通過順位', () => {
    // 順位表は C(1位) → B(2位) → A(3位)
    const standings = [standing('p3', 1), standing('p2', 2), standing('p1', 3)];

    it('上位 advanceCount 名まで色をつけ、その下に通過ラインを引く', () => {
      render(
        <LeagueTable
          matches={matches} participants={participants} standings={standings}
          advanceCount={2}
        />,
      );

      const rows = standingsRows();
      expect(rows.map(highlighted)).toEqual([true, true, false]);
      expect(rows.map(hasCutLine)).toEqual([false, true, false]);
      expect(screen.getByText(/上位 2 名が決勝トーナメントへ進出/)).toBeTruthy();
    });

    it('advanceCount が無ければ1位だけ (予選の無い単独リーグの優勝者)', () => {
      render(<LeagueTable matches={matches} participants={participants} standings={standings} />);

      const rows = standingsRows();
      expect(rows.map(highlighted)).toEqual([true, false, false]);
      expect(rows.some(hasCutLine)).toBe(false);
      expect(screen.queryByText(/決勝トーナメントへ進出/)).toBeNull();
    });

    it('全員が上がるリーグには線を引かない (引く意味が無い)', () => {
      render(
        <LeagueTable
          matches={matches} participants={participants} standings={standings}
          advanceCount={3}
        />,
      );
      expect(standingsRows().some(hasCutLine)).toBe(false);
    });

    it('運営が枠を差し替えたら、実際に上がる人を色づける', () => {
      // 2位の B ではなく3位の A を上げた。線の位置 (通過ライン) は動かさない
      render(
        <LeagueTable
          matches={matches} participants={participants} standings={standings}
          advanceCount={2} qualifiedIds={['p3', 'p1']}
        />,
      );

      const rows = standingsRows();
      expect(rows.map(highlighted)).toEqual([true, false, true]);
      expect(rows.map(hasCutLine)).toEqual([false, true, false]);
    });
  });

  // 同点で再試合になった試合は discardResult で status: 'ready' / result: undefined に
  // 戻ってしまい、他の未実施のマスと同じ「・」に見えてしまう。rematchPending が立っていれば
  // 別記号を出して見分けられるようにする
  it('同点で再試合になったマスは ↻ を出す (未実施の ・ とは区別する)', () => {
    const withRematch = [
      match('L-D1M1', 'p1', 'p2', { status: 'ready', rematchPending: true }),
      match('L-D1M2', 'p1', 'p3'),
      match('L-D2M1', 'p2', 'p3'),
    ];
    render(<LeagueTable matches={withRematch} participants={participants} standings={[]} />);
    // A×B の2セル (両方向)
    expect(screen.getAllByText('↻')).toHaveLength(2);
    expect(screen.getByText(/↻ 再試合待ち/)).toBeTruthy();
  });

  it('再試合待ちが無ければ凡例に ↻ を出さない', () => {
    render(<LeagueTable matches={matches} participants={participants} standings={[]} />);
    expect(screen.queryByText(/↻/)).toBeNull();
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
