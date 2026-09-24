import type { AnnouncementState } from '@u15/ws-types';
import { FitArea } from './FitArea';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, COOL_PALE, HOT_COLOR, HOT_PALE,
  RADIUS_LG, RADIUS_MD, RADIUS_PILL, SHADOW_MD, TURN_BASE, TURN_LIGHT, TURN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, FONT_UI,
} from '../ui';

// 試合と試合の合間に観戦画面へ出す運営アナウンス (「10分間の休憩にします」など)。
//
// 待機画面 (対戦カードを組む前 / 結果を確定したあと) を置き換えるだけで、対戦中・
// 結果表示・表彰には割り込まない — 割り込み条件は DisplayMode の displayScene が持つ。
//
// **見た目は待機画面・表彰画面と同じ骨格**にしてある: パステルの地に白いカードを1枚置き、
// COOL → ターン → HOT の3色グラデーションで大会の配色に結ぶ。プロジェクタに数分間
// 出しっぱなしにする画面なので、バッジだけをゆっくり脈打たせて「生きている」ことを示す
// (トーナメント表の「次の試合」の点滅と同じ考え方で、速さと強さはずっと控えめにする)。
//
// **本文は運営が打った改行をそのまま行として出す** (pre-wrap)。「午後の開始は13:00です」の
// ように複数行を並べたい場面が多く、こちらで整形し直すと運営の意図した見え方から離れる。

export interface AnnouncementScreenProps {
  announcement: AnnouncementState;
  /** 画面上端に小さく出す大会名 / 表示タイトル */
  displayTitle: string;
}

/** バッジの淡い光。**2.8秒とゆっくりにすること** — 休憩中ずっと出る画面なので目が疲れる */
const KEYFRAMES = `
@keyframes u15-announce-glow {
  0%,100% { box-shadow: 0 0 0 0 rgba(153,102,221,0.30), 0 6px 16px rgba(120,90,200,0.22) }
  50%     { box-shadow: 0 0 0 10px rgba(153,102,221,0.00), 0 6px 16px rgba(120,90,200,0.22) }
}`;

export function AnnouncementScreen({ announcement, displayTitle }: AnnouncementScreenProps) {
  const { title, body } = announcement;
  return (
    <div style={s.root}>
      <style>{KEYFRAMES}</style>

      {/* 会場のプロジェクタいっぱいまで、見出しごと1つの組版として拡大する。
          中身の幅を決め打ちにしてあるので、長い本文は折り返したうえで全体が縮む
          (FitArea は max-content 幅で測るため、幅を固定しないと1行のまま横に伸びる) */}
      <FitArea maxScale={2} style={s.area}>
        <div style={s.stack}>
          <div style={s.eyebrow}>{displayTitle}</div>

          <div style={s.card}>
            <div style={s.ribbon} />
            <div style={s.inner}>
              <div style={s.badge}>お知らせ</div>
              {/* 見出しは淡い紫の札に載せる (待機画面の「試合終了」の囲みと同じ作り)。
                  見出しが無いときだけ、バッジと本文の間に短い罫を入れて間を持たせる */}
              {title !== ''
                ? <div style={s.title}>{title}</div>
                : <div style={s.rule} />}
              {body !== '' && <div style={s.body}>{body}</div>}
            </div>
          </div>
        </div>
      </FitArea>
    </div>
  );
}

/** カード上辺の帯とバッジに使う、COOL → ターン → HOT の3色 */
const BRAND_GRADIENT = `linear-gradient(90deg, ${COOL_COLOR} 0%, ${TURN_BASE} 52%, ${HOT_COLOR} 100%)`;

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    boxSizing: 'border-box', overflow: 'hidden',
    // 左右を広めに空ける。FitArea は空きいっぱいまで拡大するので、余白を削ると
    // カードの角と影が画面の端で切れる
    padding: '28px 72px', fontFamily: FONT_UI,
    // パステルのにじみを3か所置いて、白いカードを浮かせる (BG_HEADER と同じ配色感)
    background: `
      radial-gradient(58% 58% at 12% 8%,  ${COOL_PALE} 0%, rgba(255,255,255,0) 70%),
      radial-gradient(52% 52% at 88% 14%, ${HOT_PALE}  0%, rgba(255,255,255,0) 70%),
      radial-gradient(70% 70% at 50% 104%, ${TURN_PALE} 0%, rgba(255,255,255,0) 68%),
      ${BG_ROOT}`,
  },
  // FitArea は高さの決まった箱の中で働く
  area:  { flex: 1, minHeight: 0 },
  stack: { width: 760, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 },

  eyebrow: {
    fontSize: 15, fontWeight: 700, letterSpacing: '0.16em',
    color: TEXT_SECONDARY, textAlign: 'center',
  },

  card: {
    width: '100%', boxSizing: 'border-box', overflow: 'hidden',
    background: BG_CARD, borderRadius: RADIUS_LG,
    border: `1px solid ${BORDER_COLOR}`, boxShadow: SHADOW_MD,
  },
  ribbon: { height: 10, background: BRAND_GRADIENT },
  inner: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
    padding: '38px 52px 46px',
  },

  badge: {
    fontSize: 15, fontWeight: 800, letterSpacing: '0.22em',
    color: '#fff', background: BRAND_GRADIENT,
    borderRadius: RADIUS_PILL, padding: '7px 26px 7px 28px',
    animation: 'u15-announce-glow 2.8s ease-in-out infinite',
  },

  title: {
    fontSize: 46, fontWeight: 800, letterSpacing: '0.06em', lineHeight: 1.3,
    color: TEXT_PRIMARY, textAlign: 'center', wordBreak: 'break-word',
    background: TURN_PALE, border: `2px solid ${TURN_LIGHT}`,
    borderRadius: RADIUS_MD, padding: '10px 34px',
  },
  // 見出しと本文をつなぐ短い罫。見出しが無いときは badge と本文の間に入る
  rule: { width: 76, height: 4, borderRadius: 99, background: BRAND_GRADIENT, opacity: 0.85 },

  body: {
    fontSize: 30, fontWeight: 700, lineHeight: 1.8,
    color: TEXT_PRIMARY, textAlign: 'center',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
};
