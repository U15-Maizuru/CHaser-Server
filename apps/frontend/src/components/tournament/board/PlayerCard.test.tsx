import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  ResolvedParticipant, RoundResult, TournamentMatch, TournamentMatchResult,
} from '@u15/ws-types';
import { PlayerCard } from './PlayerCard';
import { GOLD_LIGHT } from '../../../ui';
import { toRgb } from '../../../test/colorAssertions';

// 2ゲーム (試合) の勝敗数は、合計ポイントの数字だけでは伝わらない
// (「1勝1敗、ポイントで決着」なのか「2勝0敗」なのかが違う)。1ゲームだけの試合は
// 勝った側が必ず1勝0敗になり自明なので、2ゲーム消化したときだけ出す。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

const dummyRound = {} as RoundResult;

function resultOf(rounds: number, wins: [number, number], totals: [number, number]): TournamentMatchResult {
  return {
    roundResults: Array.from({ length: rounds }, () => dummyRound),
    set: { wins, totals, draws: 0, winnerSide: wins[0] > wins[1] ? 0 : 1, decidedBy: 'wins' },
    decidedBy: 'wins',
    winnerSide: wins[0] > wins[1] ? 0 : 1,
    capturedAt: 0,
    confirmedAt: 0,
  };
}

function baseMatch(result?: TournamentMatchResult): TournamentMatch {
  return {
    id: 'FINAL', stage: 0, order: 0, label: '決勝',
    slotA: { kind: 'participant', participantId: 'p1' },
    slotB: { kind: 'participant', participantId: 'p2' },
    resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
    status: result ? 'done' : 'ready',
    ...(result ? { result } : {}),
  };
}

describe('PlayerCard の得点欄', () => {
  it('2ゲーム消化した試合は勝敗数と合計ポイントの両方を出す', () => {
    const match = baseMatch(resultOf(2, [2, 0], [140, 90]));
    render(<PlayerCard match={match} side={0} participants={participants} />);

    expect(screen.getByText('2勝')).toBeTruthy();
    expect(screen.getByText('140pt')).toBeTruthy();
  });

  it('1ゲームだけの試合は勝敗数を出さず、合計ポイントの数字だけ (これまでどおり)', () => {
    const match = baseMatch(resultOf(1, [1, 0], [80, 60]));
    render(<PlayerCard match={match} side={0} participants={participants} />);

    expect(screen.queryByText('1勝')).toBeNull();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.queryByText('80pt')).toBeNull();
  });

  it('まだ結果が無い試合は「—」のまま', () => {
    const match = baseMatch();
    render(<PlayerCard match={match} side={0} participants={participants} />);

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('負けた側にも自分の勝敗数・ポイントが出る', () => {
    const match = baseMatch(resultOf(2, [1, 2], [110, 130]));
    render(<PlayerCard match={match} side={0} participants={participants} />);

    expect(screen.getByText('1勝')).toBeTruthy();
    expect(screen.getByText('110pt')).toBeTruthy();
  });
});

// justFinished はこのカード自身の試合の勝敗とは無関係 — 直前に確定した「別の」試合の
// 勝者/敗者が、この (まだ対戦していない) 枠に新しく上がってきたことを示す色。
// BracketView が算出して渡す (advancedSlots)。ここでは PlayerCard 単体でその表示を確かめる
describe('PlayerCard の直近の注目カード (justFinished)', () => {
  it('この試合自体はまだ決着していなくても、金色になる', () => {
    const match = baseMatch(); // 決着前の枠 (ready)
    render(<PlayerCard match={match} side={0} participants={participants} justFinished />);
    expect(screen.getByTitle('決勝').style.background).toBe(toRgb(GOLD_LIGHT));
  });
});
