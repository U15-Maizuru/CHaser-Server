import { Reason } from './protocol.js';
import type { RoundResult } from './protocol.js';
import type { SetResult } from './scoring.js';
import { decideSetResult, idxForSide, isBlunder, roundWonBy } from './scoring.js';

// 交流大会ルールの得点・勝敗判定。舞鶴大会ルール (scoring.ts) とは完全に独立した数式で、
// アイテムポイント (×10) / 一撃ボーナス / 総取りボーナスの仕組みは使わない。
//
// 依存は ./protocol.js と ./scoring.js の素の集計ヘルパー (idxForSide/roundWonBy/isBlunder)
// のみ。scoring.ts 側からはこのファイルを import しない (呼び出し元が ruleSet を見て
// scoring.ts / koryuScoring.ts のどちらの関数を呼ぶか選ぶ)。

/** 予選 (BOT対戦) の得点式の係数。競技ルール: アイテム数×3 ± 残りターン数 */
export const BOT_ITEM_MULTIPLIER = 3;

/**
 * 予選 (BOT対戦) の1ゲーム分の得点。
 *
 * 競技ルール: 勝ちはアイテム数×3+残りターン数、負けはアイテム数×3−残りターン数。
 */
export function koryuBotRoundScore(rr: RoundResult, side: 0 | 1): number {
  const idx   = idxForSide(side, rr.round);
  const items = rr.scores[idx];
  return roundWonBy(rr, side)
    ? items * BOT_ITEM_MULTIPLIER + rr.remainingTurns
    : items * BOT_ITEM_MULTIPLIER - rr.remainingTurns;
}

/**
 * 決勝トーナメントの1ゲーム分の「獲得アイテム数」(引き分けのタイブレークに使う)。
 *
 * 競技ルール: 通常は獲得したアイテム数そのまま。ただし以下の反則で負けた場合は
 * 読み替える —
 *   相手にやられた (ATTACK=上にブロックを置かれる / TRAPPED=4方向を囲まれる): 0
 *   自滅 (COLLISION=ブロックへ移動 / CONFINED=自分で自分を囲む / FOULED=通信エラー):
 *     0−残りターン数
 */
export function koryuMatchRoundItems(rr: RoundResult, side: 0 | 1): number {
  const idx = idxForSide(side, rr.round);
  if (roundWonBy(rr, side) || rr.reason === Reason.SCORE) return rr.scores[idx];
  return isBlunder(rr.reason) ? -rr.remainingTurns : 0;
}

/**
 * 予選 (BOT対戦) の試合結果。totals は koryuBotRoundScore の合計で、
 * 順位表 (standings.ts) の並び替えにそのまま使う。
 */
export function computeKoryuBotSetResult(roundResults: RoundResult[]): SetResult {
  const totals: [number, number] = [0, 0];
  for (const rr of roundResults) {
    totals[0] += koryuBotRoundScore(rr, 0);
    totals[1] += koryuBotRoundScore(rr, 1);
  }
  return decideSetResult(totals, roundResults);
}

/**
 * 決勝トーナメントの試合結果。① 勝利数 → ② 獲得アイテム数の合計 (反則調整込み) の順で
 * 勝者を決める。それでも並べば winnerSide は null (= 真の同点。運営がマップを変えて
 * 再試合するか、審判裁定で勝者を指定する — matchCommands.ts の既存の仕組みがそのまま使える)。
 */
export function computeKoryuMatchSetResult(roundResults: RoundResult[]): SetResult {
  const totals: [number, number] = [0, 0];
  for (const rr of roundResults) {
    totals[0] += koryuMatchRoundItems(rr, 0);
    totals[1] += koryuMatchRoundItems(rr, 1);
  }
  return decideSetResult(totals, roundResults);
}
