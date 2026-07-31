import type { RoundResult } from '@u15/ws-types';
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

export interface SetResult {
  /** side 0 / side 1 それぞれの、完了した全ラウンドの合計ポイント */
  totals: [number, number];
  /** 合計ポイントで上回っている画面側。同点なら null */
  winnerSide: 0 | 1 | null;
}

/**
 * 完了したラウンド結果から、セット全体の合計ポイントと勝者を求める。
 *
 * フッターの最終勝者宣言 (MainWindow) とサイドパネルの TOTAL 欄 (PlayerSidePanel) が
 * 別々に計算して食い違わないよう、両者はこの関数を共有する。
 */
export function computeSetResult(roundResults: RoundResult[]): SetResult {
  const totals: [number, number] = [0, 0];
  for (const rr of roundResults) {
    totals[0] += roundPointsFor(rr, 0);
    totals[1] += roundPointsFor(rr, 1);
  }
  const winnerSide = totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1;
  return { totals, winnerSide };
}
