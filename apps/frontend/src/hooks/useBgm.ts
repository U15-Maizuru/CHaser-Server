import { useEffect, useRef } from 'react';

/**
 * 場面ごとの BGM ループ再生。鳴らす曲は呼び出し側が場面から決めて `track` に渡す。
 *
 * **Audio は常に 1 つしか持たない。** 場面ごとに Audio を用意すると、切り替わった
 * ときに前の曲が止まらず重なって鳴る。
 *
 * 観戦画面 (DisplayMode) のみで有効にする — コントロール窓と両方で鳴らすと
 * 効果音と同様に二重再生になるため (useGamePhaseSound の enabled と同じ理由)。
 */
export function useBgm(
  httpBase: string,
  /** いま鳴らすべき曲のファイル名。'none' なら止める */
  track:    string,
  muted:    boolean,
  enabled:  boolean,
): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 曲が変われば前を捨てて作り直す。新しい Audio は頭から始まる
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

  // 再生・停止の切り替え。**この effect は上より後に置くこと** — React は同じコミット内で
  // 宣言順に走るので、先に置くと差し替え前の Audio を見て古い曲を鳴らしてしまう。
  // track を依存に入れているのも、差し替え直後にこの effect を走らせるため。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted)             audio.pause();
    else if (audio.paused) void audio.play().catch(() => {});
  }, [track, muted, enabled]);
}
