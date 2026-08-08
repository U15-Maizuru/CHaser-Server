import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_NUM, FONT_UI,
  RADIUS_PILL, RADIUS_SM, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, TURN_BASE,
} from './tokens';

/** ラベルと入力を横1列に並べる。`labelWidth` を揃えると縦の目線が通る */
export function Field({
  label, labelWidth = 96, style, children,
}: {
  label: ReactNode;
  labelWidth?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div style={{ ...s.field, ...style }}>
      <span style={{ ...s.label, width: labelWidth }}>{label}</span>
      {children}
    </div>
  );
}

export function TextInput({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} style={{ ...s.input, ...style }} />;
}

/** 数値入力。等幅フォントで桁を揃える */
export function NumberInput({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...rest} style={{ ...s.input, ...s.number, ...style }} />;
}

export function Select({ style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} style={{ ...s.input, ...s.select, ...style }} />;
}

export function Checkbox({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...rest} style={{ ...s.check, ...style }} />;
}

/** 排他・複数選択の小さな丸タグ。押せない Chip は `onClick` を渡さない */
export function Chip({
  selected = false, disabled = false, onClick, style, children,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...s.chip,
        ...(selected ? s.chipOn : null),
        ...(disabled ? s.chipOff : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function ChipRow({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return <div style={{ ...s.chipRow, ...style }}>{children}</div>;
}

const s: Record<string, CSSProperties> = {
  field: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12 },
  label: { flexShrink: 0, fontSize: 11, color: TEXT_SECONDARY },
  input: {
    minWidth: 0, padding: '5px 8px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    color: TEXT_PRIMARY, fontSize: 12, fontFamily: FONT_UI, boxSizing: 'border-box',
  },
  number: { width: 72, fontFamily: FONT_NUM, textAlign: 'right' },
  select: { background: BG_CARD, cursor: 'pointer' },
  check:  { width: 16, height: 16, cursor: 'pointer', accentColor: COOL_COLOR, flexShrink: 0 },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '5px 12px', borderRadius: RADIUS_PILL,
    border: `1px solid ${BORDER_COLOR}`, background: BG_ROOT,
    color: TEXT_SECONDARY, fontSize: 11, fontWeight: 600, fontFamily: FONT_UI,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  chipOn:  { background: TURN_BASE, borderColor: TURN_BASE, color: '#fff' },
  chipOff: { color: TEXT_MUTED, opacity: 0.45, cursor: 'not-allowed' },
};
