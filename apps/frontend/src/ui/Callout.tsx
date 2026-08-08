import type { CSSProperties, ReactNode } from 'react';
import {
  BORDER_COLOR, GOLD_BASE, HOT_COLOR, RADIUS_SM, TEXT_MUTED, TEXT_SECONDARY, TURN_PALE,
} from './tokens';

export type CalloutTone = 'info' | 'warn' | 'error';

const TONES: Record<CalloutTone, CSSProperties & { mark: string }> = {
  info:  { background: TURN_PALE, border: `1px solid ${BORDER_COLOR}`, color: TEXT_SECONDARY, mark: '' },
  warn:  { background: '#fffaf0', border: `1px solid ${GOLD_BASE}`,    color: '#8a6d1f',      mark: '⚠ ' },
  error: { background: '#fff0f0', border: `1px solid ${HOT_COLOR}`,   color: HOT_COLOR,      mark: '⚠ ' },
};

/**
 * 注意を引く一枚帯。`onDismiss` を渡すとクリックで閉じられる。
 *
 * 「読まないと操作を誤る」ことだけを載せる — 補足なら Hint を使う。
 */
export function Callout({
  tone = 'info', onDismiss, testId, style, children,
}: {
  tone?: CalloutTone;
  onDismiss?: () => void;
  /** テストから掴むための data-testid */
  testId?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { mark, ...look } = TONES[tone];
  return (
    <div
      style={{ ...s.base, ...look, ...(onDismiss ? { cursor: 'pointer' } : null), ...style }}
      onClick={onDismiss}
      title={onDismiss ? 'クリックで閉じる' : undefined}
      data-testid={testId}
    >
      {mark}{children}
    </div>
  );
}

/** 中身が無いことを伝える置き場所。空白のまま放置しないための受け皿 */
export function EmptyState({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <div style={{ ...s.empty, ...style }}>{children}</div>;
}

const s: Record<string, CSSProperties> = {
  base: {
    borderRadius: RADIUS_SM, padding: '8px 12px',
    fontSize: 11, lineHeight: 1.6, overflowWrap: 'anywhere',
  },
  empty: {
    padding: 14, textAlign: 'center', color: TEXT_MUTED, fontSize: 12,
  },
};
