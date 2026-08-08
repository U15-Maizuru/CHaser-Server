import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { autoGroupAssign, groupLabel } from '@u15/ws-types';
import { groupStageCount } from '@u15/ws-types';
import { assignGroups, buildGroupStage } from './groupStage.js';

function people(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`, name: `T${i + 1}`, seed: i + 1, program: null,
  }));
}

const OPTS = {
  groupCount: 2, advancePerGroup: 2, doubleRoundRobin: false, thirdPlaceMatch: false,
};

const idsOf = (ms: TournamentMatch[]) => ms.map(m => m.id);
const find  = (ms: TournamentMatch[], id: string) => ms.find(m => m.id === id)!;

describe('autoGroupAssign (蛇行配分)', () => {
  it('端から折り返して配る', () => {
    expect(autoGroupAssign(4, 2)).toEqual([0, 1, 1, 0]);
    expect(autoGroupAssign(8, 2)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    expect(autoGroupAssign(6, 3)).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('人数が割り切れなくても各リーグの差は1人以内', () => {
    for (const [n, g] of [[5, 2], [7, 3], [9, 4], [11, 3]] as const) {
      const sizes = Array.from({ length: g }, (_, k) =>
        autoGroupAssign(n, g).filter(x => x === k).length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('割り切れないときは前のリーグを多くする', () => {
    const sizesOf = (n: number, g: number) => Array.from({ length: g }, (_, k) =>
      autoGroupAssign(n, g).filter(x => x === k).length);

    expect(sizesOf(5, 2)).toEqual([3, 2]);
    expect(sizesOf(5, 3)).toEqual([2, 2, 1]);   // 蛇行そのままだと [1,2,2] になってしまう
    expect(sizesOf(4, 3)).toEqual([2, 1, 1]);
    expect(sizesOf(7, 3)).toEqual([3, 2, 2]);
    expect(sizesOf(11, 4)).toEqual([3, 3, 3, 2]);

    // 人数が割り切れるときは単純な蛇行になる
    expect(autoGroupAssign(8, 2)).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
    expect(autoGroupAssign(6, 3)).toEqual([0, 1, 2, 2, 1, 0]);
  });
});

describe('groupLabel', () => {
  it('0始まりで A, B, C …', () => {
    expect([0, 1, 2, 25].map(groupLabel)).toEqual(['A', 'B', 'C', 'Z']);
  });
});

describe('assignGroups', () => {
  it('選手番号順に蛇行で振り分ける', () => {
    const groups = assignGroups(people(6), 2);
    expect(groups.map(g => g.map(p => p.id))).toEqual([
      ['p01', 'p04', 'p05'],
      ['p02', 'p03', 'p06'],
    ]);
  });

  it('明示指定は自動振り分けより優先される', () => {
    const ps = people(4);
    ps[1]!.group = 0;   // 本来なら B リーグ
    ps[3]!.group = 1;   // 本来なら A リーグ
    const groups = assignGroups(ps, 2);
    expect(groups[0]!.map(p => p.id)).toEqual(['p01', 'p02']);
    expect(groups[1]!.map(p => p.id)).toEqual(['p03', 'p04']);
  });
});

describe('buildGroupStage', () => {
  it('予選の試合はリーグ番号と id・ラベルを持つ', () => {
    const ms  = buildGroupStage(people(4), OPTS);
    const g1  = ms.filter(m => m.group === 0);

    expect(g1.map(m => m.id)).toEqual(['G1-D1M1']);
    expect(g1[0]!.label).toBe('Aリーグ 第1節 第1試合');
    expect(ms.filter(m => m.group === 1)[0]!.label).toBe('Bリーグ 第1節 第1試合');
  });

  it('全リーグの第1節が同じ stage に並ぶ', () => {
    const ms = buildGroupStage(people(8), OPTS);   // 各リーグ4人 → 3節
    for (const stage of [0, 1, 2]) {
      const at = ms.filter(m => m.group !== undefined && m.stage === stage);
      expect(at.map(m => m.group).sort()).toEqual([0, 0, 1, 1]);
    }
  });

  it('同じ stage の order がリーグ間で衝突しない', () => {
    const ms = buildGroupStage(people(8), OPTS);
    for (const stage of [0, 1, 2]) {
      const orders = ms.filter(m => m.group !== undefined && m.stage === stage).map(m => m.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('2リーグ×上位2 は A1-B2 / B1-A2 のクロス配置になる', () => {
    const ms = buildGroupStage(people(8), OPTS);
    const sf1 = find(ms, 'SF1');
    const sf2 = find(ms, 'SF2');

    expect(sf1.slotA).toEqual({ kind: 'group-rank', group: 0, rank: 1 });
    expect(sf1.slotB).toEqual({ kind: 'group-rank', group: 1, rank: 2 });
    expect(sf2.slotA).toEqual({ kind: 'group-rank', group: 1, rank: 1 });
    expect(sf2.slotB).toEqual({ kind: 'group-rank', group: 0, rank: 2 });
  });

  it('決勝トーナメントの stage は予選の節数ぶんずれ、id は決勝T内の相対で付く', () => {
    const ms     = buildGroupStage(people(8), OPTS);   // 予選3節
    const offset = groupStageCount(ms);

    expect(offset).toBe(3);
    expect(find(ms, 'SF1').stage).toBe(3);
    expect(find(ms, 'FINAL').stage).toBe(4);
    // ゲタを id に混ぜると 'R4M1' のようになってしまう
    expect(idsOf(ms.filter(m => m.group === undefined)).sort()).toEqual(['FINAL', 'SF1', 'SF2']);
  });

  it('ラベルは決勝トーナメント内の回戦名になる', () => {
    const ms = buildGroupStage(people(8), OPTS);
    expect(find(ms, 'SF1').label).toBe('準決勝 第1試合');
    expect(find(ms, 'FINAL').label).toBe('決勝');
  });

  it('3位決定戦もゲタぶんずれた stage に置かれ、準決勝の敗者を参照する', () => {
    const ms = buildGroupStage(people(8), { ...OPTS, thirdPlaceMatch: true });
    const third = find(ms, 'THIRD');
    expect(third.stage).toBe(find(ms, 'FINAL').stage);
    expect(third.slotA).toEqual({ kind: 'loser-of', matchId: 'SF1' });
    expect(third.slotB).toEqual({ kind: 'loser-of', matchId: 'SF2' });
  });

  it('人数が奇数でも両リーグの2位枠が成立する', () => {
    const ms = buildGroupStage(people(5), OPTS);   // 3人 + 2人
    const refs = [find(ms, 'SF1'), find(ms, 'SF2')].flatMap(m => [m.slotA, m.slotB]);
    expect(refs.filter(r => r.kind === 'group-rank')).toHaveLength(4);
  });

  it('その順位に届く人数がいないリーグの枠は bye になる', () => {
    // 4人3リーグ → 2人 / 1人 / 1人 (割り切れないぶんは前のリーグへ)。
    // 2位が居ないリーグの枠は組み立て時点で不戦と分かる
    const ms = buildGroupStage(people(4), { ...OPTS, groupCount: 3 });
    expect(assignGroups(people(4), 3).map(g => g.length)).toEqual([2, 1, 1]);

    const refs = ms
      .filter(m => m.group === undefined)
      .flatMap(m => [m.slotA, m.slotB])
      .filter((r): r is Extract<MatchSlotRef, { kind: 'group-rank' }> => r.kind === 'group-rank');

    // 1人しかいないリーグの rank 2 が group-rank で残っていると、順位表に行が無く落ちる
    expect(refs.some(r => r.group === 0 && r.rank === 2)).toBe(true);
    expect(refs.some(r => r.group === 1 && r.rank === 2)).toBe(false);
    expect(refs.some(r => r.group === 2 && r.rank === 2)).toBe(false);
  });

  it('進出人数を増やすと2の冪に切り上がり、bye 同士のカードは出ない', () => {
    const ms = buildGroupStage(people(12), { ...OPTS, advancePerGroup: 3 });   // 6人 → 8枠
    const first = ms.filter(m => m.group === undefined && m.stage === groupStageCount(ms));
    expect(first).toHaveLength(4);
    expect(first.some(m => m.slotA.kind === 'bye' && m.slotB.kind === 'bye')).toBe(false);
  });

  it('2回総当たりでは節が倍になる', () => {
    const single = groupStageCount(buildGroupStage(people(8), OPTS));
    const double = groupStageCount(buildGroupStage(people(8), { ...OPTS, doubleRoundRobin: true }));
    expect(double).toBe(single * 2);
  });
});

describe('groupStageCountOf', () => {
  it('予選を持たない試合グラフでは 0 (= ゲタ無し)', () => {
    expect(groupStageCount([])).toBe(0);
    const noGroups: TournamentMatch[] = [{
      id: 'FINAL', stage: 3, order: 0, label: '決勝',
      slotA: { kind: 'bye' }, slotB: { kind: 'bye' },
      resolvedA: null, resolvedB: null, byeA: true, byeB: true, status: 'pending',
    }];
    expect(groupStageCount(noGroups)).toBe(0);
  });
});
