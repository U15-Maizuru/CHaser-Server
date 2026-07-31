import { useEffect, useState } from 'react';
import type { CatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD, RADIUS_MD, RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  httpBase: string;
  onClose:  () => void;
}

// 対戦用プログラムライブラリの一元管理画面。アップロード・削除・デモ対象フラグの
// 変更のみを扱い、「どの対戦スロットで使うか」の選択は一切行わない
// (選択は TeamSetupPanel 内の ProgramLibrarySection の役割)。
export function ProgramLibraryDialog({ httpBase, onClose }: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [query, setQuery]     = useState('');

  const fetchEntries = () => {
    fetch(`${httpBase}/api/programs`)
      .then(r => r.json())
      .then((d: { entries: CatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  };

  useEffect(() => { fetchEntries(); }, []);

  const handleUploaded = () => {
    fetchEntries();
  };

  const handleToggleDemoEnabled = (id: string, enabled: boolean) => {
    fetch(`${httpBase}/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demoEnabled: enabled }),
    })
      .then(res => res.json() as Promise<{ entry: CatalogEntry }>)
      .then(({ entry }) => {
        setEntries(prev => prev.map(e => (e.id === entry.id ? entry : e)));
      })
      .catch(() => {});
  };

  const handleDelete = (entry: CatalogEntry) => {
    const ok = window.confirm(
      `「${entry.displayName}」をライブラリから削除しますか？\n` +
      '他のルーム・対戦スロットで使用中の場合、次回の対戦開始時にエラーになります。',
    );
    if (!ok) return;
    fetch(`${httpBase}/api/programs/${entry.id}`, { method: 'DELETE' })
      .then(() => fetchEntries())
      .catch(() => {});
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>プログラムライブラリ管理</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          <span style={s.notice}>このライブラリは全ルーム共通です。アップロードしただけでは対戦には使われません（対戦での使用はセットアップ画面で選択してください）。</span>

          {entries.length > 0 && (
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="プログラム名で検索"
              style={s.searchInput}
            />
          )}

          {entries.length === 0 && (
            <span style={s.hint}>まだプログラムがアップロードされていません</span>
          )}
          {entries.length > 0 && filtered.length === 0 && (
            <span style={s.hint}>該当するプログラムがありません</span>
          )}

          {filtered.length > 0 && (
            <div style={s.list}>
              {filtered.map(entry => (
                <div key={entry.id} style={s.row}>
                  <div style={s.rowMain}>
                    <span style={s.name}>{entry.displayName}</span>
                    <span style={s.date}>{new Date(entry.uploadedAt).toLocaleString()}</span>
                  </div>
                  <label style={s.demoLabel}>
                    <input
                      type="checkbox"
                      checked={entry.demoEnabled}
                      onChange={e => handleToggleDemoEnabled(entry.id, e.target.checked)}
                      style={s.check}
                    />
                    デモ対象
                  </label>
                  <button style={s.deleteBtn} onClick={() => handleDelete(entry)}>削除</button>
                </div>
              ))}
            </div>
          )}

          <FileDropZone
            endpoint={`${httpBase}/api/programs`}
            accept={['.py', '.exe']}
            label="新規プログラムをライブラリに追加"
            onUploaded={handleUploaded}
          />
        </div>

        <div style={s.footer}>
          <button style={s.btnClose} onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
    width: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px', borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  title:    { fontSize: 15, fontWeight: 800 },
  closeBtn: {
    background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 16,
    cursor: 'pointer', padding: '0 4px',
  },
  body: {
    padding: '16px 20px', flex: 1, minHeight: 0, overflow: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  notice: { fontSize: 11, color: TEXT_MUTED, lineHeight: 1.5 },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '6px 10px',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    fontSize: 12, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  hint: { fontSize: 11, color: TEXT_MUTED },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    fontSize: 12, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  date: { fontSize: 10, color: TEXT_MUTED },
  demoLabel: {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, color: TEXT_SECONDARY, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0,
  },
  check: { width: 14, height: 14, cursor: 'pointer', accentColor: COOL_COLOR },
  deleteBtn: {
    padding: '3px 10px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_MUTED, fontSize: 11, cursor: 'pointer',
    flexShrink: 0,
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '14px 20px', borderTop: `1px solid ${BORDER_COLOR}`,
  },
  btnClose: {
    padding: '7px 18px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 12, cursor: 'pointer',
  },
};
