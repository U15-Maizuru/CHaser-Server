import { useEffect, useState } from 'react';
import type { CatalogEntry } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { BORDER_COLOR, TEXT_SECONDARY, TEXT_PRIMARY, TEXT_MUTED, BG_CARD, FONT_NUM } from '../styles/tokens';

interface Props {
  httpBase: string;
  onSelect: (entry: CatalogEntry) => void;
}

export function ProgramLibrarySection({ httpBase, onSelect }: Props) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);

  const fetchEntries = () => {
    fetch(`${httpBase}/api/programs`)
      .then(r => r.json())
      .then((d: { entries: CatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchEntries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (id: string) => {
    fetch(`${httpBase}/api/programs/${id}`, { method: 'DELETE' })
      .then(() => fetchEntries())
      .catch(() => {});
  };

  const handleUploaded = (serverPath: string) => {
    fetch(`${httpBase}/api/programs`)
      .then(r => r.json())
      .then((d: { entries: CatalogEntry[] }) => {
        const sorted = [...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt);
        setEntries(sorted);
        const added = sorted.find(e => e.programPath === serverPath);
        if (added) onSelect(added);
      })
      .catch(() => {});
  };

  return (
    <div style={s.root}>
      <span style={s.title}>プログラムライブラリ</span>

      {entries.length === 0 && (
        <span style={s.hint}>まだプログラムがアップロードされていません</span>
      )}

      {entries.length > 0 && (
        <div style={s.list}>
          {entries.map(entry => (
            <div key={entry.id} style={s.row}>
              <div style={s.rowMain}>
                <span style={s.name}>{entry.displayName}</span>
                <span style={s.date}>{new Date(entry.uploadedAt).toLocaleString()}</span>
              </div>
              <button style={s.useBtn} onClick={() => onSelect(entry)}>使用</button>
              <button style={s.deleteBtn} onClick={() => handleDelete(entry.id)}>削除</button>
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
  );
}

const s: Record<string, React.CSSProperties> = {
  root:   { display: 'flex', flexDirection: 'column', gap: 8 },
  title:  { fontSize: 11, fontWeight: 700, color: TEXT_SECONDARY },
  hint:   { fontSize: 10, color: TEXT_MUTED },
  list:   { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflow: 'auto' },
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
  useBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_PRIMARY, fontSize: 10, fontWeight: 600, cursor: 'pointer',
    flexShrink: 0,
  },
  deleteBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_MUTED, fontSize: 10, cursor: 'pointer',
    flexShrink: 0,
  },
};
