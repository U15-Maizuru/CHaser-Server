import { useEffect, useState } from 'react';
import type { MapCatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  TURN_PALE,
  SHADOW_MD, RADIUS_MD, RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  httpBase: string;
  onClose:  () => void;
}

// マップライブラリの管理 (アップロード・ダウンロード・削除) のみを扱い、
// 「対戦でどのマップを使うか」の選択は一切行わない。選択はセットアップ画面の
// マップ列 (MapSourceSection) に一本化する。プログラム側の ProgramLibraryDialog と同じ役割。
export function MapLibraryDialog({ httpBase, onClose }: Props) {
  const [entries, setEntries] = useState<MapCatalogEntry[]>([]);
  const [query,   setQuery]   = useState('');

  const fetchEntries = () => {
    fetch(`${httpBase}/api/maps`)
      .then(r => r.json())
      .then((d: { entries: MapCatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  };

  useEffect(fetchEntries, [httpBase]);

  const handleDelete = (entry: MapCatalogEntry) => {
    const ok = window.confirm(
      `「${entry.displayName}」をライブラリから削除します。\n`
      + 'このマップを選択中のルームでは、リセット後にマップが読み込めなくなります。よろしいですか？',
    );
    if (!ok) return;
    fetch(`${httpBase}/api/maps/${entry.id}`, { method: 'DELETE' })
      .then(() => fetchEntries())
      .catch(() => {});
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>マップ管理</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.content}>
          <div style={s.notice}>
            ここではライブラリの整理 (追加・ダウンロード・削除) だけを行います。
            対戦で使うマップはセットアップ画面のマップ列で選んでください。
          </div>

          {entries.length > 0 && (
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="マップ名で検索"
              style={s.searchInput}
            />
          )}
          {entries.length === 0 && <span style={s.hint}>まだマップが登録されていません</span>}
          {entries.length > 0 && filtered.length === 0 && <span style={s.hint}>該当するマップがありません</span>}
          {filtered.length > 0 && (
            <div style={s.list}>
              {filtered.map(entry => (
                <div key={entry.id} style={s.row}>
                  <div style={s.rowMain}>
                    <span style={s.name}>{entry.displayName}</span>
                    <span style={s.date}>
                      {entry.size.x}×{entry.size.y} ・ ターン{entry.turn} ・ ブロック{entry.blockCount} ・ アイテム{entry.itemCount}
                    </span>
                    <span style={s.date}>{new Date(entry.uploadedAt).toLocaleString()}</span>
                  </div>
                  <a style={s.dlBtn} href={`${httpBase}/api/maps/${entry.id}/download`}>DL</a>
                  <button style={s.deleteBtn} onClick={() => handleDelete(entry)}>削除</button>
                </div>
              ))}
            </div>
          )}

          <FileDropZone
            endpoint={`${httpBase}/api/maps`}
            accept={['.map']}
            label="新規マップをライブラリに追加"
            onUploaded={fetchEntries}
          />
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
    display: 'flex', flexDirection: 'column', maxHeight: '90vh', width: 420, overflow: 'hidden',
    color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: `1px solid ${BORDER_COLOR}`, flexShrink: 0,
  },
  title:    { fontSize: 14, fontWeight: 800 },
  closeBtn: { background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 16, cursor: 'pointer' },
  content:  { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, overflow: 'auto', background: BG_ROOT },
  notice: {
    padding: '8px 10px', borderRadius: RADIUS_SM,
    background: TURN_PALE, border: `1px solid ${BORDER_COLOR}`,
    fontSize: 10, lineHeight: 1.6, color: TEXT_SECONDARY,
  },
  hint: { fontSize: 10, color: TEXT_MUTED },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '4px 8px',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    fontSize: 11, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  list:   { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 6px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    fontSize: 11, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  date: { fontSize: 9, color: TEXT_MUTED },
  dlBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, textDecoration: 'none', flexShrink: 0,
  },
  deleteBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_MUTED, fontSize: 10, cursor: 'pointer', flexShrink: 0,
  },
};
