import type { CSSProperties, ReactNode } from 'react';
import { BG_ROOT, FONT_UI, TEXT_MUTED, TEXT_PRIMARY } from './tokens';

/**
 * まだ何も出せないときの全画面 (バックエンド接続待ち)。
 *
 * **窓ごとに書き起こさないこと。** 起動のたび、また瞬断のたびに窓ごとに違う画面
 * (黒地の等幅フォントなど) がひらめくのは、会場に出す画面としてはただの事故に見える。
 */
export function Splash({ title, sub, children }: {
  title: ReactNode;
  /** 待っている理由 */
  sub?: ReactNode;
  /** 右上などに重ねるもの (ブラウザ観戦者のミュート切り替え) */
  children?: ReactNode;
}) {
  return (
    <div style={s.root}>
      <div style={s.title}>{title}</div>
      {sub && <div style={s.sub}>{sub}</div>}
      {children}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 16,
    background: BG_ROOT, fontFamily: FONT_UI,
  },
  title: { fontSize: 32, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_MUTED },
};
