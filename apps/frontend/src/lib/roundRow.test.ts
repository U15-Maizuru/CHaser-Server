import { describe, it, expect } from 'vitest';
import type { GameStateSnapshot, RoundResult, ServerStatusPayload } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { computeRoundRow, roundOutcome } from './roundRow';

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

function makeStatus(over: Partial<ServerStatusPayload> = {}): ServerStatusPayload {
  return { phase: 'setup', currentRound: 0, ...over } as ServerStatusPayload;
}

function makeSnapshot(teamScore: [number, number]): GameStateSnapshot {
  return { teamScore } as GameStateSnapshot;
}

describe('roundOutcome', () => {
  it('引き分けは DRAW', () => {
    expect(roundOutcome(makeRound(0, { winner: Winner.DRAW }), 0)).toBe('DRAW');
  });

  it('第2ゲームは先後が入れ替わるため、COOL の勝ちは side 1 の WIN になる', () => {
    const rr = makeRound(1, { winner: Winner.COOL });
    expect(roundOutcome(rr, 0)).toBe('LOSE');
    expect(roundOutcome(rr, 1)).toBe('WIN');
  });
});

describe('computeRoundRow', () => {
  it('確定済みのゲームは finished になり、小計が合計ポイントと一致する', () => {
    const rr = makeRound(0, { scores: [10, 3], strikeBonus: [50, 0], sweepBonus: [12, 0] });
    const row = computeRoundRow(0, 0, [rr], makeStatus(), null);

    expect(row.status).toBe('finished');
    expect(row.label).toBe('COOL');
    expect(row.items).toBe(10);
    expect(row.subtotal).toBe(10 * 10 + 50 + 12);
    expect(row.outcome).toBe('WIN');
  });

  it('第2ゲームは team-index を反転して読む', () => {
    const rr = makeRound(1, { scores: [4, 9] });
    const row = computeRoundRow(0, 1, [rr], makeStatus(), null);

    expect(row.idx).toBe(1);      // 左 (side 0) は第2ゲームでは HOT
    expect(row.label).toBe('HOT');
    expect(row.items).toBe(9);
  });

  // 第1ゲーム終了直後は phase='finished' のまま currentRound だけ 1 に進む。
  // 対応する roundResults が無い限り進行中とみなさない (古いスナップショットの誤表示を防ぐ)。
  it('対戦中のゲームは live になり、アイテムだけスナップショットから読む', () => {
    const status = makeStatus({ phase: 'playing', currentRound: 0 });
    const row = computeRoundRow(0, 0, [], status, makeSnapshot([7, 2]));

    expect(row.status).toBe('live');
    expect(row.items).toBe(7);
    expect(row.subtotal).toBe(70);
    expect(row.outcome).toBeNull();
  });

  it('phase が playing でなければ、currentRound が一致していても pending のまま', () => {
    const status = makeStatus({ phase: 'finished', currentRound: 1 });
    const row = computeRoundRow(0, 1, [], status, makeSnapshot([7, 2]));

    expect(row.status).toBe('pending');
    expect(row.items).toBe(0);
    expect(row.subtotal).toBe(0);
  });
});
