import { useEffect, useRef } from 'react';
import type { ServerPhase } from '@u15/ws-types';

/**
 * ゲーム中の BGM ループ再生。原本 (U15-server) は ./Music フォルダの mp3/wav を
 * ゲーム開始前に選択し、ゲーム中ループ再生、終了時に停止して SE (finish/win/lose) に
 * 差し替える。ここでは phase==='playing' の間だけループ再生し、それ以外では停止する。
 *
 * 観戦画面 (DisplayMode) のみで有効にする — コントロール窓と両方で鳴らすと
 * 効果音と同様に二重再生になるため (useGamePhaseSound の enabled と同じ理由)。
 */
export function useBgm(
  httpBase: string,
  phase:    ServerPhase | undefined,
  track:    string,
  muted:    boolean,
  enabled:  boolean,
): void {
  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const prevPhaseRef = useRef(phase);

  // トラック変更時のみ Audio 要素を作り直す
  useEffect(() => {
    if (!enabled || track === 'none') return;
    const audio = new Audio(`${httpBase}/api/music/${encodeURIComponent(track)}`);
    audio.loop = true;
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [httpBase, track, enabled]);

  // phase / muted の変化に応じて再生・停止を切り替える
  useEffect(() => {
    const audio = audioRef.current;
    const justStarted = prevPhaseRef.current !== 'playing' && phase === 'playing';
    prevPhaseRef.current = phase;
    if (!audio) return;

    if (!muted && phase === 'playing') {
      if (justStarted) audio.currentTime = 0;
      if (audio.paused) void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [phase, muted, track, enabled]);
}
