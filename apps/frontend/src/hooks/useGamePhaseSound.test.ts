import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Winner, Reason } from '@u15/ws-types';
import type { ServerStatusPayload, GameEndPayload, TurnStartPayload } from '@u15/ws-types';
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
    repeatMode: false,
    demoMode: false,
    currentRound: 0,
    roundResults: [],
    darkMode: false,
  };
}

function gameEnd(winner: Winner, reason: Reason): GameEndPayload {
  return { winner, reason, playerNames: ['COOL', 'HOT'], finalScore: [5, 3] };
}

function turnStart(turn: number, player: number): TurnStartPayload {
  return { turn, player };
}

describe('useGamePhaseSound', () => {
  beforeEach(() => {
    playMock.mockClear();
  });

  it('phase が playing に変わっただけでは go を再生しない (turn_start 待ち)', () => {
    const { rerender } = renderHook(
      ({ s, t }: { s: ServerStatusPayload; t: TurnStartPayload | null }) =>
        useGamePhaseSound(null, s, null, t, false, true),
      { initialProps: { s: status('setup'), t: null } },
    );
    expect(playMock).not.toHaveBeenCalled();

    rerender({ s: status('playing'), t: null });
    expect(playMock).not.toHaveBeenCalledWith('go');
  });

  it('turn_start を受信したら go を再生する', () => {
    const { rerender } = renderHook(
      ({ s, t }: { s: ServerStatusPayload; t: TurnStartPayload | null }) =>
        useGamePhaseSound(null, s, null, t, false, true),
      { initialProps: { s: status('setup'), t: null as TurnStartPayload | null } },
    );

    rerender({ s: status('playing'), t: null });
    expect(playMock).not.toHaveBeenCalledWith('go');

    rerender({ s: status('playing'), t: turnStart(100, 0) });
    expect(playMock).toHaveBeenCalledWith('go');
  });

  it('enabled=false の窓では何も再生しない', () => {
    const { rerender } = renderHook(
      ({ s, t }: { s: ServerStatusPayload; t: TurnStartPayload | null }) =>
        useGamePhaseSound(null, s, null, t, false, false),
      { initialProps: { s: status('setup'), t: null as TurnStartPayload | null } },
    );

    rerender({ s: status('playing'), t: turnStart(100, 0) });
    expect(playMock).not.toHaveBeenCalled();
  });

  it('reason=SCORE で決着したら finish のみ再生する', () => {
    const { rerender } = renderHook(
      ({ s, ge }: { s: ServerStatusPayload; ge: GameEndPayload | null }) =>
        useGamePhaseSound(null, s, ge, null, false, true),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.COOL, Reason.SCORE) });
    expect(playMock).toHaveBeenCalledWith('finish');
    expect(playMock).not.toHaveBeenCalledWith('win');
    expect(playMock).not.toHaveBeenCalledWith('lose');
  });

  it('反則決着 (FOULED/CONFINED/COLLISION) では lose のみ再生する', () => {
    const { rerender } = renderHook(
      ({ s, ge }: { s: ServerStatusPayload; ge: GameEndPayload | null }) =>
        useGamePhaseSound(null, s, ge, null, false, true),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.HOT, Reason.CONFINED) });
    expect(playMock).toHaveBeenCalledWith('lose');
    expect(playMock).not.toHaveBeenCalledWith('finish');
    expect(playMock).not.toHaveBeenCalledWith('win');
  });

  it('包囲/アタックによる決着では win のみ再生する', () => {
    const { rerender } = renderHook(
      ({ s, ge }: { s: ServerStatusPayload; ge: GameEndPayload | null }) =>
        useGamePhaseSound(null, s, ge, null, false, true),
      { initialProps: { s: status('playing'), ge: null as GameEndPayload | null } },
    );

    rerender({ s: status('finished'), ge: gameEnd(Winner.COOL, Reason.TRAPPED) });
    expect(playMock).toHaveBeenCalledWith('win');
    expect(playMock).not.toHaveBeenCalledWith('finish');
    expect(playMock).not.toHaveBeenCalledWith('lose');
  });

  it('muted の場合は何も再生しない', () => {
    const { rerender } = renderHook(
      ({ s, ge, t }: { s: ServerStatusPayload; ge: GameEndPayload | null; t: TurnStartPayload | null }) =>
        useGamePhaseSound(null, s, ge, t, true, true),
      { initialProps: { s: status('setup'), ge: null as GameEndPayload | null, t: null as TurnStartPayload | null } },
    );

    rerender({ s: status('playing'), ge: null, t: turnStart(100, 0) });
    rerender({ s: status('finished'), ge: gameEnd(Winner.COOL, Reason.SCORE), t: turnStart(100, 0) });

    expect(playMock).not.toHaveBeenCalled();
  });

  it('ミュート中に phase が変化しても、解除後に go が誤爆しない (prevPhase が陳腐化しない)', () => {
    const { rerender } = renderHook(
      ({ s, t, muted }: { s: ServerStatusPayload; t: TurnStartPayload | null; muted: boolean }) =>
        useGamePhaseSound(null, s, null, t, muted, true),
      { initialProps: { s: status('setup'), t: null as TurnStartPayload | null, muted: true } },
    );

    // ミュート中に setup → playing → turn_start
    rerender({ s: status('playing'), t: null, muted: true });
    rerender({ s: status('playing'), t: turnStart(100, 0), muted: true });
    expect(playMock).not.toHaveBeenCalled();

    // ミュート解除。phase はまだ 'playing' のまま (再遷移していない) なので go は鳴らない
    rerender({ s: status('playing'), t: turnStart(100, 0), muted: false });
    expect(playMock).not.toHaveBeenCalledWith('go');
  });
});
