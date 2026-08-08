import type { CSSProperties, ReactNode } from 'react';
import {
  BG_CARD, BORDER_COLOR, RADIUS_MD, SHADOW_MD, TEXT_SECONDARY,
} from './tokens';

/** 一まとまりの操作・情報を載せる白い箱 */
export function Card({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <div style={{ ...s.card, ...style }}>{children}</div>;
}

/** 見出しつきの Card。`actions` は見出しの右端に並ぶ */
export function Section({
  title, actions, style, children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div style={{ ...s.card, ...style }}>
      <div style={s.head}>
        <span style={s.title}>{title}</span>
        {actions && <div style={s.actions}>{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** 補足説明。本文より一段弱い扱いで、読み飛ばしても操作できる内容だけを置く */
export function Hint({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <p style={{ ...s.hint, ...style }}>{children}</p>;
}

const s: Record<string, CSSProperties> = {
  card: {
    background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_MD, padding: 14,
    display: 'flex', flexDirection: 'column', gap: 8,
    // flex アイテムの自動最小サイズ (min-width:auto) を切らないと中身の幅で押し広げられる
    minWidth: 0, boxSizing: 'border-box',
  },
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  title:   { fontSize: 14, fontWeight: 700 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  hint: {
    margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6,
    overflowWrap: 'anywhere',
  },
};
