import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Winner, Reason } from '@u15/ws-types';
import type { ServerStatusPayload, GameEndPayload } from '@u15/ws-types';
import { useGamePhaseSound } from './useGamePhaseSound';

const playMock = vi.fn();

vi.mock('./useSound', () => ({
  useSound: () => ({ play: playMock }),
  useScoreSound: () => {},
}));

function status(phase: ServerStatusPayload['phase']): ServerStatusPayload {
  return {
    phase,
    localIP: '127.0.0.1',
    clients: [
      { type: 'cpu', state: 'ready', name: 'COOL', ip: '', port: 12031 },
      { type: 'cpu', state: 'ready', name: 'HOT',  ip: '', port: 12032 },
    ],
    doubleMode: false,
    currentRound: 0,
    roundResults: [],
  };
}

function gameEnd(winner: Winner): GameEndPayload {
  return { winner, reason: Reason.SCORE, playerNames: ['COOL', 'HOT'], finalScore: [5, 3] };
}

describe('useGamePhaseSound', () => {
  beforeEach(() => {
    playMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('phase が setup → playing に変わったら go を再生する', () => {
    const { rerender } = renderHook(
      ({ s }) => useGamePhaseSound(null, s, null, false),
      { initialProps: { s: status('setup') } },
    );
    expect(playMock).not.toHaveBeenCalled();

    rerender({ s: status('playing') });
    expect(playMock).toHaveBeenCalledWith('go');
  });

  it('phase が finished かつ gameEnd があれば finish を再生する', () => {
    const { rerender } = renderHook(
      ({ s, ge }) => useGamePhaseSound(null, s, ge, false),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.COOL) });
    expect(playMock).toHaveBeenCalledWith('finish');
  });

  it('勝者がいる場合は800ms後に win を再生する', () => {
    const { rerender } = renderHook(
      ({ s, ge }) => useGamePhaseSound(null, s, ge, false),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.HOT) });
    expect(playMock).not.toHaveBeenCalledWith('win');

    vi.advanceTimersByTime(800);
    expect(playMock).toHaveBeenCalledWith('win');
  });

  it('DRAW の場合は win を再生しない', () => {
    const { rerender } = renderHook(
      ({ s, ge }) => useGamePhaseSound(null, s, ge, false),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.DRAW) });
    vi.advanceTimersByTime(800);
    expect(playMock).not.toHaveBeenCalledWith('win');
  });

  it('muted の場合は何も再生しない', () => {
    const { rerender } = renderHook(
      ({ s, ge }) => useGamePhaseSound(null, s, ge, true),
      { initialProps: { s: status('setup'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('playing'), ge: null });
    rerender({ s: status('finished'), ge: gameEnd(Winner.COOL) });
    vi.advanceTimersByTime(800);

    expect(playMock).not.toHaveBeenCalled();
  });
});
