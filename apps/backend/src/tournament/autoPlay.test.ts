import { describe, expect, it } from 'vitest';
import type {
  ClientStatusPayload, RoundResult, ServerStatusPayload, TournamentMatch,
} from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { DEFAULT_AUTO_PLAY_DELAYS_MS, delayFor, nextAutoPlayAction } from './autoPlay.js';
import type { AutoPlayInput } from './autoPlay.js';

function client(state: ClientStatusPayload['state']): ClientStatusPayload {
  return { type: 'cpu', state, name: 'CPU', ip: '127.0.0.1', port: 2009 };
}

/** 1ゲームぶんの結果 (中身は自動進行の判断に使われないので最小限) */
function round(n: 0 | 1): RoundResult {
  return {
    round: n, winner: Winner.COOL, reason: Reason.SCORE, scores: [0, 0],
    remainingTurns: 0, strikeBonus: [0, 0], sweepBonus: [0, 0], playerNames: ['A', 'B'],
  };
}

function status(over: Partial<ServerStatusPayload> = {}): ServerStatusPayload {
  return {
    phase:        'setup',
    localIP:      '127.0.0.1',
    clients:      [client('ready'), client('ready')],
    doubleMode:   false,
    repeatMode:   false,
    demoMode:     false,
    currentRound: 0,
    roundResults: [],
    darkMode:     false,
    mapSource:    { kind: 'random' },
    ...over,
  };
}

function match(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'SF1', stage: 0, label: '準決勝', order: 0,
    slotA: { kind: 'participant', participantId: 'p1' },
    slotB: { kind: 'participant', participantId: 'p2' },
    resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
    status: 'ready',
    ...over,
  };
}

function input(over: Partial<AutoPlayInput> = {}): AutoPlayInput {
  return {
    matches:             [match()],
    armedMatchId:        null,
    format:              'single-elimination',
    qualifiersConfirmed: false,
    groupStageDone:      false,
    status:              status(),
    loop:                false,
    ...over,
  };
}

describe('nextAutoPlayAction', () => {
  it('実施できる試合があれば準備する (実施順は compareByPlayOrder)', () => {
    const ms = [
      match({ id: 'FINAL', stage: 1, order: 0 }),
      match({ id: 'THIRD', stage: 1, order: 1, slotA: { kind: 'loser-of', matchId: 'SF1' } }),
      match({ id: 'SF1' }),
    ];
    // 3位決定戦は決勝より先だが、その前に stage0 の準決勝が来る
    expect(nextAutoPlayAction(input({ matches: ms }))).toEqual({ kind: 'arm', matchId: 'SF1' });
  });

  it('準備済みで両者接続済みなら開始する', () => {
    const ms = [match({ status: 'armed' })];
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1' })))
      .toEqual({ kind: 'start' });
  });

  it('接続待ちの間は何もしない', () => {
    const ms = [match({ status: 'armed' })];
    const st = status({ clients: [client('ready'), client('waiting')] });
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1', status: st }))).toBeNull();
  });

  it('対戦中は何もしない', () => {
    const ms = [match({ status: 'in_progress' })];
    const st = status({ phase: 'playing' });
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1', status: st }))).toBeNull();
  });

  it('2ゲーム制の第1ゲームが終わったら第2ゲームへ', () => {
    const ms = [match({ status: 'in_progress' })];
    const st = status({
      phase: 'finished', doubleMode: true, currentRound: 1, roundResults: [round(0)],
    });
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1', status: st })))
      .toEqual({ kind: 'next-round' });
  });

  it('全ゲーム終了直後は待つ (結果の取り込みを待ってから確定する)', () => {
    const ms = [match({ status: 'in_progress' })];
    const st = status({
      phase: 'finished', doubleMode: true, currentRound: 1, roundResults: [round(0), round(1)],
    });
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1', status: st }))).toBeNull();
  });

  it('第2ゲームの再接続が済んだら、そのまま開始する', () => {
    // requestNextRound の後は phase が setup に戻る (roundResults は残っている)
    const ms = [match({ status: 'in_progress' })];
    const st = status({ doubleMode: true, currentRound: 1, roundResults: [round(0)] });
    expect(nextAutoPlayAction(input({ matches: ms, armedMatchId: 'SF1', status: st })))
      .toEqual({ kind: 'start' });
  });

  it('確定待ちがあれば、次の試合の準備より先に確定する', () => {
    const ms = [
      match({ id: 'SF1', status: 'awaiting_confirm', result: result(0) }),
      match({ id: 'SF2' }),
    ];
    expect(nextAutoPlayAction(input({ matches: ms })))
      .toEqual({ kind: 'confirm', matchId: 'SF1' });
  });

  it('勝ち上がりの同点では止まる (再試合か裁定かは運営が決める)', () => {
    const ms = [match({ status: 'awaiting_confirm', result: result(null) })];
    const action = nextAutoPlayAction(input({ matches: ms }));
    expect(action?.kind).toBe('pause');
    expect(action).toMatchObject({ reason: expect.stringContaining('同点') });
  });

  it('リーグの引き分けはそのまま確定する', () => {
    const ms = [match({ id: 'L-D1M1', status: 'awaiting_confirm', result: result(null) })];
    expect(nextAutoPlayAction(input({ matches: ms, format: 'league' })))
      .toEqual({ kind: 'confirm', matchId: 'L-D1M1' });
  });

  it('予選リーグの引き分けもそのまま確定する (同じ大会でも決勝は止まる)', () => {
    const draw = match({ id: 'G1-D1M1', group: 0, status: 'awaiting_confirm', result: result(null) });
    expect(nextAutoPlayAction(input({ matches: [draw], format: 'group-then-bracket' })))
      .toEqual({ kind: 'confirm', matchId: 'G1-D1M1' });
  });

  it('予選が終わったら決勝進出者を確定する (決勝の試合を準備するより先)', () => {
    const ms = [
      match({ id: 'G1-D1M1', group: 0, status: 'done', result: result(0) }),
      match({ id: 'SF1' }),
    ];
    expect(nextAutoPlayAction(input({
      matches: ms, format: 'group-then-bracket', groupStageDone: true,
    }))).toEqual({ kind: 'confirm-qualifiers' });
  });

  it('確定済みなら決勝トーナメントの試合を準備する', () => {
    const ms = [
      match({ id: 'G1-D1M1', group: 0, status: 'done', result: result(0) }),
      match({ id: 'SF1' }),
    ];
    expect(nextAutoPlayAction(input({
      matches: ms, format: 'group-then-bracket', groupStageDone: true, qualifiersConfirmed: true,
    }))).toEqual({ kind: 'arm', matchId: 'SF1' });
  });

  it('全試合が終わったら、繰り返さないなら終了・繰り返すなら最初から', () => {
    const ms = [match({ status: 'done', result: result(0) })];
    expect(nextAutoPlayAction(input({ matches: ms }))).toEqual({ kind: 'finish' });
    expect(nextAutoPlayAction(input({ matches: ms, loop: true }))).toEqual({ kind: 'restart' });
  });

  it('実施できる試合が無いだけなら何もしない (運営の巻き戻し待ち)', () => {
    const ms = [match({ status: 'pending' })];
    expect(nextAutoPlayAction(input({ matches: ms }))).toBeNull();
  });
});

describe('delayFor', () => {
  it('進行を止める操作だけは待たない', () => {
    expect(delayFor('finish', DEFAULT_AUTO_PLAY_DELAYS_MS)).toBe(0);
    expect(delayFor('pause',  DEFAULT_AUTO_PLAY_DELAYS_MS)).toBe(0);
  });

  it('画面が切り替わる操作には視認のための間がある', () => {
    for (const kind of ['arm', 'start', 'next-round', 'confirm', 'confirm-qualifiers', 'restart'] as const) {
      expect(delayFor(kind, DEFAULT_AUTO_PLAY_DELAYS_MS)).toBeGreaterThanOrEqual(3_000);
    }
  });
});

function result(winnerSide: 0 | 1 | null): TournamentMatch['result'] {
  return {
    roundResults: [], set: null, decidedBy: 'points', winnerSide, capturedAt: 0,
  };
}
