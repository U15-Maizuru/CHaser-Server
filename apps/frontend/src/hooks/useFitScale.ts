import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// 中身を「入れ物いっぱい」まで拡大 / 縮小するための倍率を求めるフック。
// トーナメント表・リーグ表をプロジェクタで読ませるために使う。
//
// 文字サイズだけを上げるのではなく transform: scale() で図ごと拡大する。
// カード幅・接続線・余白との比率が崩れず、bracketLayout の座標計算にも手を入れずに済むため。
//
// 循環しない理由: transform はレイアウトサイズに影響しないので、拡大しても
// content の offsetWidth/Height は変わらない。「拡大 → 再測定 → さらに拡大」に入らない。
// 入れ物側も中身に依存しない大きさ (flex:1 + overflow:hidden など) にしておくこと。

export interface FitScale {
  /** 空き領域を決める箱。中身に依存しない大きさにすること */
  containerRef: React.RefObject<HTMLDivElement>;
  /** 拡大したい中身。transform はこちらに掛ける */
  contentRef:   React.RefObject<HTMLDivElement>;
  scale:        number;
}

export function useFitScale(max = 3, min = 0.3): FitScale {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef   = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const box     = containerRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const cw = content.offsetWidth;   // transform 前のレイアウト幅
    const ch = content.offsetHeight;
    if (bw <= 0 || bh <= 0 || cw <= 0 || ch <= 0) return;

    const next = Math.min(max, Math.max(min, Math.min(bw / cw, bh / ch)));
    // 端数のゆらぎで再描画が続かないよう、目に見えない差は無視する
    setScale(prev => (Math.abs(prev - next) < 0.005 ? prev : next));
  }, [max, min]);

  useLayoutEffect(() => {
    const box     = containerRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const obs = new ResizeObserver(measure);
    obs.observe(box);
    obs.observe(content);
    measure();
    return () => obs.disconnect();
  }, [measure]);

  return { containerRef, contentRef, scale };
}
