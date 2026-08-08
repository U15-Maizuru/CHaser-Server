import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, FONT_UI, HOT_COLOR,
  RADIUS_PILL, RADIUS_SM, SHADOW_SM, TEXT_MUTED, TEXT_SECONDARY, WIN_BASE,
} from './tokens';

/**
 * ボタンの役割。色は役割から決まるので、呼び出し側は色を指定しない。
 *
 * primary   … 進行の主アクション (ゲームスタート / この試合を準備)
 * accent    … 副次的な主アクション (この大会を運営 / 新規作成)
 * secondary … 枠線つきの通常操作
 * ghost     … 枠なしの弱い操作 (閉じる / 解除)
 * danger    … 取り消し・破棄 (運営を終了)
 * choice    … 排他トグル。selected で塗る
 * icon      … 正方形のアイコン1文字
 */
export type ButtonVariant =
  | 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'choice' | 'icon';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?:    ButtonSize;
  /** variant='choice' のとき、選ばれている側か */
  selected?: boolean;
  /** 親の flex に潰されないようにする */
  noShrink?: boolean;
}

/** フッターのバー要素と高さを揃えるための基準値 */
export const BUTTON_BAR_HEIGHT = 36;

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { fontSize: 11, padding: '5px 12px' },
  md: { fontSize: 12, padding: '7px 14px' },
  lg: { fontSize: 15, padding: '10px 32px', fontWeight: 800, letterSpacing: 1 },
};

const FILLED: CSSProperties = { border: 'none', color: '#fff' };

const OUTLINED: CSSProperties = {
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, color: TEXT_SECONDARY,
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary:   { ...FILLED, background: WIN_BASE,  boxShadow: SHADOW_SM },
  accent:    { ...FILLED, background: COOL_COLOR },
  danger:    { ...FILLED, background: HOT_COLOR },
  secondary: OUTLINED,
  ghost:     { border: 'none', background: 'transparent', color: TEXT_SECONDARY },
  choice:    { ...OUTLINED, background: 'transparent', borderRadius: RADIUS_SM },
  icon:      { ...OUTLINED, padding: 0, width: BUTTON_BAR_HEIGHT, height: BUTTON_BAR_HEIGHT },
};

const SELECTED: CSSProperties = {
  background: COOL_COLOR, borderColor: COOL_COLOR, color: '#fff',
};

/** 押せない状態。disabled 属性と見た目を必ず一致させるためここで一元的に当てる */
const DISABLED: CSSProperties = {
  color: TEXT_MUTED, cursor: 'not-allowed', boxShadow: 'none', opacity: 0.55,
};

export function Button({
  variant = 'secondary', size = 'md', selected = false, noShrink = false,
  style, disabled, ...rest
}: ButtonProps) {
  const composed: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS_PILL, boxSizing: 'border-box', whiteSpace: 'nowrap',
    fontFamily: FONT_UI, fontWeight: 700, cursor: 'pointer',
    ...SIZES[size],
    ...VARIANTS[variant],
    ...(variant === 'choice' && selected ? SELECTED : null),
    ...(noShrink ? { flexShrink: 0 } : null),
    ...(disabled ? DISABLED : null),
    ...style,
  };
  return <button {...rest} disabled={disabled} style={composed} />;
}

/**
 * `<label>` を押しボタンに見せる (ファイル選択の `<input type=file>` を包むため)。
 * `<button>` では `<input>` を子に持てないので別入口にしている。
 */
export function ButtonLabel({
  variant = 'secondary', size = 'md', style, children, ...rest
}: { variant?: ButtonVariant; size?: ButtonSize } & React.LabelHTMLAttributes<HTMLLabelElement>) {
  const composed: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS_PILL, boxSizing: 'border-box', whiteSpace: 'nowrap',
    fontFamily: FONT_UI, fontWeight: 700, cursor: 'pointer',
    ...SIZES[size],
    ...VARIANTS[variant],
    ...style,
  };
  return <label {...rest} style={composed}>{children}</label>;
}
