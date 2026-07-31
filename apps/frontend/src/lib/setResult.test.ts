import { describe, it, expect } from 'vitest';
import type { RoundResult } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { computeSetResult, roundPointsFor } from './setResult';

function makeRound(round: 0 | 1, over: Partial<RoundResult> = {}): RoundResult {
  return {
    round,
    winner:         Winner.COOL,
    reason:         Reason.SCORE,
    scores:         [0, 0],
    remainingTurns: 0,
    strikeBonus:    [0, 0],
    sweepBonus:     [0, 0],
    playerNames:    ['A', 'B'],
    ...over,
  };
}

describe('roundPointsFor', () => {
  it('1試合目は side がそのまま team-index になる', () => {
    const rr = makeRound(0, { scores: [10, 8], sweepBonus: [35, 0], strikeBonus: [0, -24] });
    expect(roundPointsFor(rr, 0)).toBe(10 * 10 + 35);   // 左 = COOL
    expect(roundPointsFor(rr, 1)).toBe(8 * 10 - 24);    // 右 = HOT
  });

  it('2試合目は先後が入れ替わるため team-index を反転して読む', () => {
    const rr = makeRound(1, { scores: [9, 8] });
    expect(roundPointsFor(rr, 0)).toBe(8 * 10);  // 左 = HOT
    expect(roundPointsFor(rr, 1)).toBe(9 * 10);  // 右 = COOL
  });
});

describe('computeSetResult', () => {
  it('ラウンドが無ければ 0-0 の同点', () => {
    expect(computeSetResult([])).toEqual({ totals: [0, 0], winnerSide: null });
  });

  it('1試合制 (1ラウンド) はそのラウンドの合計ポイントがそのままセット結果になる', () => {
    const rr = makeRound(0, { scores: [12, 9], sweepBonus: [21, 0] });
    expect(computeSetResult([rr])).toEqual({ totals: [12 * 10 + 21, 9 * 10], winnerSide: 0 });
  });

  // 「第2試合の勝者」と「セット全体の勝者」が食い違うケース。
  // フッターがラウンド勝者を宣言していた頃はここで表示が矛盾していた。
  it('第2試合を落としても、第1試合の大差で合計ポイントが上回れば side 0 が勝者', () => {
    const round1 = makeRound(0, {
      winner: Winner.COOL, reason: Reason.CONFINED,
      scores: [10, 8], sweepBonus: [35, 0], strikeBonus: [0, -24],
    });
    const round2 = makeRound(1, {
      winner: Winner.COOL, reason: Reason.SCORE,
      scores: [9, 8],  // 2試合目の COOL は side 1 のプログラム
    });

    const { totals, winnerSide } = computeSetResult([round1, round2]);
    expect(totals).toEqual([135 + 80, 56 + 90]); // [215, 146]
    expect(winnerSide).toBe(0);                  // 第2試合の勝者は side 1 だがセットは side 0
  });

  it('合計ポイントが並んだら winnerSide は null', () => {
    const round1 = makeRound(0, { scores: [10, 5] }); // side 0 が 100、side 1 が 50
    const round2 = makeRound(1, { scores: [10, 5] }); // 先後が入れ替わるので side 0 が 50、side 1 が 100
    expect(computeSetResult([round1, round2])).toEqual({ totals: [150, 150], winnerSide: null });
  });
});
