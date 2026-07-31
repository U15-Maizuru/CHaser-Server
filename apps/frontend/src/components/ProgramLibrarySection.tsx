import { useEffect, useState } from 'react';
import type { CatalogEntry } from '@u15/ws-types';
import { BORDER_COLOR, TEXT_SECONDARY, TEXT_PRIMARY, TEXT_MUTED, BG_CARD, FONT_NUM, FONT_UI, RADIUS_SM } from '../styles/tokens';

interface Props {
  httpBase:             string;
  selectedEntry:        CatalogEntry | null;
  onSelect:             (entry: CatalogEntry) => void;
  onOpenLibraryManager: () => void;
}

// 対戦スロットへの「プログラム選択」専用。アップロード・削除はここでは行わず、
// ライブラリの管理は ProgramLibraryDialog (BottomBar「プログラム管理」) に一本化する。
export function ProgramLibrarySection({ httpBase, selectedEntry, onSelect, onOpenLibraryManager }: Props) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
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
    if (open) fetchEntries();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleUse = (entry: CatalogEntry) => {
    onSelect(entry);
    setOpen(false);
    setQuery('');
  };

  const toggleOpen = () => {
    setOpen(o => !o);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;

  return (
    <div style={s.root}>
      <button style={s.trigger} onClick={toggleOpen}>
        <span style={s.triggerLabel}>{selectedEntry ? selectedEntry.displayName : 'プログラム未選択'}</span>
        <span style={s.triggerCaret}>{open ? '変更 ▲' : '変更 ▾'}</span>
      </button>

      {open && (
        <div style={s.expanded}>
          {entries.length === 0 && (
            <div style={s.emptyState}>
              <span style={s.hint}>プログラム管理からアップロードしてください</span>
              <button style={s.manageBtn} onClick={onOpenLibraryManager}>プログラム管理を開く</button>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="プログラム名で検索"
                style={s.searchInput}
              />
              {filtered.length === 0 && (
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
                      <button style={s.useBtn} onClick={() => handleUse(entry)}>使用</button>
                    </div>
                  ))}
                </div>
              )}
              <button style={s.manageLink} onClick={onOpenLibraryManager}>プログラム管理を開く</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:   { display: 'flex', flexDirection: 'column', gap: 8 },
  hint:   { fontSize: 10, color: TEXT_MUTED },
  trigger: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', boxSizing: 'border-box',
    padding: '6px 10px', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, cursor: 'pointer',
  },
  triggerLabel: {
    flex: 1, minWidth: 0, textAlign: 'left',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 12, fontWeight: 700, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
  },
  triggerCaret: { fontSize: 10, color: TEXT_SECONDARY, flexShrink: 0, marginLeft: 8 },
  expanded: { display: 'flex', flexDirection: 'column', gap: 6 },
  emptyState: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '4px 8px',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    fontSize: 11, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
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
  manageBtn: {
    padding: '4px 10px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  manageLink: {
    alignSelf: 'flex-start',
    padding: 0, border: 'none', background: 'none',
    color: TEXT_SECONDARY, fontSize: 10, textDecoration: 'underline', cursor: 'pointer',
  },
};
