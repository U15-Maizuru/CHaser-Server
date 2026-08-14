import { useEffect, useState } from 'react';
import type { MapCatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { LibraryBrowser, LibraryRow } from './LibraryBrowser';
import { BG_CARD, BORDER_COLOR, Button, Callout, Dialog, RADIUS_PILL, TEXT_SECONDARY } from '../ui';
import { deleteMap, fetchMaps } from '../lib/api';
import { confirmDialog } from '../lib/nativeDialog';

interface Props {
  httpBase: string;
  onClose:  () => void;
}

// マップライブラリの整理 (追加・ダウンロード・削除) だけを扱う。
// 「対戦でどのマップを使うか」の選択はセットアップ画面の MapSourceSection に一本化する。
export function MapLibraryDialog({ httpBase, onClose }: Props) {
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
