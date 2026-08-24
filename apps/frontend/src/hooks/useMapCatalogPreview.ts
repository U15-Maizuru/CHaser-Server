import { useEffect, useState } from 'react';
import type { InlineMapData } from '@u15/ws-types';
import { fetchMapCatalogData } from '../lib/api';

// ライブラリの1件を room に紐付けずプレビューするフック。大会 standby のマップ枠と、
// マップ管理画面からの手動プレビューの両方で使う。
//
// mapId が変わるたびに取り直す。null は「プレビュー対象なし」(回戦がランダム生成、
// またはプレビュー解除中) を表し、その間はフェッチしない。

export interface MapCatalogPreview {
  data:        InlineMapData;
  displayName: string;
}

export function useMapCatalogPreview(httpBase: string, mapId: string | null): MapCatalogPreview | null {
  const [preview, setPreview] = useState<MapCatalogPreview | null>(null);

  useEffect(() => {
    if (!mapId) { setPreview(null); return; }
    let cancelled = false;
    void fetchMapCatalogData(httpBase, mapId).then(result => {
      if (!cancelled) setPreview(result);
    });
    return () => { cancelled = true; };
  }, [httpBase, mapId]);

  return preview;
}
