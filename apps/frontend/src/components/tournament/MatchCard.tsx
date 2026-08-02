import type { ResolvedParticipant, TournamentMatch } from '@u15/ws-types';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE, FONT_NUM, FONT_UI,
  GOLD_BASE, HOT_COLOR, HOT_PALE, RADIUS_SM, SHADOW_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, TURN_BASE, WIN_BASE,
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
  onSelect?:    (matchId: string) => void;
  style?:       React.CSSProperties;
}

export function MatchCard({
  match, participants, interactive = false, selected = false, onSelect, style,
}: MatchCardProps) {
  const nameOf = (id: string | null, isBye: boolean): string => {
    if (isBye) return '不戦';
    if (!id)   return '—';
    return participants.find(p => p.id === id)?.name ?? id;
  };

  const winner = match.result?.winnerSide ?? null;
  const rows: { side: 0 | 1; name: string; points: number | null; won: boolean }[] = [
    {
      side: 0,
      name: nameOf(match.resolvedA, match.byeA),
      points: match.result?.set?.totals[0] ?? null,
      won: winner === 0,
    },
    {
      side: 1,
      name: nameOf(match.resolvedB, match.byeB),
      points: match.result?.set?.totals[1] ?? null,
      won: winner === 1,
    },
  ];

  const clickable = interactive && !!onSelect;

  return (
    <div
      style={{ ...card, ...(selected ? cardSelected : null), ...(clickable ? cardClickable : null), ...style }}
      onClick={clickable ? () => onSelect!(match.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={match.label}
    >
      <div style={header}>
        <span style={label}>{match.label}</span>
        <span style={{ ...badge, color: STATUS_COLOR[match.status] }}>
          {STATUS_LABEL[match.status]}
        </span>
      </div>

      {rows.map(r => (
        <div key={r.side} style={{ ...row, ...(r.side === 0 ? rowCool : rowHot) }}>
          <span style={{ ...name, ...(r.won ? nameWon : null) }}>
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

const crown: React.CSSProperties = { marginRight: 3, fontSize: 10 };

const points: React.CSSProperties = {
  fontSize: 12, fontFamily: FONT_NUM, color: TEXT_SECONDARY, flexShrink: 0,
};

const note: React.CSSProperties = {
  fontSize: 9, color: TEXT_MUTED, textAlign: 'right',
};
