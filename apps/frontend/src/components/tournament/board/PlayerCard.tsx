import type {
  MatchSlotRef, ResolvedParticipant, TournamentFormat, TournamentMatch,
} from '@u15/ws-types';
import { slotPlaceholder } from '@u15/ws-types';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE, FONT_NUM, FONT_UI,
  GOLD_BASE, GOLD_LIGHT, HOT_COLOR, HOT_LIGHT, HOT_PALE, RADIUS_SM, SHADOW_SM,
  TEXT_MUTED, TEXT_PRIMARY, WIN_BASE, WIN_PALE,
} from '../../../ui';
import { UPCOMING_KEYFRAMES } from './matchStatusStyle';

// トーナメント表の1枠 (1試合の片側 = 1人) のカード。中央収束レイアウト (BracketView) 専用。
//
// 名前と得点だけを持つ — 試合ラベル・状態バッジ・裁定注記は対になる2枚の間に挟む
// MatchInfoCard の役目 (「対戦」1つに対する情報を、対戦者ごとに重複して出さないため)。
//
// 「対戦相手をまとめた1枚」だった旧デザインの MatchCard とは別物 — こちらは山の絵として
// 見せるための「1人1カード」表現。運営パネルの「今やること」のような、対戦を1枚で
// 見せたい場面は今まで通り MatchCard を使う (NextActionCard / ProgressTab)。

export const PLAYER_CARD_W = 224;

const CARD_PAD_V  = 7;
const ROW_LINE_H  = 22;

export const PLAYER_CARD_H = CARD_PAD_V * 2 + ROW_LINE_H;

export interface PlayerCardProps {
  match:        TournamentMatch;
  /** 0 = 第1ゲームの COOL (先攻) / 1 = HOT (後攻) */
  side:         0 | 1;
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

export function PlayerCard({
  match, side, participants, format, interactive = false, selected = false, upcoming = false,
  justFinished = false, onSelect, style,
}: PlayerCardProps) {
  const resolvedId = side === 0 ? match.resolvedA : match.resolvedB;
  const isBye      = side === 0 ? match.byeA : match.byeB;
  const slotRef: MatchSlotRef = side === 0 ? match.slotA : match.slotB;

  // まだ相手が決まっていない枠でも、決まり方が分かるなら書く (「Aリーグ 1位」)。
  // 予選の結果待ちの準決勝が「—」だけだと、観客にも運営にも何を待っているのか伝わらない
  const nameOf = (): string => {
    if (isBye) return '不戦';
    if (!resolvedId) return slotPlaceholder(slotRef, format) ?? '—';
    const p = participants.find(x => x.id === resolvedId);
    if (!p) return resolvedId;
    // 運営BOT は参加者ではないので、名前だけだとエントリーの1人に見える
    return p.isBot ? `🤖 ${p.name}` : p.name;
  };

  const winner  = match.result?.winnerSide ?? null;
  const won     = winner === side;
  const pending = !resolvedId && !isBye;
  const points  = match.result?.set?.totals[side] ?? null;

  // 不戦の扱い。参加人数の都合で片側/両側が不在の枠が生じるが、実際の対戦ではないので
  // 表に出さない。片側だけ不在でも「誰が勝ち上がったか」は次の回戦のカードが解決済みの
  // 名前で示すので、この枠自体は表の形を保つためだけの空き枠として完全に隠してよい
  const hasBye = match.byeA || match.byeB;

  const clickable = interactive && !!onSelect && !hasBye;
  const rematch = !!match.rematchPending;

  return (
    <div
      style={{
        // upcoming/justFinished/rematch は同じ試合に同時には付かない (確定した瞬間に
        // upcoming は外れ、rematchPending は同点の結果を discardResult で捨てたときだけ
        // 立つが、その時点で result も一緒に消えるので justFinished の元になる
        // confirmedAt も無くなる) ので、この3つの間で上書き順は問題にならない。
        // won (勝者強調) だけは justFinished と共存しうるが、cardJustFinished が
        // border/background に触れないよう作ってあるので cardWon の緑と衝突しない
        ...card,
        height: PLAYER_CARD_H,
        ...(side === 0 ? cardCool : cardHot),
        ...(won ? cardWon : null),
        ...(rematch ? cardRematch : null),
        ...(justFinished ? cardJustFinished : null),
        ...(upcoming ? cardUpcoming : null),
        ...(selected ? cardSelected : null),
        ...(clickable ? cardClickable : null),
        ...(hasBye ? cardHidden : null),
        ...style,
      }}
      onClick={clickable ? () => onSelect!(match.id) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={match.label}
    >
      {upcoming && <style>{UPCOMING_KEYFRAMES}</style>}
      <span style={{ ...name, ...(won ? nameWon : null), ...(pending ? namePending : null) }}>
        {nameOf()}
      </span>
      <span style={pointsStyle}>{points ?? '—'}</span>
    </div>
  );
}

const card: React.CSSProperties = {
  width: PLAYER_CARD_W, boxSizing: 'border-box', overflow: 'hidden',
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_SM, boxShadow: SHADOW_SM,
  padding: `${CARD_PAD_V}px 8px`, fontFamily: FONT_UI,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  borderLeft: '3px solid transparent',
};

// side ごとの色味。左端の帯だけだと、観戦画面のように FitArea で大きく縮小される
// 場面で細い線がつぶれて COOL/HOT が同系色に見えてしまう (運営パネルは縮小率が
// 低く保たれるため気づきにくい)。線が消えても分かるよう、淡い背景も面で塗って
// おく (名前の可読性を保つため、はっきり色を付けるのではなく淡い色にとどめる)
const cardCool: React.CSSProperties = { borderLeftColor: COOL_COLOR, background: COOL_PALE };
const cardHot:  React.CSSProperties = { borderLeftColor: HOT_COLOR, background: HOT_PALE };

// 勝った方のカード。アイコンを付けずに枠と背景だけで一目で分かるようにする。
// 「決着した勝ち上がり接続線」(BracketView) と同じ WIN 色にして、線の先に勝者がいる
// ことが視覚的に繋がって見えるようにする。COOL/HOT の帯色より優先して上書きする
// (対戦の勝ち負けの方が、その試合の先攻/後攻より読み取りたい情報として重要なため)
const cardWon: React.CSSProperties = {
  border: `2px solid ${WIN_BASE}`,
  borderLeft: `4px solid ${WIN_BASE}`,
  background: WIN_PALE,
};

const cardClickable: React.CSSProperties = { cursor: 'pointer' };

const cardSelected: React.CSSProperties = {
  outline: `2px solid ${COOL_COLOR}`, outlineOffset: 1,
};

// これから行う試合。観客席から一目で分かるよう、枠を金色にして脈打たせる。
// アニメーション本体 (UPCOMING_KEYFRAMES) は matchStatusStyle.ts で共有する。
const cardUpcoming: React.CSSProperties = {
  border: `1px solid ${GOLD_BASE}`,
  borderLeft: `3px solid ${GOLD_BASE}`,
  background: GOLD_LIGHT,
  animation: 'u15-upcoming 1.6s ease-in-out infinite',
};

// たった今確定した試合。勝者・敗者の両方のカードに付く (「この対戦が直近に終わった」
// という試合単位の情報のため)。勝者はすでに cardWon の緑を持っているので、ここで
// 枠や背景まで緑にすると敗者のカードも「勝った」ように見えてしまう
// (実際にこの見え方のバグが起きた — 決勝で両者とも勝者色に見えた)。
// 枠・背景は一切変えず、勝敗と紛れない金色 (upcoming と同系統だが脈動しない静的なリング)
// だけを足して「この試合が直近に終わった」ことだけを示す
const cardJustFinished: React.CSSProperties = {
  boxShadow: `0 0 0 3px ${GOLD_LIGHT}, ${SHADOW_SM}`,
};

// 同点で再試合待ちの試合。運営の判断が要ることを枠でも伝える (バッジと同じ HOT 色)
const cardRematch: React.CSSProperties = {
  border: `1px solid ${HOT_COLOR}`,
  borderLeft: `3px solid ${HOT_COLOR}`,
  background: HOT_PALE,
  boxShadow: `0 0 0 2px ${HOT_LIGHT}, ${SHADOW_SM}`,
};

// 不戦の枠 (片側だけ不在 / 両側とも不在)。参加人数の都合で生じる、表の形を保つためだけの
// 空き枠なので完全に隠す。誰が勝ち上がったかは次の回戦のカードが解決済みの名前で示す。
// position (centeredBracketLayout の計算結果) は style プロップ経由でこの後に上書きされる
// ので、レイアウトの並びは崩れない
const cardHidden: React.CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
};

const name: React.CSSProperties = {
  fontSize: 15, lineHeight: `${ROW_LINE_H}px`, color: TEXT_PRIMARY, minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const nameWon: React.CSSProperties = { fontWeight: 700 };

// 「Aリーグ 1位」のような予定枠。確定した名前と見分けがつくよう控えめに出す
const namePending: React.CSSProperties = { color: TEXT_MUTED, fontStyle: 'italic' };

const pointsStyle: React.CSSProperties = {
  fontSize: 15, lineHeight: `${ROW_LINE_H}px`, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
  flexShrink: 0,
};
