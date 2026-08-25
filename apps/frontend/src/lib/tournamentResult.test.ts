import { describe, expect, it } from 'vitest';
import { stageRulesFor } from '../test/tournamentFixture';
import type {
  TournamentFormat,
  ResolvedParticipant, StandingRow, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import { isTournamentComplete, lastConfirmedMatch, podiumOf, winnerNameOf } from './tournamentResult';

// 表彰台はトーナメントとリーグで導き方が別なので、両方を通す。

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function done(winnerSide: 0 | 1 | null, confirmedAt = 2): TournamentMatch['result'] {
  return {
    roundResults: [], set: null, decidedBy: 'points', winnerSide,
    capturedAt: 1, confirmedAt,
  };
}

function match(
  id: string, stage: number, a: string | null, b: string | null,
  extra: Partial<TournamentMatch> = {},
): TournamentMatch {
  return {
    id, stage, order: 0, label: id,
    slotA: a ? { kind: 'participant', participantId: a } : { kind: 'bye' },
    slotB: b ? { kind: 'participant', participantId: b } : { kind: 'bye' },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'done',
    ...extra,
  };
}

/** 3位決定戦。決勝と同じ stage に置き、準決勝の敗者を参照する */
function thirdPlace(stage: number, a: string, b: string, winnerSide: 0 | 1): TournamentMatch {
  return {
    ...match('THIRD', stage, a, b, { order: 1, result: done(winnerSide) }),
    slotA: { kind: 'loser-of', matchId: 'SF1' },
    slotB: { kind: 'loser-of', matchId: 'SF2' },
  };
}

function state(
  format: TournamentFormat,
  matches: TournamentMatch[],
  standings: StandingRow[] | null = null,
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯',
    match: { doubleMode: false },
    stage: stageRulesFor(format),
    participants, matches, standings, groups: null, qualifiers: null, qualifierCandidates: null, stageMaps: [], stageLabels: [],
    qualifiersConfirmed: false,
    displayView: 'auto', autoPlay: { enabled: false, loop: false, stoppedReason: null },
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

function standing(participantId: string, rank: number, tied = false): StandingRow {
  return {
    participantId, played: 3, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, itemPoints: 0, strikePoints: 0, sweepPoints: 0, rank, tied,
  };
}

/** 準決勝2つ + 決勝。決勝は p1 (side 0) の勝ち */
const semisAndFinal: TournamentMatch[] = [
  match('SF1', 0, 'p1', 'p2', { result: done(0) }),
  match('SF2', 0, 'p3', 'p4', { result: done(0) }),
  match('FINAL', 1, 'p1', 'p3', { result: done(0) }),
];

describe('isTournamentComplete', () => {
  it('全ての試合が確定していれば true', () => {
    expect(isTournamentComplete(state('single-elimination', semisAndFinal))).toBe(true);
  });

  it('最後の試合が確定待ちなら false (確定を押した瞬間に切り替わる)', () => {
    const matches = semisAndFinal.map(m =>
      m.id === 'FINAL' ? { ...m, status: 'awaiting_confirm' as const } : m);
    expect(isTournamentComplete(state('single-elimination', matches))).toBe(false);
  });

  it('大会を運営していなければ false', () => {
    expect(isTournamentComplete(null)).toBe(false);
  });

  it('試合が1つも無い大会は false', () => {
    expect(isTournamentComplete(state('single-elimination', []))).toBe(false);
  });
});

describe('lastConfirmedMatch', () => {
  it('確定した時刻がいちばん新しい試合を返す', () => {
    const matches = [
      match('SF1', 0, 'p1', 'p2', { result: done(0, 100) }),
      match('SF2', 0, 'p3', 'p4', { result: done(0, 300) }),
      match('FINAL', 1, 'p1', 'p3', { status: 'ready', resolvedA: 'p1', resolvedB: 'p3' }),
    ];
    expect(lastConfirmedMatch(state('single-elimination', matches))?.id).toBe('SF2');
  });

  it('まだ1つも確定していなければ null', () => {
    const matches = [match('SF1', 0, 'p1', 'p2', { status: 'ready' })];
    expect(lastConfirmedMatch(state('single-elimination', matches))).toBeNull();
  });

  it('不戦勝 (bye) は「終わった試合」に数えない', () => {
    const matches = [
      match('R1M1', 0, 'p1', null, { byeB: true, result: done(0, 500) }),
      match('R1M2', 0, 'p3', 'p4', { result: done(0, 100) }),
    ];
    expect(lastConfirmedMatch(state('single-elimination', matches))?.id).toBe('R1M2');
  });

  it('大会を運営していなければ null', () => {
    expect(lastConfirmedMatch(null)).toBeNull();
  });

  // 再試合は必ず「確定した試合」よりあとの出来事なので、confirmedAt がどれだけ新しくても
  // もう「たった今終わったもの」ではない。強調表示を出しっぱなしにすると、観客席に
  // 「古い試合が終わった」と「今の試合は再試合待ち」が同時に出て紛らわしくなる
  it('同点で再試合待ちの試合があれば null (古い確定試合の強調をやめる)', () => {
    const matches = [
      match('SF1', 0, 'p1', 'p2', { result: done(0, 100) }),
      match('SF2', 0, 'p3', 'p4', { status: 'ready', resolvedA: 'p3', resolvedB: 'p4', rematchPending: true }),
    ];
    expect(lastConfirmedMatch(state('single-elimination', matches))).toBeNull();
  });
});

describe('winnerNameOf', () => {
  it('勝った側の名前を返す', () => {
    const m = match('SF1', 0, 'p1', 'p2', { result: done(1) });
    expect(winnerNameOf(state('single-elimination', [m]), m)).toBe('B');
  });

  it('決着なし (両者棄権) なら null', () => {
    const m = match('SF1', 0, 'p1', 'p2', { result: done(null) });
    expect(winnerNameOf(state('single-elimination', [m]), m)).toBeNull();
  });
});

describe('podiumOf (トーナメント)', () => {
  it('決勝の勝者が優勝・敗者が準優勝', () => {
    expect(podiumOf(state('single-elimination', semisAndFinal))).toEqual([
      { rank: 1, label: '優勝',   names: ['A'] },
      { rank: 2, label: '準優勝', names: ['C'] },
    ]);
  });

  it('3位決定戦があればその勝者が第3位', () => {
    const matches = [...semisAndFinal, thirdPlace(1, 'p2', 'p4', 1)];
    expect(podiumOf(state('single-elimination', matches))).toEqual([
      { rank: 1, label: '優勝',   names: ['A'] },
      { rank: 2, label: '準優勝', names: ['C'] },
      { rank: 3, label: '第3位',  names: ['D'] },
    ]);
  });

  it('決勝が両者棄権なら表彰台は空になる', () => {
    const matches = semisAndFinal.map(m =>
      m.id === 'FINAL' ? { ...m, result: done(null) } : m);
    expect(podiumOf(state('single-elimination', matches))).toEqual([]);
  });

  it('決勝が不戦勝 (相手が bye) でも優勝だけは出る', () => {
    const matches = [match('FINAL', 0, 'p1', null, { byeB: true, result: done(0) })];
    expect(podiumOf(state('single-elimination', matches))).toEqual([
      { rank: 1, label: '優勝', names: ['A'] },
    ]);
  });
});

describe('podiumOf (リーグ)', () => {
  it('順位表の上位3位を出す', () => {
    const standings = [standing('p2', 1), standing('p1', 2), standing('p3', 3), standing('p4', 4)];
    expect(podiumOf(state('league', [], standings))).toEqual([
      { rank: 1, label: '優勝',   names: ['B'] },
      { rank: 2, label: '準優勝', names: ['A'] },
      { rank: 3, label: '第3位',  names: ['C'] },
    ]);
  });

  it('1位が同着なら連名になり、飛んだ2位は出さない', () => {
    const standings = [
      standing('p1', 1, true), standing('p2', 1, true), standing('p3', 3), standing('p4', 4),
    ];
    expect(podiumOf(state('league', [], standings))).toEqual([
      { rank: 1, label: '優勝',  names: ['A', 'B'] },
      { rank: 3, label: '第3位', names: ['C'] },
    ]);
  });
});
