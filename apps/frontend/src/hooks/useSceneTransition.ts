import { useEffect, useState } from 'react';
import { SCENE_FADE_MS } from '@u15/ws-types';

type Phase = 'idle' | 'closing' | 'opening';

/**
 * scene が変わっても即座に表示を差し替えず、暗転を挟んでから切り替える。
 *
 * BGM のクロスフェード (useBgm) と同じ長さ (SCENE_FADE_MS) で closing (暗転) → 表示差し替え →
 * opening (明転) と進む。displayed が実際に切り替わるのは closing が終わった瞬間 (真っ黒の裏) で、
 * そこから opening が明けて見えるようになる。
 *
 * 対戦開始への遷移も暗転を挟むぶん、表示の差し替え (= 対戦画面のマウント) が実際の対戦開始より
 * SCENE_FADE_MS だけ遅れる。ServerManager の startDelayMs 側で同じ長さを足して吸収しているので、
 * 開始カウントダウンは対戦画面がマウントされた瞬間に "3" から始めれば、明転が終わる前に
 * 最初の目盛りが進むことはない (バックエンドと共有する SCENE_FADE_MS のコメント参照)。
 */
export function useSceneTransition<T>(scene: T): { displayed: T; curtain: number } {
  const [displayed, setDisplayed] = useState(scene);
  const [phase, setPhase]         = useState<Phase>('idle');

  // scene の変化を検知して暗転 (closing) を始める
  useEffect(() => {
    if (scene === displayed) return;
    setPhase('closing');
  }, [scene, displayed]);

  // closing (暗転) が終わったら表示を差し替えて opening (明転) へ
  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = setTimeout(() => {
      setDisplayed(scene);
      setPhase('opening');
    }, SCENE_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, scene]);

  // opening (明転) が終わったら idle に戻る (curtain の値自体は closing 以外すべて 0 なので
  // 見た目には影響しないが、次の遷移が正しく closing から始まるようにする)
  useEffect(() => {
    if (phase !== 'opening') return;
    const timer = setTimeout(() => setPhase('idle'), SCENE_FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return { displayed, curtain: phase === 'closing' ? 1 : 0 };
}
