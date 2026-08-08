import { useLayoutEffect, useRef, useState } from 'react';

const MIN_CORRECTION = 0.35;

/**
 * 要素の中身が maxHeight に収まる最大の拡大率を二分探索で求める。
 *
 * 拡大率 → 必要な高さの関係は、寸法計算側の min/max クランプにより区間ごとに折れ線 (非線形)
 * になっており、単純な比例計算では最適値に収束しない。関数の形に関係なく「収まる最大値」へ
 * 確実に収束する二分探索を使うのはそのため。
 *
 * key は「探索をやり直すべき変化」を表す文字列 (幅・高さ・行数など)。変わったら 1 に戻して
 * 測り直す。
 */
export function useFitCorrection(
  ref: React.RefObject<HTMLElement | null>,
  { key, maxHeight, maxCorrection }: { key: string; maxHeight: number; maxCorrection: number },
): number {
  const [correction, setCorrection] = useState(1);
  const keyRef    = useRef(key);
  // lo: 収まることが確認済みの最大値 / hi: 収まらないことが確認済みの最小値
  const boundsRef = useRef({ lo: MIN_CORRECTION, hi: maxCorrection });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || maxHeight <= 0) return;

    if (keyRef.current !== key) {
      keyRef.current = key;
      boundsRef.current = { lo: MIN_CORRECTION, hi: maxCorrection };
      if (correction !== 1) setCorrection(1);
      return; // correction=1 での再描画を待ってから測定する
    }

    const fits = el.scrollHeight <= maxHeight + 1;
    let { lo, hi } = boundsRef.current;
    // 中身の形だけが変わる (「ゲーム中は空欄・終了後は実値」など) と、key が変わらないまま
    // 探索範囲が収束済み (lo===hi) の状態で実際の要否だけが反転することがある。
    // その場合に再探索が走るよう、区間を現在値から確実に離して開き直す。
    if (fits) {
      lo = correction;
      if (hi <= lo) hi = maxCorrection;
    } else {
      hi = correction;
      if (lo >= hi) lo = Math.max(MIN_CORRECTION, hi - 0.1);
    }
    boundsRef.current = { lo, hi };

    const next = hi - lo > 0.02 ? (lo + hi) / 2 : lo;
    if (Math.abs(next - correction) > 0.004) setCorrection(next);
  });

  return correction;
}
