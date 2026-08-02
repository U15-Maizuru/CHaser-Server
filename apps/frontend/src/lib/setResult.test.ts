import { describe, it, expect } from 'vitest';
import type { RoundResult } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { computeSetResult, roundPointsFor, roundWonBy } from './setResult';

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

describe('roundWonBy', () => {
  it('2試合目は先後が入れ替わるため、COOL の勝ちは side 1 の勝ちになる', () => {
    const round1 = makeRound(0, { winner: Winner.COOL });
    expect(roundWonBy(round1, 0)).toBe(true);
    expect(roundWonBy(round1, 1)).toBe(false);

    const round2 = makeRound(1, { winner: Winner.COOL });
    expect(roundWonBy(round2, 0)).toBe(false);
    expect(roundWonBy(round2, 1)).toBe(true);
  });

  it('引き分けはどちらの勝ちでもない', () => {
    const rr = makeRound(0, { winner: Winner.DRAW });
    expect(roundWonBy(rr, 0)).toBe(false);
    expect(roundWonBy(rr, 1)).toBe(false);
  });
});

describe('computeSetResult', () => {
  it('ラウンドが無ければ 0-0 の同点', () => {
    expect(computeSetResult([])).toEqual({
      totals: [0, 0], wins: [0, 0], draws: 0, winnerSide: null, decidedBy: null,
    });
  });

  it('1試合制 (1ラウンド) はその1勝がそのままセット結果になる', () => {
    const rr = makeRound(0, { winner: Winner.COOL, scores: [12, 9], sweepBonus: [21, 0] });
    expect(computeSetResult([rr])).toEqual({
      totals: [12 * 10 + 21, 9 * 10], wins: [1, 0], draws: 0, winnerSide: 0, decidedBy: 'wins',
    });
  });

  // 競技ルール: 勝利数が多い方が勝者。合計ポイントで下回っていても覆らない。
  it('2勝0敗なら、合計ポイントで下回っていても勝利数で勝者が決まる', () => {
    // side 0 が2試合とも勝つが、点差は小さく、負けた側が総取り無しで大量得点している
    const round1 = makeRound(0, { winner: Winner.COOL, scores: [3, 20] }); // side0: 30 / side1: 200
    const round2 = makeRound(1, { winner: Winner.HOT,  scores: [20, 3] }); // side0: 30 / side1: 200

    const { totals, wins, winnerSide, decidedBy } = computeSetResult([round1, round2]);
    expect(totals).toEqual([60, 400]);
    expect(wins).toEqual([2, 0]);
    expect(winnerSide).toBe(0);
    expect(decidedBy).toBe('wins');
  });

  // 「第2試合の勝者」と「セット全体の勝者」が食い違うケース。
  // フッターがラウンド勝者を宣言していた頃はここで表示が矛盾していた。
  it('1勝1敗なら合計ポイントで決まる — 第2試合を落としても第1試合の大差で side 0 が勝者', () => {
    const round1 = makeRound(0, {
      winner: Winner.COOL, reason: Reason.CONFINED,
      scores: [10, 8], sweepBonus: [30, 0], strikeBonus: [0, -24],
    });
    const round2 = makeRound(1, {
      winner: Winner.COOL, reason: Reason.SCORE,
      scores: [9, 8],  // 2試合目の COOL は side 1 のプログラム
    });

    const { totals, wins, winnerSide, decidedBy } = computeSetResult([round1, round2]);
    expect(totals).toEqual([130 + 80, 56 + 90]); // [210, 146]
    expect(wins).toEqual([1, 1]);                // 1勝1敗なので合計ポイント判定に落ちる
    expect(winnerSide).toBe(0);                  // 第2試合の勝者は side 1 だがセットは side 0
    expect(decidedBy).toBe('points');
  });

  it('勝利数も合計ポイントも並んだら winnerSide は null', () => {
    // side 0 が 100/50、side 1 が 50/100 → 1勝1敗かつ合計150で並ぶ
    const round1 = makeRound(0, { winner: Winner.COOL, scores: [10, 5] });
    const round2 = makeRound(1, { winner: Winner.COOL, scores: [10, 5] });
    expect(computeSetResult([round1, round2])).toEqual({
      totals: [150, 150], wins: [1, 1], draws: 0, winnerSide: null, decidedBy: null,
    });
  });

  it('引き分けたラウンドは勝利数に入らず draws に数える', () => {
    const round1 = makeRound(0, { winner: Winner.DRAW, scores: [5, 5] });
    const round2 = makeRound(1, { winner: Winner.COOL, scores: [7, 4] }); // COOL = side 1
    const { wins, draws, winnerSide, decidedBy } = computeSetResult([round1, round2]);
    expect(wins).toEqual([0, 1]);
    expect(draws).toBe(1);
    expect(winnerSide).toBe(1);
    expect(decidedBy).toBe('wins');
  });
});
