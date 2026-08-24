import { describe, it, expect } from 'vitest';
import type { RoundResult } from './protocol.js';
import { Reason, Winner } from './protocol.js';
import {
  computeKoryuBotSetResult, computeKoryuMatchSetResult,
  koryuBotRoundScore, koryuMatchRoundItems,
} from './koryuScoring.js';

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

describe('koryuBotRoundScore', () => {
  it('勝ちはアイテム数×3+残りターン数', () => {
    const rr = makeRound(0, { winner: Winner.COOL, scores: [5, 2], remainingTurns: 12 });
    expect(koryuBotRoundScore(rr, 0)).toBe(5 * 3 + 12);
  });

  it('負けはアイテム数×3-残りターン数 (反則の種類を問わず一律)', () => {
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.FOULED, scores: [5, 2], remainingTurns: 12,
    });
    expect(koryuBotRoundScore(rr, 1)).toBe(2 * 3 - 12);
  });

  it('第2ゲームは先後入替により team-index が反転する', () => {
    const rr = makeRound(1, { winner: Winner.COOL, scores: [9, 8], remainingTurns: 3 });
    expect(koryuBotRoundScore(rr, 0)).toBe(8 * 3 - 3); // 左 = HOT (負け)
    expect(koryuBotRoundScore(rr, 1)).toBe(9 * 3 + 3); // 右 = COOL (勝ち)
  });
});

describe('koryuMatchRoundItems', () => {
  it('通常の決着 (SCORE) は両者ともアイテム数そのまま', () => {
    const rr = makeRound(0, { winner: Winner.COOL, reason: Reason.SCORE, scores: [7, 4] });
    expect(koryuMatchRoundItems(rr, 0)).toBe(7);
    expect(koryuMatchRoundItems(rr, 1)).toBe(4);
  });

  it('勝者は決着理由によらずアイテム数そのまま', () => {
    const rr = makeRound(0, { winner: Winner.COOL, reason: Reason.ATTACK, scores: [7, 4] });
    expect(koryuMatchRoundItems(rr, 0)).toBe(7);
  });

  it('ATTACK (相手に上へブロックを置かれる) で負けた側は獲得アイテム数0', () => {
    const rr = makeRound(0, { winner: Winner.COOL, reason: Reason.ATTACK, scores: [7, 4] });
    expect(koryuMatchRoundItems(rr, 1)).toBe(0);
  });

  it('TRAPPED (4方向を囲まれる) で負けた側も獲得アイテム数0', () => {
    const rr = makeRound(0, { winner: Winner.COOL, reason: Reason.TRAPPED, scores: [7, 4] });
    expect(koryuMatchRoundItems(rr, 1)).toBe(0);
  });

  it('COLLISION (ブロックへ自ら移動) で負けた側は 0-残りターン数', () => {
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.COLLISION, scores: [7, 4], remainingTurns: 15,
    });
    expect(koryuMatchRoundItems(rr, 1)).toBe(-15);
  });

  it('CONFINED (自分で自分を囲む) で負けた側は 0-残りターン数', () => {
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.CONFINED, scores: [7, 4], remainingTurns: 8,
    });
    expect(koryuMatchRoundItems(rr, 1)).toBe(-8);
  });

  it('FOULED (通信エラー) で負けた側も 0-残りターン数', () => {
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.FOULED, scores: [7, 4], remainingTurns: 20,
    });
    expect(koryuMatchRoundItems(rr, 1)).toBe(-20);
  });
});

describe('computeKoryuBotSetResult', () => {
  it('1ゲーム制の予選はその1ゲームの得点がそのまま試合結果になる', () => {
    const rr = makeRound(0, { winner: Winner.COOL, scores: [5, 2], remainingTurns: 12 });
    const result = computeKoryuBotSetResult([rr]);
    expect(result.totals).toEqual([5 * 3 + 12, 2 * 3 - 12]);
    expect(result.winnerSide).toBe(0);
    expect(result.decidedBy).toBe('wins');
  });
});

describe('computeKoryuMatchSetResult', () => {
  it('① 勝利数 → ② 獲得アイテム数合計の順でタイブレークする', () => {
    // 第2ゲームは先後入替のため、同じ COOL の勝ちでも「勝った画面側」が入れ替わる:
    // round1 は side0 (=COOL) が勝ち、round2 は side1 (=このゲームの COOL) が勝つ → 1勝1敗
    const round1 = makeRound(0, { winner: Winner.COOL, reason: Reason.SCORE, scores: [10, 8] });
    const round2 = makeRound(1, { winner: Winner.COOL, reason: Reason.SCORE, scores: [3, 9] });
    const result = computeKoryuMatchSetResult([round1, round2]);
    expect(result.wins).toEqual([1, 1]);
    // side0 = 10 (round1勝ち) + 9 (round2負けだがSCORE決着なので素のアイテム数) = 19
    // side1 = 8  (round1負けだがSCORE決着) + 3 (round2勝ち) = 11
    expect(result.totals).toEqual([19, 11]);
    expect(result.winnerSide).toBe(0);
    expect(result.decidedBy).toBe('points');
  });

  it('反則負けで獲得アイテム数が0/マイナスになり、2ゲーム合計で勝敗が決まる', () => {
    // 第1ゲーム: side0 が10個持って ATTACK 勝ち (side1は反則負けで0扱い)
    const round1 = makeRound(0, {
      winner: Winner.COOL, reason: Reason.ATTACK, scores: [10, 6],
    });
    // 第2ゲーム: side1 が COLLISION で自滅負け (残り20ターンをマイナス)、side0 が5個で勝ち
    const round2 = makeRound(1, {
      winner: Winner.COOL, reason: Reason.COLLISION, scores: [5, 3], remainingTurns: 20,
    });
    // round2 は先後入替: side0 = idxForSide(0,1) = 1 (HOT側)。COOL(idx0)が勝者なので
    // side0 は敗者 → COLLISION の自滅ペナルティ (-20) を受ける
    const result = computeKoryuMatchSetResult([round1, round2]);
    expect(result.wins).toEqual([1, 1]); // round1: side0勝ち / round2: side1(COOL)勝ち
    // side0 totals = 第1ゲーム勝ち(10) + 第2ゲーム自滅負け(-20) = -10
    // side1 totals = 第1ゲーム反則負け(0) + 第2ゲーム勝ち(5) = 5
    expect(result.totals).toEqual([-10, 5]);
    expect(result.winnerSide).toBe(1);
    expect(result.decidedBy).toBe('points');
  });

  it('引き分けたゲームは wins に入らず、両者0のときは真の同点 (winnerSide=null)', () => {
    const round1 = makeRound(0, { winner: Winner.DRAW, reason: Reason.SCORE, scores: [5, 5] });
    const round2 = makeRound(1, { winner: Winner.DRAW, reason: Reason.SCORE, scores: [5, 5] });
    const result = computeKoryuMatchSetResult([round1, round2]);
    expect(result.wins).toEqual([0, 0]);
    expect(result.draws).toBe(2);
    expect(result.totals).toEqual([10, 10]);
    expect(result.winnerSide).toBeNull();
    expect(result.decidedBy).toBeNull();
  });
});
