import { useEffect, useRef, useState } from 'react';
import type { TurnStartPayload } from '@u15/ws-types';
import { START_COUNTDOWN_SECONDS } from '@u15/ws-types';

/**
 * armed が false → true に変わった瞬間から見た目上 START_COUNTDOWN_SECONDS, ..., 1 と
 * カウントダウンする。0 を経由せず null に直接遷移するため "0" が一瞬表示されることはない。
 *
 * 呼び出し側は「対戦を今から始めてよい」タイミングで armed を true にする。コントロール窓は
 * 場面転換が無いので phase==='playing' をそのまま渡せばよいが、観戦窓 (DisplayMode) は
 * 待機画面→対戦画面の暗転が明けてから true にする — 暗転中にカウントダウンが進んでしまうと、
 * 画面が見えた時点で数字がすでに減っている (ServerManager の startDelayMs 側で暗転ぶんの
 * 余裕を足してあるのは、この後ろ倒しにした分を吸収するため)。
 *
 * バックエンドが実際にターンループを開始した合図 (turnInfo の更新) を受け取ったら、
 * ローカルタイマーの残り時間に関わらず即座にカウントダウンを終了する。これにより、
 * 見た目のカウントダウン終了が実際のゲーム開始タイミングとズレない。
 */
export function useStartCountdown(
  armed:    boolean,
  turnInfo: TurnStartPayload | null,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  const prevArmed   = useRef(armed);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!prevArmed.current && armed) {
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
    prevArmed.current = armed;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [armed]);

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
