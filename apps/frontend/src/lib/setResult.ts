import type { RoundResult } from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { idxForSide } from './roundSide';

// 「セット」= 対戦全体 (1試合制なら1試合、2試合制なら先後を入れ替えた2試合)。
//
// 集計の単位は team-index (COOL/HOT) ではなく画面側 (side) であることに注意。2試合制では
// 1試合ごとに先攻/後攻が入れ替わるため、同じプログラムを追いかけるには round ごとに
// idxForSide で team-index を引き直す必要がある。

/** 1ラウンド分の合計ポイント: 獲得アイテム数×10 + 一撃ボーナス + 総取りボーナス */
export function roundPointsFor(rr: RoundResult, side: 0 | 1): number {
  const idx = idxForSide(side, rr.round);
  return rr.scores[idx] * 10 + rr.strikeBonus[idx] + rr.sweepBonus[idx];
}

/** そのラウンドを画面側 (side) のプログラムが勝ったか */
export function roundWonBy(rr: RoundResult, side: 0 | 1): boolean {
  const idx = idxForSide(side, rr.round);
  return rr.winner === (idx === 0 ? Winner.COOL : Winner.HOT);
}

export interface SetResult {
  /** side 0 / side 1 それぞれの、完了した全ラウンドの合計ポイント */
  totals: [number, number];
  /** side 0 / side 1 それぞれの勝利数 (引き分けはどちらにも加算しない) */
  wins: [number, number];
  /** 引き分けたラウンド数 */
  draws: number;
  /** セット全体の勝者となる画面側。決まらなければ null */
  winnerSide: 0 | 1 | null;
  /** 勝者が何で決まったか (勝利数 / 合計ポイント)。決まらなければ null */
  decidedBy: 'wins' | 'points' | null;
}

/**
 * 完了したラウンド結果から、セット全体の成績と勝者を求める。
 *
 * 競技ルール: 勝利数が多い方を勝者とし、勝利数が同じ場合は2ゲームの合計ポイントで決める。
 *
 * セット勝者を示す表示 (サイドパネルの TOTAL 欄の 🏆 など) が別々に計算して食い違わないよう、
 * 判定はこの関数に一本化する。
 */
export function computeSetResult(roundResults: RoundResult[]): SetResult {
  const totals: [number, number] = [0, 0];
  const wins:   [number, number] = [0, 0];
  let draws = 0;

  for (const rr of roundResults) {
    totals[0] += roundPointsFor(rr, 0);
    totals[1] += roundPointsFor(rr, 1);
    if (rr.winner === Winner.DRAW) {
      draws++;
    } else if (roundWonBy(rr, 0)) {
      wins[0]++;
    } else if (roundWonBy(rr, 1)) {
      wins[1]++;
    }
  }

  // ① 勝利数 → ② 合計ポイント の順に判定する
  let winnerSide: 0 | 1 | null = null;
  let decidedBy: 'wins' | 'points' | null = null;
  if (wins[0] !== wins[1]) {
    winnerSide = wins[0] > wins[1] ? 0 : 1;
    decidedBy  = 'wins';
  } else if (totals[0] !== totals[1]) {
    winnerSide = totals[0] > totals[1] ? 0 : 1;
    decidedBy  = 'points';
  }

  return { totals, wins, draws, winnerSide, decidedBy };
}
