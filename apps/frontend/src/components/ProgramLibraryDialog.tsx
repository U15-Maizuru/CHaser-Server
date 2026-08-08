import { useEffect, useState } from 'react';
import type { CatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { LibraryBrowser, LibraryRow } from './LibraryBrowser';
import { Button, Callout, Checkbox, Dialog, TEXT_SECONDARY } from '../ui';

interface Props {
  httpBase: string;
  onClose:  () => void;
}

// 対戦用プログラムライブラリの整理 (追加・削除・デモ対象の切り替え) だけを扱う。
// 「どの対戦スロットで使うか」の選択は TeamSetupPanel 内の ProgramLibrarySection の役割。
export function ProgramLibraryDialog({ httpBase, onClose }: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);

  const fetchEntries = () => {
    fetch(`${httpBase}/api/programs`)
      .then(r => r.json())
      .then((d: { entries: CatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  };

  useEffect(fetchEntries, [httpBase]);

  const handleToggleDemoEnabled = (id: string, enabled: boolean) => {
    fetch(`${httpBase}/api/programs/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ demoEnabled: enabled }),
    })
      .then(res => res.json() as Promise<{ entry: CatalogEntry }>)
      .then(({ entry }) => setEntries(prev => prev.map(e => (e.id === entry.id ? entry : e))))
      .catch(() => {});
  };

  const handleDelete = (entry: CatalogEntry) => {
    const ok = window.confirm(
      `「${entry.displayName}」をライブラリから削除しますか？\n`
      + '他のルーム・対戦スロットで使用中の場合、次回の対戦開始時にエラーになります。',
    );
    if (!ok) return;
    fetch(`${httpBase}/api/programs/${entry.id}`, { method: 'DELETE' })
      .then(() => fetchEntries())
      .catch(() => {});
  };

  return (
    <Dialog
      title="プログラム管理"
      onClose={onClose}
      width={480}
      bodyStyle={body}
      footer={<Button onClick={onClose}>閉じる</Button>}
    >
      <Callout>
        このライブラリは全ルーム共通です。追加しただけでは対戦には使われません
        （対戦での使用はセットアップ画面で選択してください）。
      </Callout>

      <LibraryBrowser
        entries={entries}
        placeholder="プログラム名で検索"
        emptyText="まだプログラムが登録されていません"
      >
        {entry => (
          <LibraryRow
            key={entry.id}
            name={entry.displayName}
            meta={new Date(entry.uploadedAt).toLocaleString()}
          >
            <label style={demoLabel}>
              <Checkbox
                checked={entry.demoEnabled}
                onChange={e => handleToggleDemoEnabled(entry.id, e.target.checked)}
              />
              デモ対象
            </label>
            <Button size="sm" noShrink onClick={() => handleDelete(entry)}>削除</Button>
          </LibraryRow>
        )}
      </LibraryBrowser>

      <FileDropZone
        endpoint={`${httpBase}/api/programs`}
        accept={['.py', '.exe']}
        label="新規プログラムをライブラリに追加"
        onUploaded={fetchEntries}
      />
    </Dialog>
  );
}

const body: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10,
};

const demoLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
  fontSize: 11, color: TEXT_SECONDARY, whiteSpace: 'nowrap', cursor: 'pointer',
};
