import { useEffect, useRef } from 'react';
import { SCENE_FADE_MS } from '@u15/ws-types';

const FADE_STEP_MS = 50;

/**
 * audio.volume を target まで滑らかに変化させる。返り値を呼ぶと即座に打ち切れる。
 *
 * requestAnimationFrame ではなく setInterval を使う。対戦表示窓はコントロール窓の裏に
 * 回ったりフォーカスを失ったりしがちで、その間 rAF はブラウザ側で丸ごと止まる —
 * すると前の曲がフェードしきれず volume 0 に届かないまま pause() も呼ばれず、
 * 新しい曲だけ鳴り出して二重に聞こえる。setInterval は裏に回っても動き続ける。
 */
function fadeVolume(
  audio: HTMLAudioElement, target: number, ms: number, onDone?: () => void,
): () => void {
  const from = audio.volume;
  const t0   = Date.now();
  const id = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / ms);
    audio.volume = from + (target - from) * p;
    if (p >= 1) {
      clearInterval(id);
      onDone?.();
    }
  }, FADE_STEP_MS);
  return () => clearInterval(id);
}

/**
 * 場面ごとの BGM ループ再生。曲が変わっても突然切り替えず、前の曲をフェードアウトしながら
 * 次の曲をフェードインする (無音との切り替わりも同様にフェードする)。
 *
 * **Audio は常に 1 つしか ref に持たない。** 前の曲は effect のクリーンアップが持つ
 * ローカル変数 (`audio`) だけを頼りにフェードアウトさせる — ref を頼ると、次の
 * effect が走る前にクリーンアップで null にされてしまい前の曲を見失う。
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

  // 曲が変わるたびに、この曲用の Audio を作ってフェードインする。
  // クリーンアップ (次に曲が変わったとき、またはアンマウント時) でこの曲をフェードアウトする
  useEffect(() => {
    if (!enabled || track === 'none') {
      audioRef.current = null;
      return;
    }

    const audio = new Audio(`${httpBase}/api/music/${encodeURIComponent(track)}`);
    audio.loop   = true;
    audio.volume = 0;
    audioRef.current = audio;
    const cancelIn = fadeVolume(audio, 1, SCENE_FADE_MS);

    return () => {
      cancelIn();
      fadeVolume(audio, 0, SCENE_FADE_MS, () => audio.pause());
      if (audioRef.current === audio) audioRef.current = null;
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
