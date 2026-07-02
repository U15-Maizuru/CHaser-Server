import { useEffect, useRef } from 'react';
import type { GameEndPayload, GameStateSnapshot, ServerStatusPayload } from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { useSound, useScoreSound } from './useSound';

/**
 * フェーズ遷移 (go/finish/win) とスコア変化 (get_C/get_H) の SE 再生をまとめて行う。
 * ControlApp (App.tsx) と DisplayMode.tsx で同一ロジックが重複していたため共通化。
 */
export function useGamePhaseSound(
  snapshot:     GameStateSnapshot   | null,
  serverStatus: ServerStatusPayload | null,
  gameEnd:      GameEndPayload      | null,
  muted:        boolean,
): void {
  const { play } = useSound();
  useScoreSound(snapshot, muted, play);

  const prevPhase = useRef(serverStatus?.phase);
  useEffect(() => {
    if (muted) return;
    const phase = serverStatus?.phase;
    if (prevPhase.current !== 'playing' && phase === 'playing') play('go');
    if (phase === 'finished' && gameEnd) {
      play('finish');
      if (gameEnd.winner === Winner.COOL || gameEnd.winner === Winner.HOT)
        setTimeout(() => play('win'), 800);
    }
    prevPhase.current = phase;
  }, [serverStatus?.phase, gameEnd, play, muted]);
}
