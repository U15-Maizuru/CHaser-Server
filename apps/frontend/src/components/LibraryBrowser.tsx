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

/**
 * 一覧の1行。名前・補足を上段にフル幅で、操作ボタン列を下段に分けて置く。
 *
 * 以前は名前と操作ボタンを横1列に並べていたが、マップ管理のように操作が
 * DL/編集/プレビュー/削除の4つに増えると、ボタンに幅を取られて名前が
 * 前半しか見えなくなり、似た名前のマップを区別できなくなっていた。
 */
export function LibraryRow({
  name, badge, meta, children,
}: {
  name: string;
  /** 名前の右に添える状態バッジ (例: 大会運営の「運営中」)。他の一覧では使わない */
  badge?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={s.row}>
      <div style={s.nameRow}>
        <span style={s.name} title={name}>{name}</span>
        {badge}
      </div>
      {meta && <div style={s.meta}>{meta}</div>}
      {children && <div style={s.actions}>{children}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  hint: { fontSize: 11, color: TEXT_MUTED },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' },
  row: {
    display: 'flex', flexDirection: 'column', gap: 4,
    padding: '8px 10px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  nameRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  name: {
    fontSize: 12, fontFamily: FONT_NUM, color: TEXT_PRIMARY, minWidth: 0, flex: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 10, color: TEXT_MUTED, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
};
