import { calculateBonusBreakdown } from '@u15/ws-types';
import type { RoundResult } from '@u15/ws-types';
import type { GameStatus } from './types.js';

/**
 * 1ゲームの結果から RoundResult (フロントエンドと大会運営が読む形) を組み立てる。
 * ボーナスの計算そのものは競技ルールなので ws-types の calculateBonusBreakdown が持つ。
 */
export function buildRoundResult(
  round:          0 | 1,
  status:         GameStatus,
  scores:         [number, number],
  remainingTurns: number,
  leaveItems:     number,
  playerNames:    [string, string],
): RoundResult {
  const { strikeBonus, sweepBonus } = calculateBonusBreakdown(
    status.winner, status.reason, scores, leaveItems,
  );
  return {
    round,
    winner: status.winner,
    reason: status.reason,
    scores,
    remainingTurns,
    strikeBonus,
    sweepBonus,
    playerNames,
  };
}
