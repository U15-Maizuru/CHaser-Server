import { describe, it, expect } from 'vitest';
import type { LeaguePoints, TournamentMatch, TournamentMatchResult } from '@u15/ws-types';
import { computeGroupStandings, computeQualifiers, resolveGroupRank } from './qualifiers.js';

const LP: LeaguePoints = { win: 3, draw: 1, loss: 0 };

function match(
  id: string, group: number, a: string, b: string,
  winnerSide: 0 | 1 | null, totals: [number, number], done = true,
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
    id, stage: 0, order: 0, label: id, group,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b,
    byeA: false, byeB: false,
    status: done ? 'done' : 'ready',
    ...(done ? { result } : {}),
  };
}

/** A リーグ3人。a > b > c が明確につく星取 */
const GROUPS_A = ['a1', 'a2', 'a3'];
const CLEAR_A = [
  match('GA1', 0, 'a1', 'a2', 0, [30, 10]),
  match('GA2', 0, 'a1', 'a3', 0, [30, 10]),
  match('GA3', 0, 'a2', 'a3', 0, [20, 10]),
];

const qualifiersOf = (
  groups: string[][], matches: TournamentMatch[], advance: number,
  overrides: Record<string, string | null> = {},
) => computeQualifiers(computeGroupStandings(groups, matches, LP), matches, advance, overrides);

describe('computeGroupStandings', () => {
  it('リーグごとに閉じて集計する (他リーグの試合を混ぜない)', () => {
    const matches = [
      ...CLEAR_A,
      match('GB1', 1, 'b1', 'b2', 0, [30, 10]),
    ];
    const groups = computeGroupStandings([GROUPS_A, ['b1', 'b2']], matches, LP);

    expect(groups[0]!.standings.map(s => s.participantId)).toEqual(['a1', 'a2', 'a3']);
    expect(groups[0]!.standings.every(s => s.played <= 2)).toBe(true);
    expect(groups[1]!.standings.map(s => s.participantId)).toEqual(['b1', 'b2']);
  });

  it('participantIds はエントリー順のまま (星取表の軸に使うため)', () => {
    const groups = computeGroupStandings([GROUPS_A], CLEAR_A, LP);
    expect(groups[0]!.participantIds).toEqual(GROUPS_A);
    expect(groups[0]!.label).toBe('A');
  });
});

describe('computeQualifiers', () => {
  it('予選が終わるまでは pending で誰も入らない', () => {
    const undecided = [match('GA1', 0, 'a1', 'a2', 0, [30, 10], false)];
    const slots = qualifiersOf([GROUPS_A], undecided, 2);

    expect(slots.map(s => s.pending)).toEqual([true, true]);
    expect(slots.map(s => s.participantId)).toEqual([null, null]);
  });

  it('決着がつけば順位どおりに埋まる', () => {
    const slots = qualifiersOf([GROUPS_A], CLEAR_A, 2);
    expect(slots.map(s => s.participantId)).toEqual(['a1', 'a2']);
    expect(slots.map(s => s.autoParticipantId)).toEqual(['a1', 'a2']);
    expect(slots.every(s => !s.tied && !s.ambiguous && !s.pending)).toBe(true);
  });

  it('上位内だけの同着は ambiguous にしない (どちらも上がるので決めることが無い)', () => {
    // a1 と a2 が完全に並び、a3 だけ沈む。上位2なら2人とも上がる
    const matches = [
      match('GA1', 0, 'a1', 'a2', null, [10, 10]),
      match('GA2', 0, 'a1', 'a3', 0, [30, 10]),
      match('GA3', 0, 'a2', 'a3', 0, [30, 10]),
    ];
    const slots = qualifiersOf([GROUPS_A], matches, 2);

    expect(slots.map(s => s.tied)).toEqual([true, true]);
    expect(slots.map(s => s.ambiguous)).toEqual([false, false]);
    expect(slots.map(s => s.participantId)).toEqual(['a1', 'a2']);
  });

  it('上がる / 上がらないの境目で並んだら ambiguous を立てる', () => {
    // a2 と a3 が勝ち点・合計ポイント・直接対決まで並ぶ。上位2なら片方しか上がれない
    const matches = [
      match('GA1', 0, 'a1', 'a2', 0, [30, 10]),
      match('GA2', 0, 'a1', 'a3', 0, [30, 10]),
      match('GA3', 0, 'a2', 'a3', null, [10, 10]),
    ];
    const slots = qualifiersOf([GROUPS_A], matches, 2);

    expect(slots[0]!.ambiguous).toBe(false);          // 1位は明確
    expect(slots[1]!.ambiguous).toBe(true);           // ここは人が決めるべき
    // それでも枠は埋まる — 決勝が始められなくなってはいけない
    expect(slots[1]!.participantId).not.toBeNull();
  });

  it('手動指定が自動判定を上書きし、null で自動に戻る', () => {
    const withManual = qualifiersOf([GROUPS_A], CLEAR_A, 2, { '0:2': 'a3' });
    expect(withManual[1]!.participantId).toBe('a3');
    expect(withManual[1]!.manualParticipantId).toBe('a3');
    expect(withManual[1]!.autoParticipantId).toBe('a2');   // 自動値は残して見せる

    const back = qualifiersOf([GROUPS_A], CLEAR_A, 2, {});
    expect(back[1]!.participantId).toBe('a2');
  });

  it('そのリーグの所属でない人の指定は黙って無視する', () => {
    const slots = qualifiersOf([GROUPS_A, ['b1', 'b2']], CLEAR_A, 2, { '0:1': 'b1' });
    expect(slots[0]!.participantId).toBe('a1');
    expect(slots[0]!.manualParticipantId).toBeNull();
  });

  it('人数が足りない順位の枠は bye になる', () => {
    const slots = qualifiersOf([['solo']], [], 2);
    expect(slots[0]!.bye).toBe(false);
    expect(slots[1]!.bye).toBe(true);
    expect(slots[1]!.pending).toBe(false);
  });

  it('同じ入力なら何度計算しても同じ結果になる', () => {
    const once  = qualifiersOf([GROUPS_A], CLEAR_A, 2).map(s => s.participantId);
    const twice = qualifiersOf([GROUPS_A], CLEAR_A, 2).map(s => s.participantId);
    expect(once).toEqual(twice);
  });
});

describe('resolveGroupRank', () => {
  it('未消化の試合が残っていれば known:false', () => {
    const half = [CLEAR_A[0]!, match('GA2', 0, 'a1', 'a3', 0, [30, 10], false)];
    expect(resolveGroupRank(GROUPS_A, half, LP, 1, undefined))
      .toEqual({ id: null, bye: false, known: false });
  });

  it('全部終われば順位表の位置で決まる', () => {
    expect(resolveGroupRank(GROUPS_A, CLEAR_A, LP, 2, undefined))
      .toEqual({ id: 'a2', bye: false, known: true });
  });

  it('手動指定は予選の途中でも通す (運営が最終的に決められる)', () => {
    const half = [match('GA1', 0, 'a1', 'a2', 0, [30, 10], false)];
    expect(resolveGroupRank(GROUPS_A, half, LP, 1, 'a3'))
      .toEqual({ id: 'a3', bye: false, known: true });
  });

  it('参加者が足りない枠は予選を待たずに bye と分かる', () => {
    expect(resolveGroupRank(['solo'], [], LP, 2, undefined))
      .toEqual({ id: null, bye: true, known: true });
  });
});
