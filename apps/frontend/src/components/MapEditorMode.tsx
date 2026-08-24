import { useEffect, useState } from 'react';
import { DEFAULT_DISPLAY_PREFS, MapObject } from '@u15/ws-types';
import { downloadMapFile, fetchDisplayTheme, fetchMapCatalogData, saveMapToLibrary } from '../lib/api';
import { BG_ROOT, TEXT_MUTED } from '../ui';
import { MapEditorPanel, defaultEditableMap, toInlineMapData } from './MapEditorDialog';
import type { EditableMap } from './MapEditorDialog';

interface Props {
  httpBase: string;
  roomId:   string;
  /** マップ管理の「編集」から開いたときのライブラリ ID。「新規作成」なら null */
  mapId:    string | null;
}

/**
 * マップ管理から開く、マップエディタの独立ウィンドウ/タブ。
 *
 * room・対戦設定とは無関係 (HTTP のみで完結)。そのため useGameState (WS) は張らず、
 * 「適用して閉じる」も出さない (MapEditorPanel に onApply を渡さない)。
 * 盤面テクスチャだけは対戦設定と揃えたいので、テーマは HTTP で一度だけ取りに行く
 * (WS を張らない設計は崩さない)。
 */
export function MapEditorMode({ httpBase, roomId, mapId }: Props) {
  const [seed,  setSeed]  = useState<EditableMap | null>(null);
  const [initialName, setInitialName] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState(DEFAULT_DISPLAY_PREFS.theme);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = mapId ? await fetchMapCatalogData(httpBase, mapId) : null;
      if (cancelled) return;
      setInitialName(loaded?.displayName);
      setSeed(loaded
        ? {
            field: loaded.data.field as MapObject[][], size: loaded.data.size,
            turn: loaded.data.turn, teamFirstPoint: loaded.data.teamFirstPoint,
          }
        : defaultEditableMap);
    })();
    return () => { cancelled = true; };
  }, [httpBase, mapId]);

  useEffect(() => {
    let cancelled = false;
    void fetchDisplayTheme(httpBase, roomId).then(t => { if (!cancelled && t) setTheme(t); });
    return () => { cancelled = true; };
  }, [httpBase, roomId]);

  // ブラウザタブ/ウィンドウを閉じる操作 (× ボタン・Cmd+W) にも未保存の確認を効かせる。
  // Electron はレンダラのこのイベントを 'will-prevent-unload' として main プロセスへ伝える
  // (apps/electron/src/main.ts の openMapEditorWindow が実際の確認ダイアログを出す)。
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (!seed) {
    return <div style={loading}>読み込み中...</div>;
  }

  return (
    <div style={page}>
      <MapEditorPanel
        initialMap={seed}
        initialName={initialName}
        theme={theme}
        httpBase={httpBase}
        topBar
        onSaveToLibrary={(map, name) => void saveMapToLibrary(httpBase, name, toInlineMapData(map))}
        onDownload={(map, name) => void downloadMapFile(httpBase, name, toInlineMapData(map))}
        onClose={() => window.close()}
        onDirtyChange={setDirty}
      />
    </div>
  );
}

// ウィンドウは既定マップに合わせた最小サイズで開く (apps/electron/src/main.ts の
// openMapEditorWindow) ので、大きいマップやウィンドウを縮めたときは中身がはみ出しうる。
// クリップさせず自前でスクロールさせる。
const page: React.CSSProperties = { height: '100vh', overflow: 'auto', background: BG_ROOT };

const loading: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: BG_ROOT, color: TEXT_MUTED, fontSize: 13,
};
