import { useEffect, useRef } from 'react';
import type { GameEndPayload, GameStateSnapshot, ServerStatusPayload, TurnStartPayload } from '@u15/ws-types';
import { Reason } from '@u15/ws-types';
import { useSound, useScoreSound } from './useSound';

function isBlunder(reason: Reason): boolean {
  return reason === Reason.CONFINED || reason === Reason.COLLISION || reason === Reason.FOULED;
}

/**
 * フェーズ遷移 (go/finish/win/lose) とスコア変化 (get_C/get_H) の SE 再生をまとめて行う。
 * ControlApp (App.tsx) と DisplayMode.tsx で同一ロジックが重複していたため共通化。
 *
 * enabled=false の窓では一切再生しない。両窓が同時にマウントされるため、両方で
 * 再生すると二重再生 (フラム) になる — 観戦窓 (DisplayMode) のみ enabled=true にする。
 *
 * 開始 SE (go) は固定タイマーではなく、バックエンドが実際にターンループを開始した
 * 合図である turnInfo (turn_start メッセージ) の受信をもって再生する。
 */
export function useGamePhaseSound(
  snapshot:     GameStateSnapshot   | null,
  serverStatus: ServerStatusPayload | null,
  gameEnd:      GameEndPayload      | null,
  turnInfo:     TurnStartPayload    | null,
  muted:        boolean,
  enabled:      boolean,
): void {
  const { play } = useSound();
  const silent = muted || !enabled;
  useScoreSound(snapshot, silent, play);

  // 発火時点の最新値を見られるように ref で持つ
  const silentRef = useRef(silent);
  silentRef.current = silent;

  const prevPhase     = useRef(serverStatus?.phase);
  const awaitingGoRef = useRef(false);

  // phase 遷移の監視: playing に入ったら go 待機フラグを立てる。finished なら終了 SE を排他再生する。
  useEffect(() => {
    const phase = serverStatus?.phase;
    if (prevPhase.current !== 'playing' && phase === 'playing') {
      awaitingGoRef.current = true;
    }
    if (phase === 'finished' && gameEnd) {
      if (!silentRef.current) {
        if (gameEnd.reason === Reason.SCORE)      play('finish');
        else if (isBlunder(gameEnd.reason))       play('lose');
        else                                       play('win');
      }
    }
    if (phase !== 'playing') {
      awaitingGoRef.current = false;
    }
    prevPhase.current = phase;
  }, [serverStatus?.phase, gameEnd, play]);

  // turn_start の受信 (= 実際にターンループが始まった瞬間) で go を再生する
  useEffect(() => {
    if (!turnInfo) return;
    if (awaitingGoRef.current) {
      awaitingGoRef.current = false;
      if (!silentRef.current) play('go');
    }
  }, [turnInfo, play]);
}
