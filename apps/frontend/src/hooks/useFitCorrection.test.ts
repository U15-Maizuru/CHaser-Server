import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useFitCorrection } from './useFitCorrection';

/**
 * ref.current.scrollHeight を「correction に比例して必要な高さが増える」モデルで返す
 * テスト用フック。実際の DOM 計測の代わりに、直前レンダーで返った correction から
 * 逆算した scrollHeight を書き戻すことで、二分探索の入力を模倣する。
 */
/** 二分探索は厳密な中間値ではなく最終ステップの半分弱の誤差を残して止まるため、閾値で比較する */
function expectConvergedNear(actual: number, target: number) {
  expect(Math.abs(actual - target)).toBeLessThan(0.03);
}

function useHarness(
  naturalHeightAt1: number,
  opts: { key: string; maxHeight: number; maxCorrection: number },
) {
  const ref = useRef<{ scrollHeight: number }>({ scrollHeight: naturalHeightAt1 });
  const result = useFitCorrection(ref as unknown as React.RefObject<HTMLElement>, opts);
  ref.current.scrollHeight = naturalHeightAt1 * result.correction;
  return result;
}

describe('useFitCorrection', () => {
  it('中身が収まる最大の拡大率に二分探索で収束し、収束後は settled が true になる', async () => {
    // maxHeight=400 のとき、naturalHeightAt1=800 (correction=1で必要な高さ) なら
    // 収まる最大の correction は 400/800 = 0.5
    const { result } = renderHook(() =>
      useHarness(800, { key: 'panel', maxHeight: 400, maxCorrection: 1.2 }));

    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 3000 });
    expectConvergedNear(result.current.correction, 0.5);
  });

  it('key が変わると correction=1 からやり直し、新しい収まり幅に再収束する', async () => {
    const { result, rerender } = renderHook(
      ({ key, natural }: { key: string; natural: number }) =>
        useHarness(natural, { key, maxHeight: 400, maxCorrection: 1.2 }),
      { initialProps: { key: 'round1', natural: 800 } }, // 収まる最大値 0.5
    );
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 3000 });
    expectConvergedNear(result.current.correction, 0.5);

    // key を変える (別ラウンド相当) と、収まる最大値が違う内容 (natural=1200 → 400/1200≈0.333) に切り替わる
    rerender({ key: 'round2', natural: 1200 });
    expect(result.current.settled).toBe(false); // 新しい key の探索が終わるまでは非収束扱い

    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 3000 });
    expectConvergedNear(result.current.correction, 400 / 1200);
  });

  it('同じ key のまま maxHeight が変わって (ウィンドウリサイズ相当) も、correction=1 を経由せずシームレスに再収束する', async () => {
    const { result, rerender } = renderHook(
      ({ maxHeight }: { maxHeight: number }) =>
        useHarness(800, { key: 'panel', maxHeight, maxCorrection: 1.2 }),
      { initialProps: { maxHeight: 400 } }, // 収まる最大値 0.5
    );
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 3000 });
    expectConvergedNear(result.current.correction, 0.5);

    // key はそのまま maxHeight だけ広がる (ウィンドウ最大化相当) → 収まる最大値も広がる (480/800=0.6)。
    // 収束直後は lo/hi の探索区間が狭く閉じているため、単純に「hi<=lo なら開き直す」だけでは
    // この上振れを拾えず、縮小方向にしか追従できない (ここで固定 480 を使うのは、一度収束した後の
    // 再拡大が正しく効くかどうかを確認するための最小ケースであり、実際のリサイズはより細かい刻みで起こる)
    const seenCorrections: number[] = [];
    rerender({ maxHeight: 480 });
    await waitFor(() => {
      seenCorrections.push(result.current.correction);
      expect(Math.abs(result.current.correction - 0.6)).toBeLessThan(0.03);
    }, { timeout: 3000 });

    // 再探索の開始点は「直前の収束値 (≈0.5)」であり、1 に戻ってから測り直すことはない
    expect(seenCorrections.every(c => c !== 1)).toBe(true);
    expectConvergedNear(result.current.correction, 0.6);
  });
});
