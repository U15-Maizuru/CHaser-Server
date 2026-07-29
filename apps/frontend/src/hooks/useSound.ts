import { useCallback, useEffect, useRef } from 'react';
import type { GameStateSnapshot } from '@u15/ws-types';

type SoundKey = 'go' | 'ready' | 'finish' | 'get_C' | 'get_H' | 'win' | 'lose';

const SOUND_FILES: Record<SoundKey, string> = {
  go:     new URL('../assets/Sound/go.mp3',     import.meta.url).href,
  ready:  new URL('../assets/Sound/ready.mp3',  import.meta.url).href,
  finish: new URL('../assets/Sound/finish.mp3', import.meta.url).href,
  get_C:  new URL('../assets/Sound/get_C.mp3',  import.meta.url).href,
  get_H:  new URL('../assets/Sound/get_H.mp3',  import.meta.url).href,
  win:    new URL('../assets/Sound/win.mp3',    import.meta.url).href,
  lose:   new URL('../assets/Sound/lose.mp3',   import.meta.url).href,
};

export function useSound() {
  const cache = useRef<Partial<Record<SoundKey, HTMLAudioElement>>>({});

  useEffect(() => {
    for (const [key, src] of Object.entries(SOUND_FILES) as [SoundKey, string][]) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      cache.current[key] = audio;
    }
  }, []);

  const play = useCallback((key: SoundKey) => {
    const audio = cache.current[key];
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  return { play };
}

export function useScoreSound(
  snapshot: GameStateSnapshot | null,
  muted:    boolean,
  play:     (key: SoundKey) => void,
): void {
  const prevC = useRef(0);
  const prevH = useRef(0);

  useEffect(() => {
    const sc = snapshot?.teamScore;
    if (!sc) return;
    // スコア追跡は mute の状態に関わらず常時継続し、play() 呼び出しのみ mute でゲートする
    if (!muted) {
      if (sc[0] > prevC.current) play('get_C');
      if (sc[1] > prevH.current) play('get_H');
    }
    prevC.current = sc[0];
    prevH.current = sc[1];
  }, [snapshot?.teamScore, muted, play]);
}
