import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, ParticipantDef } from '@u15/ws-types';
import { BOT_PARTICIPANT_ID } from '@u15/ws-types';
import { buildBotStage } from './botStage.js';

function participants(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, seed: i + 1, program: null,
  }));
}

const build = (
  n: number, opts: Partial<Parameters<typeof buildBotStage>[1]> = {},
) => buildBotStage(participants(n), {
  advanceCount: 4, participantSide: 0, thirdPlaceMatch: false, ...opts,
});

const qualifying = (ms: ReturnType<typeof build>) => ms.filter(m => m.group !== undefined);
const bracket    = (ms: ReturnType<typeof build>) => ms.filter(m => m.group === undefined);

const idOf = (ref: MatchSlotRef) => ref.kind === 'participant' ? ref.participantId : null;

describe('buildBotStage', () => {
  it('参加者ごとに BOT との1試合を作る (試合数 = 参加者数)', () => {
    const q = qualifying(build(6));
    expect(q).toHaveLength(6);
    expect(q.every(m => m.group === 0)).toBe(true);
    expect(q.every(m => m.stage === 0)).toBe(true);
    // 同じ stage に並ぶので order は衝突しない (次に実施する試合が不定にならない)
    expect(new Set(q.map(m => m.order)).size).toBe(6);
  });

  it('参加者先攻なら slotA が参加者、slotB が BOT', () => {
    const q = qualifying(build(3, { participantSide: 0 }));
    expect(q.map(m => idOf(m.slotA))).toEqual(['p1', 'p2', 'p3']);
    expect(q.every(m => idOf(m.slotB) === BOT_PARTICIPANT_ID)).toBe(true);
  });

  it('参加者後攻なら BOT と参加者が入れ替わる', () => {
    const q = qualifying(build(3, { participantSide: 1 }));
    expect(q.every(m => idOf(m.slotA) === BOT_PARTICIPANT_ID)).toBe(true);
    expect(q.map(m => idOf(m.slotB))).toEqual(['p1', 'p2', 'p3']);
  });

  it('決勝トーナメントは予選のうしろの stage に置かれる', () => {
    const b = bracket(build(8));
    expect(b.length).toBeGreaterThan(0);
    expect(Math.min(...b.map(m => m.stage))).toBe(1);
    // id と label は決勝T 内の相対 stage のまま (ゲタを混ぜない)
    expect(b.map(m => m.id).sort()).toEqual(['FINAL', 'SF1', 'SF2']);
  });

  it('1回戦は予選1位..N位を標準シード順で参照する', () => {
    // 4人進出 → seedOrder(4) = [1,4,2,3] → 準決勝は 1位-4位 / 2位-3位
    const first = bracket(build(8, { advanceCount: 4 }))
      .filter(m => m.stage === 1)
      .sort((a, b) => a.order - b.order);

    const rankOf = (ref: MatchSlotRef) => ref.kind === 'group-rank' ? ref.rank : null;
    expect(first.map(m => [rankOf(m.slotA), rankOf(m.slotB)])).toEqual([[1, 4], [2, 3]]);
    // 予選は1グループしか無いので、参照先は必ず group 0
    expect(first.every(m =>
      [m.slotA, m.slotB].every(r => r.kind === 'group-rank' && r.group === 0))).toBe(true);
  });

  it('進出人数に届かない枠は組み立て時点で bye になる', () => {
    // 3人しか居ないのに4人進出 → 4位の枠は埋まりようがない
    const first = bracket(build(3, { advanceCount: 4 })).filter(m => m.stage === 1);
    const kinds = first.flatMap(m => [m.slotA.kind, m.slotB.kind]);
    expect(kinds.filter(k => k === 'bye')).toHaveLength(1);
  });

  it('3位決定戦を足せる (決勝と同じ stage)', () => {
    const b = bracket(build(8, { advanceCount: 4, thirdPlaceMatch: true }));
    const third = b.find(m => m.id === 'THIRD');
    const final = b.find(m => m.id === 'FINAL');
    expect(third).toBeDefined();
    expect(third!.stage).toBe(final!.stage);
  });

  it('参加者が居なければ空 (組み立てようがない)', () => {
    expect(buildBotStage([], {
      advanceCount: 4, participantSide: 0, thirdPlaceMatch: false,
    })).toEqual([]);
  });
});
