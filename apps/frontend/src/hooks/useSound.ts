import { useCallback, useEffect, useRef } from 'react';

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
    // Preload all sounds
    for (const [key, src] of Object.entries(SOUND_FILES) as [SoundKey, string][]) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      cache.current[key] = audio;
    }
  }, []);

  const play = useCallback((key: SoundKey) => {
    const audio = cache.current[key];
    if (!audio) return;
    // Rewind and play
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  return { play };
}
