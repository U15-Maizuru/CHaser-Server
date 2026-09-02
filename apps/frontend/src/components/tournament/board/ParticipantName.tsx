import type { CSSProperties, ReactNode } from 'react';
import type { ResolvedParticipant } from '@u15/ws-types';
import { TEXT_SECONDARY } from '../../../ui';

// 参加者の呼び名を出す1箇所。**所属があれば上に小さく1行足して2行で出す。**
//
// 所属 (学校名・チーム名) は任意で、重複してもよい。「誰か」を決めるのは名前のほうなので、
// 所属は常に上・小さく・弱い色で、名前の読み取りを邪魔しない位置に置く。
//
// **対戦画面 (MainWindow / MultiLaneDisplay) はこれを使わない。** あちらは盤面の主役が
// 2人しかおらず、その2人を取り違えようがないので名前だけでよい。所属まで出すと
// 盤面に使える面積が減る。名前の引き当ては armedMatchNames が別に持っている。

export interface ParticipantNameProps {
  name:         string;
  /** 所属。null / 空なら名前だけ */
  affiliation?: string | null;
  /**
   * 所属が無くても所属の行ぶんの高さを空ける。
   *
   * 高さを決め打ちするカード (トーナメント表の PlayerCard、試合カードの MatchCard) で、
   * 所属のある人と無い人が混ざっても名前のベースラインをそろえるために使う。
   * 行の高さが中身で決まる表では要らない。
   */
  reserve?:     boolean;
  /** 名前の直前に置くもの (勝者の 🏆 など)。所属の行ではなく名前の行に付く */
  prefix?:      ReactNode;
  style?:            CSSProperties;
  nameStyle?:        CSSProperties;
  affiliationStyle?: CSSProperties;
}

export function ParticipantName({
  name, affiliation, reserve = false, prefix, style, nameStyle, affiliationStyle,
}: ParticipantNameProps) {
  const aff = affiliation?.trim() ? affiliation.trim() : null;

  if (!aff && !reserve) {
    return <span style={{ ...oneLine, ...nameStyle, ...style }}>{prefix}{name}</span>;
  }

  return (
    <span style={{ ...stack, ...style }}>
      {/* 所属が無くても AFF_LINE_H ぶんの高さを占める (affiliationBase が height を持つ)。
          行高だけに頼ると中身が空のとき高さ0になり、名前のベースラインがずれる */}
      <span style={{ ...affiliationBase, ...affiliationStyle }}>{aff}</span>
      <span style={{ ...oneLine, ...nameStyle }}>{prefix}{name}</span>
    </span>
  );
}

/** 参加者一覧から所属を引く。BOT や未確定の枠 (id が引けない) では null */
export function affiliationOf(
  participants: ResolvedParticipant[], id: string | null | undefined,
): string | null {
  if (!id) return null;
  return participants.find(p => p.id === id)?.affiliation ?? null;
}

/**
 * 所属を持つ参加者が1人でもいるか。
 *
 * **高さを決め打ちするカード (PlayerCard / MatchCard) は、これが true なら所属の無い人にも
 * 行を空ける** (`reserve`)。人によってカードの高さが変わると、centeredBracketLayout へ渡す
 * cardH が1つに決まらず、対戦カードと接続線の行き先がずれる。
 */
export function hasAffiliation(participants: ResolvedParticipant[]): boolean {
  return participants.some(p => p.affiliation);
}

const stack: CSSProperties = {
  display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
};

const oneLine: CSSProperties = {
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/**
 * 所属の行の高さ。**高さを決め打ちするカード側 (playerCardHeight / matchCardHeight) が
 * この値を足して自分の高さを出す**ので、ここを唯一の出所にする。
 */
export const AFF_LINE_H = 13;

// 高さは中身ではなくここで決める。所属の無い人でも同じだけ場所を取るので、
// カード側の高さ計算 (playerCardHeight / matchCardHeight) と1対1で対応する
const affiliationBase: CSSProperties = {
  ...oneLine, height: AFF_LINE_H,
  fontSize: 10, lineHeight: `${AFF_LINE_H}px`, fontWeight: 600, color: TEXT_SECONDARY,
};
