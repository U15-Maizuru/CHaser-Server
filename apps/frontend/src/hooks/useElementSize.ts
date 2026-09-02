import { useEffect, useRef, useState } from 'react';

/**
 * 要素の実寸を測る。
 *
 * **測る対象は中身に左右されない箱だけにすること。** 測った値で中身の大きさを決めると、
 * それがまた箱の大きさを変えて「測定 → 反映 → 再測定」の循環になる (useBoardLayout と
 * useFitScale が同じ約束で作られている)。
 */
export function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize(prev =>
        prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, size };
}
