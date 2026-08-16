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
 *
 * **探索の次ステップは rAF 越しに setCorrection する。** 以前は setCorrection → 再レンダー
 * → 同じコミットの中で次ステップを判定 → また setCorrection …と、複数ステップぶんの更新が
 * 1回のフラッシュ内で同期的に連鎖していた。ウィンドウの最大化アニメーションなど maxHeight が
 * 短時間に変わり続ける状況では、これに「key 変化によるリセット」も重なって連鎖が伸び続け、
 * React の nested update 上限を超えて "Maximum update depth exceeded" になることがあった。
 * rAF を挟むと、各ステップは前のフレームの描画を経てから実行される別個の更新になるため、
 * 同期的な連鎖として数えられることがなくなる。
 *
 * **key 変化時に correction が既に 1 なら、その場で測定まで進む。** この effect は
 * `[key, maxHeight, maxCorrection, correction]` が変わったときにしか再実行されない。
 * correction が 1 のまま `return` すると、それ以降どの依存も変わらなくなり (盤面サイズも
 * 行数も一定なら key はもう動かない)、二度と測定が起きないまま correction=1 に固定されて
 * しまう — 中身がカードからはみ出してもスクロールで隠れるだけになる不具合になる。
 * measure 側 (下) へフォールスルーさせて、この呼び出しの中で測定まで済ませる。
 *
 * **収束するまでは `settled=false` を返す。** 探索中は correction が 1 → 縮小後の値へ
 * 複数フレームかけて動くため、呼び出し側がそのまま表示に使うと画面が数フレーム揺れて見える
 * (初回表示や、行数が変わって再探索が走るとき)。呼び出し側は `settled` が false の間だけ
 * 見た目を隠す (visibility 等) ことで、収束後の最終値へ一度だけ切り替わるようにできる。
 * 測定自体は引き続き `correction` (探索中の値) で行うので、隠している間も el は探索中の
 * サイズで実際にレイアウトされている必要がある。
 */
export function useFitCorrection(
  ref: React.RefObject<HTMLElement | null>,
  { key, maxHeight, maxCorrection }: { key: string; maxHeight: number; maxCorrection: number },
): { correction: number; settled: boolean } {
  const [correction, setCorrection] = useState(1);
  const [settled, setSettled]       = useState(false);
  const keyRef    = useRef(key);
  // lo: 収まることが確認済みの最大値 / hi: 収まらないことが確認済みの最小値
  const boundsRef = useRef({ lo: MIN_CORRECTION, hi: maxCorrection });
  // lo/hi は「その時点の maxHeight/maxCorrection に対して」収まる/収まらないの記録なので、
  // どちらかが変わると古い記録になる。特に hi (収まらないと確認済みの下限) を古いまま
  // 引きずると、maxHeight が広がって前回の hi でも本当は収まるようになっていても、それを
  // 再探索する手がかりが無くなり、収束後 correction が小さいまま固定されてしまう
  // (ウィンドウを最大化しても最大化前の縮小率のまま伸びない不具合になる)。
  const boundsBasisRef = useRef({ maxHeight, maxCorrection });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || maxHeight <= 0) return;

    if (keyRef.current !== key) {
      keyRef.current = key;
      boundsRef.current = { lo: MIN_CORRECTION, hi: maxCorrection };
      setSettled(false); // 新しい key の探索を始める。収まる値が見つかるまで表示は隠す
      if (correction !== 1) {
        const rafId = requestAnimationFrame(() => setCorrection(1));
        return () => cancelAnimationFrame(rafId);
      }
      // 既に 1 ならここで測定へフォールスルーする (上のコメント参照)
    } else if (
      boundsBasisRef.current.maxHeight !== maxHeight ||
      boundsBasisRef.current.maxCorrection !== maxCorrection
    ) {
      // key はそのまま maxHeight/maxCorrection だけが変わった (ウィンドウリサイズ等)。
      // correction は 1 に戻さずシームレスに続けるが、上限だけ開き直して再探索できるようにする
      boundsRef.current = { ...boundsRef.current, hi: maxCorrection };
    }
    boundsBasisRef.current = { maxHeight, maxCorrection };

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
    if (Math.abs(next - correction) <= 0.004) {
      setSettled(true); // 収束した。ここで初めて呼び出し側に見た目の反映を許す
      return;
    }
    const rafId = requestAnimationFrame(() => setCorrection(next));
    return () => cancelAnimationFrame(rafId);
  }, [key, maxHeight, maxCorrection, correction]);

  return { correction, settled };
}
