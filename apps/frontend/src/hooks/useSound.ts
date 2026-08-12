import { useCallback, useEffect, useRef } from 'react';
import { SOUND_KEYS, type GameStateSnapshot, type SoundKey } from '@u15/ws-types';
import { fetchSoundFiles } from '../lib/api';

export type { SoundKey };

// 同梱の SE。**`new URL` の第1引数は静的な文字列で書くこと** — Vite はこれをビルド時に
// 解決してハッシュ付きの名前 (countdown-DstjK5Rn.wav) に置き換える。キーから組み立てると
// 解決されず、本番ビルドで参照が壊れる。キーと同じ名前を並べて書くのはこのため。
const BUNDLED: Record<SoundKey, string> = {
  'countdown':     new URL('../assets/Sound/countdown.wav',     import.meta.url).href,
  'players-ready': new URL('../assets/Sound/players-ready.wav', import.meta.url).href,
  'game-start':    new URL('../assets/Sound/game-start.wav',    import.meta.url).href,
  'item-cool':     new URL('../assets/Sound/item-cool.wav',     import.meta.url).href,
  'item-hot':      new URL('../assets/Sound/item-hot.wav',      import.meta.url).href,
  'end-score':     new URL('../assets/Sound/end-score.wav',     import.meta.url).href,
  'end-decisive':  new URL('../assets/Sound/end-decisive.wav',  import.meta.url).href,
  'end-blunder':   new URL('../assets/Sound/end-blunder.wav',   import.meta.url).href,
  'award-fanfare': new URL('../assets/Sound/award-fanfare.wav', import.meta.url).href,
};

const KEYS = SOUND_KEYS;

/**
 * SE の再生。同梱の音をすぐ使えるように先に読み、`server/sounds` に同名のファイルが
 * 置かれていればそちらへ差し替える。
 *
 * **同梱を読むのは同期的に済ませること。** 差し替えの一覧を待ってから Audio を作ると、
 * 接続直後に始まったゲームの開始音に間に合わない。
 *
 * `enabled=false` の窓では何も読み込まない。鳴らさない窓まで先読みすることになるため。
 */
export function useSound(httpBase: string, enabled: boolean) {
  const cache = useRef<Partial<Record<SoundKey, HTMLAudioElement>>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    for (const key of KEYS) {
      const audio = new Audio(BUNDLED[key]);
      audio.preload = 'auto';
      cache.current[key] = audio;
    }

    void fetchSoundFiles(httpBase).then(files => {
      if (cancelled) return;
      // 拡張子は落として突き合わせる — mp3 でも wav でも同じ音として扱う
      const byName = new Map(files.map(f => [f.replace(/\.[^.]+$/, ''), f]));
      for (const key of KEYS) {
        const file = byName.get(key);
        if (!file) continue;
        const audio = new Audio(`${httpBase}/api/sounds/${encodeURIComponent(file)}`);
        audio.preload = 'auto';
        cache.current[key] = audio;
      }
    });

    return () => {
      cancelled = true;
      cache.current = {};
    };
  }, [httpBase, enabled]);

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
      if (sc[0] > prevC.current) play('item-cool');
      if (sc[1] > prevH.current) play('item-hot');
    }
    prevC.current = sc[0];
    prevH.current = sc[1];
  }, [snapshot?.teamScore, muted, play]);
}
