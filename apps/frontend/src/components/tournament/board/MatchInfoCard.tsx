import type { TournamentMatch } from '@u15/ws-types';
import {
  BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI,
  GOLD_BASE, HOT_COLOR, RADIUS_SM,
  TEXT_MUTED, TEXT_SECONDARY, WIN_BASE,
} from '../../../ui';
import { MATCH_STATUS_LABEL, MATCH_STATUS_COLOR } from './matchStatusStyle';

// トーナメント表で、対になる2枚の PlayerCard の間に挟む「対戦」そのものの情報カード。
// 試合ラベル (「準決勝 第1試合」) と状態バッジ (「試合終了」など) はここにしか出さない
// — PlayerCard に付けると対戦者ごとに重複して出てしまうため。

const PAD_V       = 5;
const ROW_H       = 19;
const NOTE_LINE_H = 13;
const GAP         = 2;

export const MATCH_INFO_H = PAD_V * 2 + ROW_H;
const NOTE_H = GAP + NOTE_LINE_H;

/** その試合の対戦カードが実際に必要とする高さ。centeredBracketLayout に渡して重なりを防ぐ */
export function matchInfoHeight(match: TournamentMatch): number {
  return match.result?.decidedBy === 'manual' ? MATCH_INFO_H + NOTE_H : MATCH_INFO_H;
}

export interface MatchInfoCardProps {
  match: TournamentMatch;
  /** true なら選択できる (control / 専用窓)。display では false */
  interactive?: boolean;
  selected?: boolean;
  /** 「この試合を準備」で確定した、これから行う試合 */
  upcoming?: boolean;
  /** たった今「確定」した試合 */
  justFinished?: boolean;
  onSelect?: (matchId: string) => void;
  style?: React.CSSProperties;
}

export function MatchInfoCard({
  match, interactive = false, selected = false, upcoming = false, justFinished = false,
  onSelect, style,
}: MatchInfoCardProps) {
  const hasBye = match.byeA || match.byeB;
  const clickable = interactive && !!onSelect && !hasBye;
  const rematch = !!match.rematchPending;

  return (
    <div
      style={{
        ...card,
        height: matchInfoHeight(match),
        ...(selected ? cardSelected : null),
        ...(clickable ? cardClickable : null),
        ...(hasBye ? cardHidden : null),
        ...style,
      }}
      onClick={clickable ? () => onSelect!(match.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div style={row}>
        <span style={label}>{match.label}</span>
        <span style={
          upcoming     ? { ...badge, ...badgeUpcoming }
        : justFinished ? { ...badge, ...badgeJustFinished }
        : rematch      ? { ...badge, ...badgeRematch }
        : { ...badge, color: MATCH_STATUS_COLOR[match.status] }}>
          {upcoming ? '対戦試合' : justFinished ? '試合終了' : rematch ? '再試合待ち' : MATCH_STATUS_LABEL[match.status]}
        </span>
      </div>

      {match.result?.decidedBy === 'manual' && (
        <div style={note}>裁定{match.result.note ? `: ${match.result.note}` : ''}</div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  boxSizing: 'border-box', overflow: 'hidden',
  background: BG_ROOT, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_SM,
  padding: `${PAD_V}px 8px`, fontFamily: FONT_UI,
  display: 'flex', flexDirection: 'column', gap: GAP,
  justifyContent: 'center',
};

const cardClickable: React.CSSProperties = { cursor: 'pointer' };

const cardSelected: React.CSSProperties = {
  outline: `2px solid ${COOL_COLOR}`, outlineOffset: 1,
};

// 不戦の試合は PlayerCard ごと隠すので、対戦カードも同様に隠す
const cardHidden: React.CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
};

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
};

const label: React.CSSProperties = {
  fontSize: 13, lineHeight: `${ROW_H}px`, color: TEXT_SECONDARY, whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
};

const badge: React.CSSProperties = {
  fontSize: 11, lineHeight: `${ROW_H}px`, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
};

const badgeUpcoming: React.CSSProperties = { color: GOLD_BASE };
const badgeJustFinished: React.CSSProperties = { color: WIN_BASE };
const badgeRematch: React.CSSProperties = { color: HOT_COLOR };

// 長い裁定理由は折り返さず省略する — 折り返すとカードの実際の高さが NOTE_H からずれてしまう
const note: React.CSSProperties = {
  fontSize: 12, color: TEXT_MUTED, textAlign: 'center', lineHeight: `${NOTE_LINE_H}px`,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
