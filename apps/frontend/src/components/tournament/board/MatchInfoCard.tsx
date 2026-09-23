import type { TournamentMatch } from '@u15/ws-types';
import {
  BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI,
  GOLD_BASE, HOT_COLOR, RADIUS_SM,
  TEXT_SECONDARY, WIN_BASE, WIN_PALE,
} from '../../../ui';
import { MATCH_STATUS_LABEL, MATCH_STATUS_COLOR } from './matchStatusStyle';

// トーナメント表で、対になる2枚の PlayerCard の間に挟む「対戦」そのものの情報カード。
// 試合ラベル (「準決勝 第1試合」) と状態バッジ (「試合終了」など) はここにしか出さない
// — PlayerCard に付けると対戦者ごとに重複して出てしまうため。
// 勝敗数や裁定理由といった試合結果そのものはここには出さない (結果はトーナメント表の役目ではない)。

const PAD_V = 5;
const ROW_H = 19;
const GAP   = 2;

export const MATCH_INFO_H = PAD_V * 2 + ROW_H;

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
        height: MATCH_INFO_H,
        // 試合終了は枠と背景を PlayerCard の cardWon と同じ WIN 色に沈め、間に挟まる
        // このカードごと「決着済みの1組」として浮くようにする。ラベル・バッジの色だけでは
        // 縮小表示のときに気づきにくい (PlayerCard.tsx の cardCool/cardHot と同じ理由)
        ...(match.status === 'done' ? cardDone : null),
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
          {/* upcoming / justFinished は色で示す強調で、状態そのものは status が持つ。
              ここに別のラベルを置くと「対戦試合」のような、状態でも呼び名でもない語ができる */}
          {rematch ? '再試合待ち' : MATCH_STATUS_LABEL[match.status]}
        </span>
      </div>
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

// PlayerCard の cardWon と同じ WIN 色。border だけ足すと card の 1px 実線と
// ショートハンドが混ざるので border ごと上書きする
const cardDone: React.CSSProperties = {
  border: `1px solid ${WIN_BASE}`,
  background: WIN_PALE,
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
