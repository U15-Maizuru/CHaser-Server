import { useEffect, useRef, useState } from 'react';
import type { ServerPhase, TurnStartPayload } from '@u15/ws-types';
import { START_COUNTDOWN_SECONDS } from '@u15/ws-types';

/**
 * phase が 'setup' → 'playing' に変わった瞬間から見た目上 START_COUNTDOWN_SECONDS, ..., 1 と
 * カウントダウンする。0 を経由せず null に直接遷移するため "0" が一瞬表示されることはない。
 *
 * バックエンドが実際にターンループを開始した合図 (turnInfo の更新) を受け取ったら、
 * ローカルタイマーの残り時間に関わらず即座にカウントダウンを終了する。これにより、
 * 見た目のカウントダウン終了が実際のゲーム開始タイミングとズレない。
 */
export function useStartCountdown(
  phase:    ServerPhase | undefined,
  turnInfo: TurnStartPayload | null,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  const prevPhase   = useRef(phase);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (prevPhase.current !== 'playing' && phase === 'playing') {
      let remaining = START_COUNTDOWN_SECONDS;
      setCount(remaining);
      intervalRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          setCount(null);
        } else {
          setCount(remaining);
        }
      }, 1000);
    }
    prevPhase.current = phase;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [phase]);

  // 実際のターン開始 (turn_start 受信) が来たら、ローカルタイマーより先に確定終了させる
  useEffect(() => {
    if (!turnInfo) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setCount(null);
  }, [turnInfo]);

  return count;
}
