import type { CSSProperties } from 'react';
import { BORDER_COLOR, COOL_COLOR, FONT_UI, TEXT_MUTED } from './tokens';

export interface TabDef<T extends string> {
  id:    T;
  label: string;
  /** 押せない理由。渡すと無効化され、title に出る */
  disabledReason?: string;
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
  active:   { color: COOL_COLOR, borderBottomColor: COOL_COLOR },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
};
