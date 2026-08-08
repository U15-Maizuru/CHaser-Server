import { describe, it, expect } from 'vitest';
import type {
  LeaguePoints, RoundResult, TournamentMatch, TournamentMatchResult,
} from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { computeStandings } from './standings.js';

const LP: LeaguePoints = { win: 3, draw: 1, loss: 0 };

function match(
  id: string, a: string, b: string,
  winnerSide: 0 | 1 | null, totals: [number, number],
): TournamentMatch {
  const result: TournamentMatchResult = {
    roundResults: [],
    set: { totals, wins: [0, 0], draws: 0, winnerSide, decidedBy: 'wins' },
    decidedBy: 'wins',
    winnerSide,
    capturedAt: 1,
    confirmedAt: 1,
  };
  return {
    id, stage: 0, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b,
    byeA: false, byeB: false,
    status: 'done',
    result,
  };
}

/** 未消化の試合 */
function pending(id: string, a: string, b: string): TournamentMatch {
  return {
    id, stage: 0, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b,
    byeA: false, byeB: false,
    status: 'ready',
  };
}

const rowOf = (rows: ReturnType<typeof computeStandings>, id: string) =>
  rows.find(r => r.participantId === id)!;

describe('computeStandings', () => {
  it('勝ち点は 勝利3 / 引き分け1 / 敗北0 で集計される', () => {
    const rows = computeStandings(['a', 'b', 'c'], [
      match('m1', 'a', 'b', 0, [100, 50]),   // a の勝ち
      match('m2', 'b', 'c', null, [40, 40]), // 引き分け
      match('m3', 'a', 'c', 1, [30, 90]),    // c の勝ち
    ], LP);

    expect(rowOf(rows, 'a')).toMatchObject({ played: 2, wins: 1, draws: 0, losses: 1, points: 3 });
    expect(rowOf(rows, 'b')).toMatchObject({ played: 2, wins: 0, draws: 1, losses: 1, points: 1 });
    expect(rowOf(rows, 'c')).toMatchObject({ played: 2, wins: 1, draws: 1, losses: 0, points: 4 });
  });

  it('合計ポイントは全試合の自分側の得点を足したもの', () => {
    const rows = computeStandings(['a', 'b'], [
      match('m1', 'a', 'b', 0, [100, 50]),
      match('m2', 'b', 'a', 0, [70, 20]),
    ], LP);
    expect(rowOf(rows, 'a').totalPoints).toBe(120); // 100 + 20
    expect(rowOf(rows, 'b').totalPoints).toBe(120); // 50 + 70
  });

  it('順位は ① 勝ち点 で決まる', () => {
    const rows = computeStandings(['a', 'b', 'c'], [
      match('m1', 'a', 'b', 0, [10, 10]),
      match('m2', 'a', 'c', 0, [10, 10]),
      match('m3', 'b', 'c', 0, [10, 10]),
    ], LP);
    expect(rows.map(r => r.participantId)).toEqual(['a', 'b', 'c']);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it('勝ち点が同じなら ② 全試合の合計ポイント で決まる', () => {
    // a と b はどちらも1勝1敗 (勝ち点3)。合計ポイントで b が上
    const rows = computeStandings(['a', 'b', 'c'], [
      match('m1', 'a', 'b', 0, [10, 10]),   // a 勝ち
      match('m2', 'b', 'c', 0, [200, 10]),  // b 勝ち
      match('m3', 'c', 'a', 0, [10, 10]),   // c 勝ち
    ], LP);
    expect(rowOf(rows, 'b').totalPoints).toBeGreaterThan(rowOf(rows, 'a').totalPoints);
    expect(rowOf(rows, 'b').rank).toBe(1);
    expect(rowOf(rows, 'b').tied).toBe(false);
  });

  it('勝ち点・合計ポイントが同じなら ③ 直接対決 で決まる', () => {
    // a も b も 1勝1敗 (勝ち点3)・合計100 で完全に同値。直接対決で b が勝っている
    const rows = computeStandings(['a', 'b', 'c', 'd'], [
      match('m1', 'a', 'b', 1, [50, 50]),  // 直接対決: b の勝ち
      match('m2', 'a', 'c', 0, [50, 10]),  // a の勝ち
      match('m3', 'b', 'd', 1, [50, 80]),  // d の勝ち
    ], LP);

    expect(rowOf(rows, 'a').points).toBe(3);
    expect(rowOf(rows, 'b').points).toBe(3);
    expect(rowOf(rows, 'a').totalPoints).toBe(100);
    expect(rowOf(rows, 'b').totalPoints).toBe(100);

    expect(rowOf(rows, 'b').rank).toBe(1);
    expect(rowOf(rows, 'a').rank).toBe(2);
    expect(rowOf(rows, 'b').tied).toBe(false);
    expect(rowOf(rows, 'a').tied).toBe(false);
  });

  it('直接対決でも並べば同順位 (tied) にする', () => {
    // a と b は同値で、直接対決も引き分け
    const rows = computeStandings(['a', 'b'], [
      match('m1', 'a', 'b', null, [50, 50]),
    ], LP);
    expect(rowOf(rows, 'a').rank).toBe(1);
    expect(rowOf(rows, 'b').rank).toBe(1);
    expect(rowOf(rows, 'a').tied).toBe(true);
    expect(rowOf(rows, 'b').tied).toBe(true);
  });

  it('同順位のあとは順位番号が飛ぶ', () => {
    const rows = computeStandings(['a', 'b', 'c'], [
      match('m1', 'a', 'b', null, [50, 50]),
      match('m2', 'a', 'c', 0, [50, 0]),
      match('m3', 'b', 'c', 0, [50, 0]),
    ], LP);
    expect(rowOf(rows, 'a').rank).toBe(1);
    expect(rowOf(rows, 'b').rank).toBe(1);
    expect(rowOf(rows, 'c').rank).toBe(3);
  });

  it('未消化の試合があっても壊れない', () => {
    const rows = computeStandings(['a', 'b', 'c'], [
      match('m1', 'a', 'b', 0, [100, 50]),
      pending('m2', 'b', 'c'),
      pending('m3', 'a', 'c'),
    ], LP);
    expect(rowOf(rows, 'a').played).toBe(1);
    expect(rowOf(rows, 'c').played).toBe(0);
    expect(rowOf(rows, 'c').points).toBe(0);
    expect(rows).toHaveLength(3);
  });

  it('1試合も終わっていなければ全員 0 で同順位', () => {
    const rows = computeStandings(['a', 'b'], [pending('m1', 'a', 'b')], LP);
    expect(rows.every(r => r.played === 0 && r.points === 0 && r.rank === 1)).toBe(true);
  });

  it('不戦勝 (相手が bye) は勝敗表に載せない', () => {
    const wo: TournamentMatch = {
      id: 'w1', stage: 0, order: 0, label: 'w1',
      slotA: { kind: 'participant', participantId: 'a' },
      slotB: { kind: 'bye' },
      resolvedA: 'a', resolvedB: null,
      byeA: false, byeB: true,
      status: 'done',
      result: {
        roundResults: [], set: null, decidedBy: 'walkover',
        winnerSide: 0, capturedAt: 1, confirmedAt: 1,
      },
    };
    const rows = computeStandings(['a', 'b'], [wo], LP);
    expect(rowOf(rows, 'a').played).toBe(0);
    expect(rowOf(rows, 'a').points).toBe(0);
  });

  it('勝ち点の配分は leaguePoints で変えられる', () => {
    const rows = computeStandings(['a', 'b'], [
      match('m1', 'a', 'b', 0, [10, 10]),
    ], { win: 2, draw: 1, loss: -1 });
    expect(rowOf(rows, 'a').points).toBe(2);
    expect(rowOf(rows, 'b').points).toBe(-1);
  });
});

// ── BOT対戦予選 (rankBy: 'total-points') ──
//
// 全員が同じ BOT としか戦わないので直接対決が存在せず、勝敗も「同じ基準器に勝てたか」
// でしかない。ポイントそのもので測り、同点は内訳 (一撃 → アイテム) で割る。

/** side 0 = 参加者、side 1 = BOT の1ゲーム分の結果 */
function round(
  items: number, strike: number, sweep: number,
): RoundResult {
  return {
    round: 0,
    winner: Winner.COOL,
    reason: Reason.SCORE,
    scores:      [items, 0],
    remainingTurns: 0,
    strikeBonus: [strike, 0],
    sweepBonus:  [sweep, 0],
    playerNames: ['p', 'bot'],
  };
}

/** 参加者 (side 0) が BOT (side 1) と戦った1試合 */
function botMatch(
  id: string, participant: string, winnerSide: 0 | 1 | null,
  breakdown: { items: number; strike: number; sweep: number },
): TournamentMatch {
  const rr = round(breakdown.items, breakdown.strike, breakdown.sweep);
  const total = breakdown.items * 10 + breakdown.strike + breakdown.sweep;
  return {
    id, stage: 0, order: 0, label: id, group: 0,
    slotA: { kind: 'participant', participantId: participant },
    slotB: { kind: 'participant', participantId: '__bot__' },
    resolvedA: participant, resolvedB: '__bot__',
    byeA: false, byeB: false,
    status: 'done',
    result: {
      roundResults: [rr],
      set: { totals: [total, 0], wins: [1, 0], draws: 0, winnerSide, decidedBy: 'wins' },
      decidedBy: 'wins',
      winnerSide,
      capturedAt: 1, confirmedAt: 1,
    },
  };
}

describe("computeStandings (rankBy: 'total-points')", () => {
  it('BOT への勝敗ではなく合計ポイントで並ぶ', () => {
    // b は BOT に負けたが、ポイントは a より高い
    const rows = computeStandings(['a', 'b'], [
      botMatch('m1', 'a', 0, { items: 12, strike: 0, sweep: 0 }),  // 120
      botMatch('m2', 'b', 1, { items: 14, strike: 0, sweep: 0 }),  // 140
    ], LP, 'total-points');

    expect(rows.map(r => r.participantId)).toEqual(['b', 'a']);
    expect(rowOf(rows, 'b').rank).toBe(1);
    expect(rowOf(rows, 'b').losses).toBe(1);
  });

  it('合計が同点なら一撃ボーナスが多いほうが上位', () => {
    const rows = computeStandings(['a', 'b'], [
      botMatch('m1', 'a', 0, { items: 10, strike:  0, sweep: 50 }), // 150
      botMatch('m2', 'b', 0, { items:  5, strike: 50, sweep: 50 }), // 150
    ], LP, 'total-points');

    expect(rows.map(r => r.participantId)).toEqual(['b', 'a']);
    expect(rows.every(r => r.tied)).toBe(false);
  });

  it('合計と一撃が同点ならアイテムポイントが多いほうが上位', () => {
    const rows = computeStandings(['a', 'b'], [
      botMatch('m1', 'a', 0, { items:  5, strike: 50, sweep: 50 }), // 150 / 一撃50 / アイテム50
      botMatch('m2', 'b', 0, { items: 10, strike: 50, sweep:  0 }), // 150 / 一撃50 / アイテム100
    ], LP, 'total-points');

    expect(rows.map(r => r.participantId)).toEqual(['b', 'a']);
  });

  it('合計・一撃・アイテムまで並んだら同着 (運営が決める)', () => {
    const rows = computeStandings(['a', 'b', 'c'], [
      botMatch('m1', 'a', 0, { items: 10, strike: 0, sweep: 0 }),  // 100
      botMatch('m2', 'b', 1, { items: 10, strike: 0, sweep: 0 }),  // 100
      botMatch('m3', 'c', 0, { items:  8, strike: 0, sweep: 0 }),  //  80
    ], LP, 'total-points');

    expect(rowOf(rows, 'a')).toMatchObject({ rank: 1, tied: true });
    expect(rowOf(rows, 'b')).toMatchObject({ rank: 1, tied: true });
    // 同着のぶんだけ順位が飛ぶ (league 側と同じ数え方)
    expect(rowOf(rows, 'c')).toMatchObject({ rank: 3, tied: false });
  });

  it('内訳は roundResults から積まれる (2ゲーム制なら両ゲームの合計)', () => {
    const m = botMatch('m1', 'a', 0, { items: 10, strike: 50, sweep: 6 });
    m.result!.roundResults.push({ ...round(3, 0, 12), round: 1 });

    const rows = computeStandings(['a'], [m], LP, 'total-points');
    // 第2ゲームは先後が入れ替わるので、参加者 (side 0) の team-index は 1 になる。
    // round(3,0,12) は index 0 に値を置いているので、side 0 から見た第2ゲームは全て0
    expect(rowOf(rows, 'a')).toMatchObject({
      itemPoints: 100, strikePoints: 50, sweepPoints: 6,
    });
  });
});
