import type { CSSProperties } from 'react';
import { BORDER_COLOR, COOL_COLOR, FONT_UI, TEXT_MUTED, WIN_BASE } from './tokens';

export interface TabDef<T extends string> {
  id:    T;
  label: string;
  /** 押せない理由。渡すと無効化され、title に出る */
  disabledReason?: string;
  /**
   * 見出しの横に点を付ける (「ここに注意すべき状態がある」の印)。`markTitle` は点の説明で、
   * ホバーと読み上げに出る。開かなくても気づけるようにするためのもので、押す動作は変えない
   */
  marked?: boolean;
  markTitle?: string;
}

/** 下線で現在地を示す横並びタブ。中身の出し分けは呼び出し側が行う */
export function Tabs<T extends string>({
  tabs, active, onSelect, style,
}: {
  tabs: TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...s.bar, ...style }} role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          disabled={!!t.disabledReason}
          title={t.disabledReason}
          onClick={() => onSelect(t.id)}
          style={{
            ...s.tab,
            ...(t.id === active ? s.active : null),
            ...(t.disabledReason ? s.disabled : null),
          }}
        >
          {t.label}
          {t.marked && (
            <span role="img" aria-label={t.markTitle ?? '注意'} title={t.markTitle} style={s.dot} />
          )}
        </button>
      ))}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  bar: { display: 'flex', borderBottom: `1px solid ${BORDER_COLOR}`, flexShrink: 0 },
  tab: {
    flex: 1, padding: '10px 0', background: 'none', border: 'none',
    borderBottom: '2px solid transparent',
    color: TEXT_MUTED, fontSize: 12, fontWeight: 600, fontFamily: FONT_UI, cursor: 'pointer',
  },
  dot: {
    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
    background: WIN_BASE, marginLeft: 4, verticalAlign: 'middle',
  },
  // borderBottom の一括指定と borderBottomColor を混ぜない (再描画で色が戻らないことがある)
  active:   { color: COOL_COLOR, borderBottom: `2px solid ${COOL_COLOR}` },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
};
