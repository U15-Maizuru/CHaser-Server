import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  ResolvedParticipant, StandingRow, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import { TournamentStandby } from './TournamentStandby';

// 試合と試合の間の観戦画面。表が出ることと、たった今終わった試合が
// トーナメント・リーグの**どちらでも**分かることを確かめる。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function done(winnerSide: 0 | 1 | null, confirmedAt = 2): TournamentMatch['result'] {
  return {
    roundResults: [], set: null, decidedBy: 'points', winnerSide,
    capturedAt: 1, confirmedAt,
  };
}

function match(
  id: string, stage: number, a: string, b: string, extra: Partial<TournamentMatch> = {},
): TournamentMatch {
  return {
    id, stage, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'ready',
    ...extra,
  };
}

function standing(participantId: string, rank: number): StandingRow {
  return {
    participantId, played: 1, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, rank, tied: false,
  };
}

function state(
  format: TournamentStatePayload['format'],
  matches: TournamentMatch[],
  standings: StandingRow[] | null = null,
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', format,
    rules: {
      doubleMode: false, mapCatalogId: null, stageMaps: [],
      thirdPlaceMatch: false, leaguePoints: { win: 3, draw: 1, loss: 0 },
      doubleRoundRobin: false,
    },
    participants, matches, standings, stageMaps: [],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('TournamentStandby', () => {
  it('運営を始めた直後は表だけを出す (終わった試合はまだ無い)', () => {
    const matches = [
      { ...match('SF1', 0, 'p1', 'p2'), slotA: { kind: 'participant' as const, participantId: 'p1' } },
      match('SF2', 0, 'p3', 'p4'),
    ];
    render(<TournamentStandby state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    expect(screen.getByText('テスト杯')).toBeInTheDocument();
    expect(screen.getByText('まもなく開始します')).toBeInTheDocument();
    expect(screen.queryByText('✓ 試合終了')).not.toBeInTheDocument();
  });

  it('トーナメント: 確定した試合のカードと勝者が分かる', () => {
    const matches = [
      match('SF1', 0, 'p1', 'p2', { status: 'done', label: '準決勝 第1試合', result: done(1) }),
      match('SF2', 0, 'p3', 'p4'),
    ];
    render(<TournamentStandby state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    // 見出しの結果ピルに勝者が出る
    expect(screen.getByText('B の勝ち')).toBeInTheDocument();
    // 「✓ 試合終了」は見出しのピルと、表の中の該当カードのバッジの2か所だけ
    expect(screen.getAllByText('✓ 試合終了')).toHaveLength(2);
    expect(screen.getAllByText('準決勝 第1試合').length).toBeGreaterThan(0);
  });

  it('リーグ: 確定した試合のセットが星取表で強調される', () => {
    const matches = [
      match('L-D1M1', 0, 'p1', 'p2', { status: 'done', label: '第1節 第1試合', result: done(0) }),
      match('L-D1M2', 0, 'p3', 'p4'),
    ];
    const standings = [standing('p1', 1), standing('p2', 2), standing('p3', 3), standing('p4', 4)];
    render(<TournamentStandby state={state('league', matches, standings)} displayTitle="U15 大会" />);

    expect(screen.getByText('第1節 第1試合')).toBeInTheDocument();
    expect(screen.getByText('A の勝ち')).toBeInTheDocument();

    // 星取表は対称なので (A,B) と (B,A) の2セルが光る
    const cross = screen.getAllByRole('table')[0]!;
    const marked = within(cross).getAllByRole('cell')
      .filter(td => td.style.outline.includes('solid'));
    expect(marked).toHaveLength(2);
  });
});
