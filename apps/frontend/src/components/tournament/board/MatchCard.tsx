import type {
  MatchSlotRef, ResolvedParticipant, TournamentFormat, TournamentMatch,
} from '@u15/ws-types';
import { slotPlaceholder } from '@u15/ws-types';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE, FONT_NUM, FONT_UI,
  GOLD_BASE, GOLD_LIGHT, HOT_COLOR, HOT_LIGHT, HOT_PALE, RADIUS_SM, SHADOW_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, TURN_BASE, WIN_BASE, WIN_LIGHT, WIN_PALE,
} from '../../../ui';

// 1試合 (公式ルールの「試合」= 2ゲーム) のカード。
// control / display / 専用ウィンドウの3画面で共用する。操作の有無は interactive で切り替える。

export const CARD_W = 208;

// カードの高さに関わる寸法。ここが唯一の値の出所で、下の style オブジェクト
// (card/header/row/note) もこの定数を直に使って描画する。CARD_H/NOTE_H をこれらと
// 無関係な決め打ち数値にすると、行の高さを変えたときに直し忘れて、固定高さ+overflow:hidden で
// 下端が見切れる事故になる (実際に一度なった — "E2E-B" の行が欠けて見えた不具合)
const CARD_PAD_V  = 6;  // card の padding 上下 (それぞれ)
const CARD_GAP    = 3;  // flex 子要素どうしの隙間
const HEADER_H    = 16; // 見出し行 (ラベル + バッジ)。バッジの種類で内容の高さが変わっても
                         // 収まるよう、実際に必要な最大 (パディング付きバッジの高さ) に合わせてある
const ROW_LINE_H  = 18; // 対戦者1行のテキストの高さ
const ROW_PAD_V   = 2;  // 対戦者1行の padding 上下 (それぞれ)
const ROW_H       = ROW_LINE_H + ROW_PAD_V * 2;
const NOTE_LINE_H = 12; // 裁定の注記のテキストの高さ

export const CARD_H = CARD_PAD_V * 2 + HEADER_H + CARD_GAP + ROW_H + CARD_GAP + ROW_H;

// 審判裁定の注記 (裁定: ...) が付く試合は1行分だけ縦に伸びる。トーナメント表の座標計算
// (bracketLayout.ts) が押し下げに使う高さと実際の描画がずれるとカード同士が重なるため、
// 「その行があるかどうか」を高さの計算式ごと1箇所にまとめておく (MatchCard 自身もこれで描画する)。
const NOTE_H = CARD_GAP + NOTE_LINE_H;

/** そのカードが実際に必要とする高さ。bracketLayout に渡して重なりを防ぐ */
export function matchCardHeight(match: TournamentMatch): number {
  return match.result?.decidedBy === 'manual' ? CARD_H + NOTE_H : CARD_H;
}

const STATUS_LABEL: Record<TournamentMatch['status'], string> = {
  pending:          '勝者待ち',
  ready:            '対戦確定',
  armed:            '準備完了',
  in_progress:      '対戦中',
  awaiting_confirm: '結果確認',
  done:             '試合終了',
};

const STATUS_COLOR: Record<TournamentMatch['status'], string> = {
  pending:          TEXT_MUTED,
  ready:            TURN_BASE,
  armed:            COOL_COLOR,
  in_progress:      HOT_COLOR,
  awaiting_confirm: GOLD_BASE,
  done:             WIN_BASE,
};

export interface MatchCardProps {
  match:        TournamentMatch;
  participants: ResolvedParticipant[];
  /** 未確定の枠の呼び名を形式に合わせるため (「Aリーグ 1位」/「予選 1位」)。省略可 */
  format?:      TournamentFormat;
  /** true なら選択できる (control / 専用窓)。display では false */
  interactive?: boolean;
  selected?:    boolean;
  /** 「この試合を準備」で確定した、これから行う試合。観客に一目で分かるよう強調する */
  upcoming?:    boolean;
  /** たった今「確定」した試合。次の試合が始まるまで、どれが終わったのかを示す */
  justFinished?: boolean;
  onSelect?:    (matchId: string) => void;
  style?:       React.CSSProperties;
}

export function MatchCard({
  match, participants, format, interactive = false, selected = false, upcoming = false,
  justFinished = false, onSelect, style,
}: MatchCardProps) {
  // まだ相手が決まっていない枠でも、決まり方が分かるなら書く (「Aリーグ 1位」)。
  // 予選の結果待ちの準決勝が「—」だけだと、観客にも運営にも何を待っているのか伝わらない
  const nameOf = (id: string | null, isBye: boolean, ref: MatchSlotRef): string => {
    if (isBye) return '不戦';
    if (!id)   return slotPlaceholder(ref, format) ?? '—';
    const p = participants.find(x => x.id === id);
    if (!p) return id;
    // 運営BOT は参加者ではないので、名前だけだとエントリーの1人に見える
    return p.isBot ? `🤖 ${p.name}` : p.name;
  };

  const winner = match.result?.winnerSide ?? null;
  const rows: { side: 0 | 1; name: string; points: number | null; won: boolean; pending: boolean }[] = [
    {
      side: 0,
      name: nameOf(match.resolvedA, match.byeA, match.slotA),
      points: match.result?.set?.totals[0] ?? null,
      won: winner === 0,
      pending: !match.resolvedA && !match.byeA,
    },
    {
      side: 1,
      name: nameOf(match.resolvedB, match.byeB, match.slotB),
      points: match.result?.set?.totals[1] ?? null,
      won: winner === 1,
      pending: !match.resolvedB && !match.byeB,
    },
  ];

  const clickable = interactive && !!onSelect;
  // 同点で再試合になった試合は、結果を捨てた時点で他の未実施の試合と同じ 'ready' に
  // 戻ってしまう。観客・運営が「再試合待ち」だと分かるよう、状態バッジだけ別扱いにする
  const rematch = !!match.rematchPending;

  return (
    <div
      style={{
        // 「次の試合」と「たった今終わった試合」が同時に同じカードに付くことはない
        // (確定した瞬間に準備は外れる) ので、上書き順は問題にならない
        ...card,
        height: matchCardHeight(match),
        // rematch は upcoming/justFinished より弱い強調。同点で再試合待ちのまま次の準備に
        // 入る (再試合を armMatch で準備し直す) こともあるので、その間は upcoming を優先する
        ...(rematch ? cardRematch : null),
        ...(justFinished ? cardJustFinished : null),
        ...(upcoming ? cardUpcoming : null),
        ...(selected ? cardSelected : null),
        ...(clickable ? cardClickable : null),
        ...style,
      }}
      onClick={clickable ? () => onSelect!(match.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={match.label}
    >
      {upcoming && <style>{UPCOMING_KEYFRAMES}</style>}
      <div style={header}>
        <span style={label}>{match.label}</span>
        <span style={
          upcoming     ? { ...badge, ...badgeUpcoming }
        : justFinished ? { ...badge, ...badgeJustFinished }
        : rematch      ? { ...badge, ...badgeRematch }
        : { ...badge, color: STATUS_COLOR[match.status] }}>
          {upcoming ? '対戦試合' : justFinished ? '試合終了' : rematch ? '再試合待ち' : STATUS_LABEL[match.status]}
        </span>
      </div>

      {rows.map(r => (
        <div key={r.side} style={{ ...row, ...(r.side === 0 ? rowCool : rowHot) }}>
          <span style={{ ...name, ...(r.won ? nameWon : null), ...(r.pending ? namePending : null) }}>
            {r.won && <span style={crown}>🏆</span>}
            {r.name}
          </span>
          <span style={points}>{r.points ?? '—'}</span>
        </div>
      ))}

      {match.result?.decidedBy === 'manual' && (
        <div style={note}>裁定{match.result.note ? `: ${match.result.note}` : ''}</div>
      )}
    </div>
  );
}

// height は matchCardHeight() で決め打ちする (minHeight ではなく固定)。
// bracketLayout.ts の押し下げ計算がカードの高さを前提にしているため、実際の描画が
// それより伸びると下のカード (3位決定戦など) に重なってしまう。
// **この固定が意味を持つのは、中身の各行 (header/row/note) の高さがブラウザ既定の行高に
// 頼らず lineHeight で決め打ちされているときだけ。** どちらかだけ直すと、指定した高さより
// 実際の中身が高くなって下端が見切れる (これで一度事故った)
const card: React.CSSProperties = {
  width: CARD_W, boxSizing: 'border-box', overflow: 'hidden',
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_SM, boxShadow: SHADOW_SM,
  padding: `${CARD_PAD_V}px 8px`, fontFamily: FONT_UI,
  display: 'flex', flexDirection: 'column', gap: CARD_GAP,
};

const cardClickable: React.CSSProperties = { cursor: 'pointer' };

const cardSelected: React.CSSProperties = {
  outline: `2px solid ${COOL_COLOR}`, outlineOffset: 1,
};

// これから行う試合。観客席から一目で分かるよう、枠を金色にして脈打たせる。
// アニメーションはインラインの <style> で入れる (ManualControls と同じやり方)。
const UPCOMING_KEYFRAMES = `
@keyframes u15-upcoming {
  0%,100% { box-shadow: 0 0 0 2px ${GOLD_BASE}, 0 0 10px 2px rgba(221,170,34,0.35) }
  50%     { box-shadow: 0 0 0 3px ${GOLD_BASE}, 0 0 20px 6px rgba(221,170,34,0.65) }
}`;

const cardUpcoming: React.CSSProperties = {
  // card と同じ border ショートハンドで上書きする (borderColor だけ足すと
  // 「ショートハンドと混ぜるな」と React に警告される)
  border: `1px solid ${GOLD_BASE}`,
  background: GOLD_LIGHT,
  animation: 'u15-upcoming 1.6s ease-in-out infinite',
};

const badgeUpcoming: React.CSSProperties = {
  color: '#fff', background: GOLD_BASE, borderRadius: 99, padding: '1px 6px',
};

// たった今確定した試合。次の試合の金色とは別の色 (勝利のミント) にして、
// 観客席から「これから」と「終わったばかり」を取り違えないようにする
const cardJustFinished: React.CSSProperties = {
  border: `1px solid ${WIN_BASE}`,
  background: WIN_PALE,
  boxShadow: `0 0 0 2px ${WIN_LIGHT}, ${SHADOW_SM}`,
};

const badgeJustFinished: React.CSSProperties = {
  color: '#fff', background: WIN_BASE, borderRadius: 99, padding: '1px 6px',
};

// 同点で再試合待ちの試合。運営の判断が要ることを枠でも伝える (バッジと同じ HOT 色)
const cardRematch: React.CSSProperties = {
  border: `1px solid ${HOT_COLOR}`,
  background: HOT_PALE,
  boxShadow: `0 0 0 2px ${HOT_LIGHT}, ${SHADOW_SM}`,
};

const badgeRematch: React.CSSProperties = {
  color: '#fff', background: HOT_COLOR, borderRadius: 99, padding: '1px 6px',
};

// minHeight で固定する。バッジの種類 (パディング付き/無し) で見出しの高さが変わると
// カード全体の高さが CARD_H からずれる
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  minHeight: HEADER_H,
};

const label: React.CSSProperties = {
  fontSize: 10, lineHeight: '14px', color: TEXT_SECONDARY, whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
};

const badge: React.CSSProperties = {
  fontSize: 9, lineHeight: '14px', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
};

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 6, padding: `${ROW_PAD_V}px 6px`, borderRadius: 6,
};

const rowCool: React.CSSProperties = { background: COOL_PALE };
const rowHot:  React.CSSProperties = { background: HOT_PALE };

const name: React.CSSProperties = {
  fontSize: 12, lineHeight: `${ROW_LINE_H}px`, color: TEXT_PRIMARY, minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const nameWon: React.CSSProperties = { fontWeight: 700 };

// 「Aリーグ 1位」のような予定枠。確定した名前と見分けがつくよう控えめに出す
const namePending: React.CSSProperties = { color: TEXT_MUTED, fontStyle: 'italic' };

const crown: React.CSSProperties = { marginRight: 3, fontSize: 10 };

const points: React.CSSProperties = {
  fontSize: 12, lineHeight: `${ROW_LINE_H}px`, fontFamily: FONT_NUM, color: TEXT_SECONDARY,
  flexShrink: 0,
};

// NOTE_H と対になる行の高さ。長い裁定理由は折り返さず省略する —
// 折り返すとカードの実際の高さが NOTE_H からずれてしまう
const note: React.CSSProperties = {
  fontSize: 9, color: TEXT_MUTED, textAlign: 'right', lineHeight: `${NOTE_LINE_H}px`,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
