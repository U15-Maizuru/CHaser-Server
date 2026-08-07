import type { MatchSlotRef, ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import { slotPlaceholder } from '@u15/ws-types';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE, FONT_NUM, FONT_UI,
  GOLD_BASE, GOLD_LIGHT, HOT_COLOR, HOT_PALE, RADIUS_SM, SHADOW_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, TURN_BASE, WIN_BASE, WIN_LIGHT, WIN_PALE,
} from '../../styles/tokens';

// 1試合 (公式ルールの「試合」= 2ゲーム) のカード。
// control / display / 専用ウィンドウの3画面で共用する。操作の有無は interactive で切り替える。

export const CARD_W = 208;
export const CARD_H = 68;

const STATUS_LABEL: Record<TournamentMatch['status'], string> = {
  pending:          '待機',
  ready:            '準備OK',
  armed:            '準備完了',
  in_progress:      '対戦中',
  awaiting_confirm: '結果確認',
  done:             '確定',
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
  match, participants, interactive = false, selected = false, upcoming = false,
  justFinished = false, onSelect, style,
}: MatchCardProps) {
  // まだ相手が決まっていない枠でも、決まり方が分かるなら書く (「Aリーグ 1位」)。
  // 予選の結果待ちの準決勝が「—」だけだと、観客にも運営にも何を待っているのか伝わらない
  const nameOf = (id: string | null, isBye: boolean, ref: MatchSlotRef): string => {
    if (isBye) return '不戦';
    if (!id)   return slotPlaceholder(ref) ?? '—';
    return participants.find(p => p.id === id)?.name ?? id;
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

  return (
    <div
      style={{
        // 「次の試合」と「たった今終わった試合」が同時に同じカードに付くことはない
        // (確定した瞬間に準備は外れる) ので、上書き順は問題にならない
        ...card,
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
        : { ...badge, color: STATUS_COLOR[match.status] }}>
          {upcoming ? '対戦試合' : justFinished ? '試合終了' : STATUS_LABEL[match.status]}
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

const card: React.CSSProperties = {
  width: CARD_W, minHeight: CARD_H, boxSizing: 'border-box',
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_SM, boxShadow: SHADOW_SM,
  padding: '6px 8px', fontFamily: FONT_UI,
  display: 'flex', flexDirection: 'column', gap: 3,
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

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
};

const label: React.CSSProperties = {
  fontSize: 10, color: TEXT_SECONDARY, whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
};

const badge: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
};

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 6, padding: '2px 6px', borderRadius: 6,
};

const rowCool: React.CSSProperties = { background: COOL_PALE };
const rowHot:  React.CSSProperties = { background: HOT_PALE };

const name: React.CSSProperties = {
  fontSize: 12, color: TEXT_PRIMARY, minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const nameWon: React.CSSProperties = { fontWeight: 700 };

// 「Aリーグ 1位」のような予定枠。確定した名前と見分けがつくよう控えめに出す
const namePending: React.CSSProperties = { color: TEXT_MUTED, fontStyle: 'italic' };

const crown: React.CSSProperties = { marginRight: 3, fontSize: 10 };

const points: React.CSSProperties = {
  fontSize: 12, fontFamily: FONT_NUM, color: TEXT_SECONDARY, flexShrink: 0,
};

const note: React.CSSProperties = {
  fontSize: 9, color: TEXT_MUTED, textAlign: 'right',
};
