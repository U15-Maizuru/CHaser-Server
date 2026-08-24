import { useEffect, useState } from 'react';
import type { MapCatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { LibraryBrowser, LibraryRow } from './LibraryBrowser';
import { BG_CARD, BORDER_COLOR, Button, Callout, Dialog, RADIUS_PILL, TEXT_SECONDARY } from '../ui';
import { deleteMap, fetchMaps } from '../lib/api';
import { confirmDialog } from '../lib/nativeDialog';

interface Props {
  httpBase:      string;
  onClose:       () => void;
  /** 今対戦画面にプレビュー表示中のマップ (手動プレビュー)。無ければ null */
  previewMapId:  string | null;
  onPreviewMap:  (mapId: string | null) => void;
  /** マップエディタを開く。entry 指定でそのマップを下敷きに、null なら白紙から。
   *  対戦設定とは無関係なので、開いたエディタでは「適用して閉じる」は出ない (ライブラリ保存/DLのみ)。 */
  onOpenEditor:  (entry: MapCatalogEntry | null) => void;
}

// マップライブラリの整理 (追加・編集・ダウンロード・削除) だけを扱う。
// 「対戦でどのマップを使うか」の選択はセットアップ画面の MapSourceSection に一本化する。
// 「プレビュー表示」は対戦設定とは別の、対戦画面への一時的な表示切り替え (手動プレビュー)。
// ここから開くマップエディタも同様に対戦設定とは切り離してあり、保存は常にライブラリへの
// 新規追加になる (対戦中のマップを差し替える「適用」は無い)。
export function MapLibraryDialog({ httpBase, onClose, previewMapId, onPreviewMap, onOpenEditor }: Props) {
  const [entries, setEntries] = useState<MapCatalogEntry[]>([]);

  const fetchEntries = () => { void fetchMaps(httpBase).then(setEntries); };

  useEffect(fetchEntries, [httpBase]);

  const handleDelete = (entry: MapCatalogEntry) => {
    const ok = confirmDialog(
      `「${entry.displayName}」をライブラリから削除します。\n`
      + 'このマップを選択中のルームでは、リセット後にマップが読み込めなくなります。よろしいですか？',
    );
    if (!ok) return;
    void deleteMap(httpBase, entry.id).then(fetchEntries);
  };

  return (
    <Dialog title="マップ管理" onClose={onClose} width={420} bodyStyle={body}>
      <Callout>
        ここではライブラリの整理だけを行います。
        対戦で使うマップはセットアップ画面のマップ列で選んでください。
      </Callout>

      <Button size="sm" onClick={() => onOpenEditor(null)}>エディタで新規作成...</Button>

      <LibraryBrowser
        entries={entries}
        placeholder="マップ名で検索"
        emptyText="まだマップが登録されていません"
      >
        {entry => (
          <LibraryRow
            key={entry.id}
            name={entry.displayName}
            meta={
              <>
                {entry.size.x}×{entry.size.y} ・ ターン{entry.turn}
                ・ ブロック{entry.blockCount} ・ アイテム{entry.itemCount}
                <br />{new Date(entry.uploadedAt).toLocaleString()}
              </>
            }
          >
            <a style={download} href={`${httpBase}/api/maps/${entry.id}/download`}>DL</a>
            <Button size="sm" noShrink onClick={() => onOpenEditor(entry)}>編集</Button>
            <Button
              size="sm" noShrink
              onClick={() => onPreviewMap(entry.id === previewMapId ? null : entry.id)}
            >
              {entry.id === previewMapId ? 'プレビュー解除' : 'プレビュー表示'}
            </Button>
            <Button size="sm" noShrink onClick={() => handleDelete(entry)}>削除</Button>
          </LibraryRow>
        )}
      </LibraryBrowser>

      <FileDropZone
        endpoint={`${httpBase}/api/maps`}
        accept={['.map']}
        label="新規マップをライブラリに追加"
        onUploaded={fetchEntries}
      />
    </Dialog>
  );
}

const body: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
};

const download: React.CSSProperties = {
  padding: '4px 10px', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_PILL,
  background: BG_CARD, color: TEXT_SECONDARY, fontSize: 11,
  textDecoration: 'none', flexShrink: 0,
};
