import { useCallback, useEffect, useState } from 'react';
import type { InlineMapData, ServerStatusPayload } from '@u15/ws-types';
import { fetchCurrentMap } from '../lib/api';

// その部屋で今出ているマップを持っておくフック。コントロール窓 (セットアップ画面) と
// 観戦窓 (接続待機画面) の両方で使う。
//
// マップ変更を知らせる WS イベントは無く、さらに requestReset / requestRepeat は
// サーバー側でマップを再生成する。そのため setup 中は server_status のたびに取り直し、
// 内容が変わっていないときは state を更新せず再描画を避ける。

export interface CurrentMapHook {
  currentMap: InlineMapData | null;
  /** マップを差し替えたあとなど、明示的に取り直したいとき */
  refresh:    () => Promise<void>;
}

export function useCurrentMap(
  httpBase: string,
  roomId: string,
  isConnected: boolean,
  serverStatus: ServerStatusPayload | null,
): CurrentMapHook {
  const [currentMap, setCurrentMap] = useState<InlineMapData | null>(null);
  const phase = serverStatus?.phase ?? 'setup';

  const refresh = useCallback(async () => {
    const data = await fetchCurrentMap(httpBase, roomId);
    setCurrentMap(prev => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
  }, [httpBase, roomId]);

  useEffect(() => {
    if (!isConnected || phase !== 'setup') return;
    void refresh();
  }, [isConnected, phase, serverStatus, refresh]);

  return { currentMap, refresh };
}
