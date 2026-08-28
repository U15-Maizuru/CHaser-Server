import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DEFAULT_DISPLAY_PREFS, Winner, Reason } from '@u15/ws-types';
import type { ServerStatusPayload, GameEndPayload, TurnStartPayload } from '@u15/ws-types';
import { useGamePhaseSound, type GamePhaseSoundInput } from './useGamePhaseSound';

const playMock = vi.fn();

vi.mock('./useSound', () => ({
  useSound: () => ({ play: playMock }),
  useScoreSound: () => {},
}));

type ClientState = 'waiting' | 'connected' | 'ready';

function status(phase: ServerStatusPayload['phase'], state: ClientState = 'ready'): ServerStatusPayload {
  return {
    phase,
    localIP: '127.0.0.1',
    clients: [
      { type: 'cpu', state, name: 'COOL', ip: '', port: 2009 },
      { type: 'cpu', state, name: 'HOT',  ip: '', port: 2010 },
    ],
    doubleMode: false,
    repeatMode: false,
    demoMode: false,
    currentRound: 0,
    roundResults: [],
    darkMode: false,
    mapSource: { kind: 'random' },
    displayPrefs: DEFAULT_DISPLAY_PREFS,
    previewMapId: null,
  };
}

function gameEnd(winner: Winner, reason: Reason): GameEndPayload {
  return { winner, reason, playerNames: ['COOL', 'HOT'], finalScore: [5, 3], remainingTurns: 0 };
}

function turnStart(turn: number, player: number): TurnStartPayload {
  return { turn, player };
}

/** 見たい項目だけを上書きして渡す */
function input(over: Partial<GamePhaseSoundInput> = {}): GamePhaseSoundInput {
  return {
    httpBase:     'http://127.0.0.1:8765',
    snapshot:     null,
    serverStatus: status('setup'),
    gameEnd:      null,
    turnInfo:     null,
    countdown:    null,
    awarding:     false,
    muted:        false,
    enabled:      true,
    ...over,
  };
}

function render(initial: GamePhaseSoundInput) {
  return renderHook((p: GamePhaseSoundInput) => useGamePhaseSound(p), { initialProps: initial });
}

function countOf(key: string): number {
  return playMock.mock.calls.filter(c => c[0] === key).length;
}

describe('useGamePhaseSound', () => {
  beforeEach(() => {
    playMock.mockClear();
  });

  it('phase が playing に変わっただけでは開始音を鳴らさない (turn_start 待ち)', () => {
    const { rerender } = render(input());
    expect(playMock).not.toHaveBeenCalled();

    rerender(input({ serverStatus: status('playing') }));
    expect(playMock).not.toHaveBeenCalledWith('game-start');
  });

  it('turn_start を受信したら開始音を鳴らす', () => {
    const { rerender } = render(input());

    rerender(input({ serverStatus: status('playing') }));
    expect(playMock).not.toHaveBeenCalledWith('game-start');

    rerender(input({ serverStatus: status('playing'), turnInfo: turnStart(100, 0) }));
    expect(playMock).toHaveBeenCalledWith('game-start');
  });

  it('enabled=false の窓では何も再生しない', () => {
    const { rerender } = render(input({ enabled: false }));

    rerender(input({
      serverStatus: status('playing'), turnInfo: turnStart(100, 0),
      countdown: 3, awarding: true, enabled: false,
    }));
    expect(playMock).not.toHaveBeenCalled();
  });

  it('得点で決着したら end-score だけを鳴らす', () => {
    const { rerender } = render(input({ serverStatus: status('playing') }));

    rerender(input({ serverStatus: status('finished'), gameEnd: gameEnd(Winner.COOL, Reason.SCORE) }));
    expect(playMock).toHaveBeenCalledWith('end-score');
    expect(playMock).not.toHaveBeenCalledWith('end-decisive');
    expect(playMock).not.toHaveBeenCalledWith('end-blunder');
  });

  it('自滅による決着 (自縛/衝突/通信エラー) では end-blunder だけを鳴らす', () => {
    const { rerender } = render(input({ serverStatus: status('playing') }));

    rerender(input({ serverStatus: status('finished'), gameEnd: gameEnd(Winner.HOT, Reason.CONFINED) }));
    expect(playMock).toHaveBeenCalledWith('end-blunder');
    expect(playMock).not.toHaveBeenCalledWith('end-score');
    expect(playMock).not.toHaveBeenCalledWith('end-decisive');
  });

  it('相手を追い詰めての決着 (閉じ込め/アタック) では end-decisive だけを鳴らす', () => {
    const { rerender } = render(input({ serverStatus: status('playing') }));

    rerender(input({ serverStatus: status('finished'), gameEnd: gameEnd(Winner.COOL, Reason.TRAPPED) }));
    expect(playMock).toHaveBeenCalledWith('end-decisive');
    expect(playMock).not.toHaveBeenCalledWith('end-score');
    expect(playMock).not.toHaveBeenCalledWith('end-blunder');
  });

  it('muted の場合は何も再生しない', () => {
    const { rerender } = render(input({ muted: true }));

    rerender(input({ serverStatus: status('playing'), turnInfo: turnStart(100, 0), muted: true }));
    rerender(input({
      serverStatus: status('finished'), gameEnd: gameEnd(Winner.COOL, Reason.SCORE),
      turnInfo: turnStart(100, 0), muted: true,
    }));

    expect(playMock).not.toHaveBeenCalled();
  });

  it('ミュート中に phase が変化しても、解除後に開始音が誤爆しない (prevPhase が陳腐化しない)', () => {
    const { rerender } = render(input({ muted: true }));

    // ミュート中に setup → playing → turn_start
    rerender(input({ serverStatus: status('playing'), muted: true }));
    rerender(input({ serverStatus: status('playing'), turnInfo: turnStart(100, 0), muted: true }));
    expect(playMock).not.toHaveBeenCalled();

    // ミュート解除。phase はまだ 'playing' のまま (再遷移していない) なので開始音は鳴らない
    rerender(input({ serverStatus: status('playing'), turnInfo: turnStart(100, 0), muted: false }));
    expect(playMock).not.toHaveBeenCalledWith('game-start');
  });

  it('両プログラムが揃った瞬間だけ players-ready を鳴らす', () => {
    const { rerender } = render(input({ serverStatus: status('setup', 'connected') }));
    expect(playMock).not.toHaveBeenCalledWith('players-ready');

    rerender(input({ serverStatus: status('setup', 'ready') }));
    expect(countOf('players-ready')).toBe(1);

    // 揃ったまま待機し続けても鳴り続けない
    rerender(input({ serverStatus: status('setup', 'ready') }));
    expect(countOf('players-ready')).toBe(1);
  });

  it('カウントダウンの秒が変わるたびに countdown を鳴らす', () => {
    const { rerender } = render(input());

    rerender(input({ countdown: 3 }));
    rerender(input({ countdown: 2 }));
    rerender(input({ countdown: 1 }));
    expect(countOf('countdown')).toBe(3);

    // 表示が消えた (null) ときは鳴らさない
    rerender(input({ countdown: null }));
    expect(countOf('countdown')).toBe(3);
  });

  it('表彰画面に入った瞬間だけ award-fanfare を鳴らす', () => {
    const { rerender } = render(input());

    rerender(input({ awarding: true }));
    expect(countOf('award-fanfare')).toBe(1);

    rerender(input({ awarding: true }));
    expect(countOf('award-fanfare')).toBe(1);
  });
});
