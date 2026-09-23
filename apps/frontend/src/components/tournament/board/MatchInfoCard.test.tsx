import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { RoundResult, TournamentMatch, TournamentMatchResult } from '@u15/ws-types';
import { MatchInfoCard } from './MatchInfoCard';

// トーナメント表の対戦カードは試合ラベルと状態バッジだけを持つ。勝敗数や裁定理由といった
// 試合結果そのものはここでは出さない (結果を見せるのはトーナメント表の役目ではない)。

afterEach(() => cleanup());

const dummyRound = {} as RoundResult;

function resultOf(opts: {
  rounds: number; wins: [number, number]; decidedBy: 'wins' | 'points' | 'manual';
}): TournamentMatchResult {
  return {
    roundResults: Array.from({ length: opts.rounds }, () => dummyRound),
    set: {
      wins: opts.wins, totals: [0, 0], draws: 0,
      winnerSide: opts.wins[0] === opts.wins[1] ? null : (opts.wins[0] > opts.wins[1] ? 0 : 1),
      decidedBy: opts.decidedBy === 'manual' ? null : opts.decidedBy,
    },
    decidedBy: opts.decidedBy,
    winnerSide: opts.wins[0] >= opts.wins[1] ? 0 : 1,
    capturedAt: 0,
    confirmedAt: 0,
  };
}

function baseMatch(status: TournamentMatch['status'], result?: TournamentMatchResult): TournamentMatch {
  return {
    id: 'FINAL', stage: 0, order: 0, label: '決勝',
    slotA: { kind: 'participant', participantId: 'p1' },
    slotB: { kind: 'participant', participantId: 'p2' },
    resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
    status,
    ...(result ? { result } : {}),
  };
}

describe('MatchInfoCard は試合結果を出さない', () => {
  it('2ゲームで決着した試合でも勝敗数を出さない', () => {
    render(<MatchInfoCard match={baseMatch('done', resultOf({ rounds: 2, wins: [2, 0], decidedBy: 'wins' }))} />);
    expect(screen.queryByText('2-0')).toBeNull();
  });

  it('審判裁定の試合でも裁定の注記を出さない', () => {
    const result = resultOf({ rounds: 2, wins: [1, 1], decidedBy: 'manual' });
    result.note = '抽選';
    render(<MatchInfoCard match={baseMatch('done', result)} />);
    expect(screen.queryByText(/裁定/)).toBeNull();
  });

  it('試合終了カードには試合ラベルと状態バッジだけが出る', () => {
    render(<MatchInfoCard match={baseMatch('done', resultOf({ rounds: 2, wins: [2, 0], decidedBy: 'wins' }))} />);
    expect(screen.getByText('決勝')).toBeTruthy();
    expect(screen.queryByText(/^\d+-\d+/)).toBeNull();
  });
});
