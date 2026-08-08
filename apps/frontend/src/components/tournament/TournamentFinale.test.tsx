import { afterEach, describe, expect, it } from 'vitest';
import { stageRulesFor } from '../../test/tournamentFixture';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  TournamentFormat,
  ResolvedParticipant, StandingRow, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import { TournamentFinale } from './TournamentFinale';

// 表彰画面は観客席から読むものなので、優勝プレイヤー名と最終結果の表が
// トーナメント・リーグの**どちらでも**出ることを確かめる。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function done(winnerSide: 0 | 1 | null): TournamentMatch['result'] {
  return {
    roundResults: [], set: null, decidedBy: 'points', winnerSide,
    capturedAt: 1, confirmedAt: 2,
  };
}

function match(id: string, stage: number, a: string, b: string, winnerSide: 0 | 1): TournamentMatch {
  return {
    id, stage, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'done', result: done(winnerSide),
  };
}

function standing(participantId: string, rank: number): StandingRow {
  return {
    participantId, played: 3, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, itemPoints: 0, strikePoints: 0, sweepPoints: 0, rank, tied: false,
  };
}

function state(
  format: TournamentFormat,
  matches: TournamentMatch[],
  standings: StandingRow[] | null = null,
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯',
    match: { doubleMode: false },
    stage: stageRulesFor(format),
    participants, matches, standings, groups: null, qualifiers: null, qualifierCandidates: null, stageMaps: [], stageLabels: [],
    qualifiersConfirmed: false,
    displayView: 'auto', autoPlay: { enabled: false, loop: false, stoppedReason: null },
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('TournamentFinale', () => {
  it('トーナメント: 優勝・準優勝とトーナメント表が出る', () => {
    const matches = [
      match('SF1', 0, 'p1', 'p2', 0),
      match('SF2', 0, 'p3', 'p4', 0),
      // 決勝の枠は準決勝を指す (接続線はこの参照から引かれる)
      {
        ...match('FINAL', 1, 'p1', 'p3', 0),
        slotA: { kind: 'winner-of' as const, matchId: 'SF1' },
        slotB: { kind: 'winner-of' as const, matchId: 'SF2' },
      },
    ];
    const { container } = render(
      <TournamentFinale state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    expect(screen.getByText('テスト杯')).toBeInTheDocument();
    expect(screen.getByText('全試合終了')).toBeInTheDocument();
    expect(screen.getByText('優勝')).toBeInTheDocument();
    expect(screen.getByText('準優勝')).toBeInTheDocument();
    // 優勝の A は表彰台と表の両方に出る
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    // トーナメント表の接続線
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0);
  });

  it('リーグ: 上位3位と順位表が出る', () => {
    const standings = [standing('p2', 1), standing('p1', 2), standing('p3', 3), standing('p4', 4)];
    render(<TournamentFinale state={state('league', [], standings)} displayTitle="U15 大会" />);

    expect(screen.getByText('優勝')).toBeInTheDocument();
    expect(screen.getByText('第3位')).toBeInTheDocument();
    // 星取表と順位表
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('勝者不在 (両者棄権) なら表彰台は出さず、表だけ見せる', () => {
    const matches = [
      { ...match('FINAL', 0, 'p1', 'p2', 0), result: done(null) },
    ];
    const { container } = render(
      <TournamentFinale state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    expect(screen.queryByText('優勝')).not.toBeInTheDocument();
    expect(screen.getByText('全試合終了')).toBeInTheDocument();
    expect(container.querySelector('div')).toBeTruthy();
  });
});
