import { useState } from 'react';
import type { ReactNode } from 'react';
import { BORDER_COLOR, FONT_NUM, TEXT_MUTED, TEXT_PRIMARY, TextInput } from '../ui';

interface Entry { id: string; displayName: string }

/**
 * 登録済みライブラリの検索つき一覧。マップとプログラムで共有する。
 *
 * 行の中身は用途ごとに違うので `children` に任せ、ここは絞り込みと
 * 「まだ無い / 該当しない」の出し分けだけを持つ。
 */
export function LibraryBrowser<T extends Entry>({
  entries, placeholder, emptyText, children,
}: {
  entries: T[];
  placeholder: string;
  /** 1件も登録されていないときの文言 */
  emptyText: string;
  children: (entry: T) => ReactNode;
}) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;

  if (entries.length === 0) return <span style={s.hint}>{emptyText}</span>;

  return (
    <>
      <TextInput
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      {filtered.length === 0
        ? <span style={s.hint}>該当するものがありません</span>
        : <div style={s.list}>{filtered.map(children)}</div>}
    </>
  );
}

/** 一覧の1行。左に名前と補足、右に操作を並べる */
export function LibraryRow({
  name, meta, children,
}: {
  name: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={s.row}>
      <div style={s.main}>
        <span style={s.name}>{name}</span>
        {meta && <span style={s.meta}>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  hint: { fontSize: 11, color: TEXT_MUTED },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    fontSize: 12, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 10, color: TEXT_MUTED, lineHeight: 1.5 },
};
