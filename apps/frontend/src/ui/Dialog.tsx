import type { CSSProperties, ReactNode } from 'react';
import {
  BG_CARD, BG_SCRIM, BORDER_COLOR, FONT_UI, RADIUS_MD, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY,
} from './tokens';

export interface DialogProps {
  title: ReactNode;
  onClose: () => void;
  /** シートの幅。省略すると中身に合わせる (マップエディタのように中身が幅を決める場合) */
  width?: number | string;
  maxHeight?: number | string;
  /** 下端に固定される操作列 */
  footer?: ReactNode;
  /** 本文をスクロールさせず、中身に高さを任せる (canvas を持つダイアログ用) */
  bodyScroll?: boolean;
  bodyStyle?: CSSProperties;
  children: ReactNode;
}

/**
 * 画面全体を覆うモーダル。幕のクリックで閉じ、シート内のクリックは伝播させない。
 *
 * ヘッダ・本文・フッタの3段構成に固定し、本文だけがスクロールする。
 * こうしておかないと、中身が伸びたときにタイトルと確定ボタンが画面外へ出る。
 */
export function Dialog({
  title, onClose, width, maxHeight = '90vh', footer, bodyScroll = true, bodyStyle, children,
}: DialogProps) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div
        style={{ ...s.sheet, width, maxHeight }}
        onClick={e => e.stopPropagation()}
      >
        <div style={s.header}>
          <span style={s.title}>{title}</span>
          <button style={s.close} onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        <div style={{ ...s.body, ...(bodyScroll ? s.bodyScroll : null), ...bodyStyle }}>
          {children}
        </div>

        {footer && <div style={s.footer}>{footer}</div>}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: BG_SCRIM, zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  sheet: {
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
    color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    padding: '14px 20px', borderBottom: `1px solid ${BORDER_COLOR}`, flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: 800 },
  close: {
    background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 16,
    cursor: 'pointer', padding: '0 4px',
  },
  body:       { padding: '16px 20px', flex: 1, minHeight: 0, minWidth: 0 },
  bodyScroll: { overflow: 'auto' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
    padding: '14px 20px', borderTop: `1px solid ${BORDER_COLOR}`, flexShrink: 0,
  },
};
