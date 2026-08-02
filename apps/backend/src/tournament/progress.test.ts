import { describe, it, expect } from 'vitest';
import type { ParticipantDef, TournamentMatch, TournamentMatchResult } from '@u15/ws-types';
import { buildBracket } from './bracket.js';
import {
  captureResult,
  confirmResult,
  discardResult,
  downstreamOf,
  hasConfirmedDownstream,
  nextReadyMatch,
  reopenMatch,
  resolveMatches,
  setWalkover,
} from './progress.js';

function people(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`, name: `T${i + 1}`, seed: i + 1, program: null,
  }));
}

function result(winnerSide: 0 | 1 | null): TournamentMatchResult {
  return {
    roundResults: [],
    set: { totals: [0, 0], wins: [0, 0], draws: 0, winnerSide, decidedBy: 'wins' },
    decidedBy: 'wins',
    winnerSide,
    capturedAt: 1,
  };
}

/** 試合を1つ決着させる (capture → confirm) */
function play(ms: TournamentMatch[], id: string, winnerSide: 0 | 1): TournamentMatch[] {
  return confirmResult(captureResult(ms, id, result(winnerSide)), id, {});
}

const OPTS = { thirdPlaceMatch: false };

describe('resolveMatches', () => {
  it('1回戦は ready、2回戦以降は pending から始まる', () => {
    const ms = resolveMatches(buildBracket(people(4), OPTS));
    expect(ms.find(m => m.id === 'SF1')!.status).toBe('ready');
    expect(ms.find(m => m.id === 'SF2')!.status).toBe('ready');
    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('pending');
  });

  it('winner-of は確定した勝者を伝播する', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = play(ms, 'SF1', 0); // p01 の勝ち
    ms = play(ms, 'SF2', 1); // p03 の勝ち (SF2 は p02 vs p03 の順)

    const final = ms.find(m => m.id === 'FINAL')!;
    expect(final.resolvedA).toBe('p01');
    expect(final.resolvedB).toBe('p03');
    expect(final.status).toBe('ready');
  });

  it('loser-of は敗者を3位決定戦へ伝播する', () => {
    let ms = resolveMatches(buildBracket(people(4), { thirdPlaceMatch: true }));
    ms = play(ms, 'SF1', 0);
    ms = play(ms, 'SF2', 1);

    const third = ms.find(m => m.id === 'THIRD')!;
    expect(third.resolvedA).toBe('p04'); // SF1 の敗者
    expect(third.resolvedB).toBe('p02'); // SF2 の敗者
    expect(third.status).toBe('ready');
  });

  it('bye のカードは対戦せず walkover で自動確定し、勝者が次へ進む', () => {
    const ms = resolveMatches(buildBracket(people(3), OPTS));

    // 3人 → サイズ4。第1シードが bye と当たる
    const byeMatch = ms.find(m => m.byeA || m.byeB)!;
    expect(byeMatch.status).toBe('done');
    expect(byeMatch.result!.decidedBy).toBe('walkover');
    expect(byeMatch.result!.roundResults).toEqual([]);

    const winner = byeMatch.byeA ? byeMatch.resolvedB : byeMatch.resolvedA;
    expect(winner).toBe('p01');

    const final = ms.find(m => m.id === 'FINAL')!;
    expect([final.resolvedA, final.resolvedB]).toContain('p01');
  });

  it('armed / in_progress はオーケストレータの管理下なので上書きしない', () => {
    const ms = resolveMatches(buildBracket(people(4), OPTS));
    const armed = resolveMatches(ms.map(m =>
      m.id === 'SF1' ? { ...m, status: 'armed' as const } : m));
    expect(armed.find(m => m.id === 'SF1')!.status).toBe('armed');

    const running = resolveMatches(armed.map(m =>
      m.id === 'SF1' ? { ...m, status: 'in_progress' as const } : m));
    expect(running.find(m => m.id === 'SF1')!.status).toBe('in_progress');
  });

  it('入力配列を破壊しない', () => {
    const src = buildBracket(people(4), OPTS);
    const before = JSON.stringify(src);
    resolveMatches(src);
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe('captureResult / confirmResult', () => {
  it('capture は awaiting_confirm、confirm で done になり勝者が伝播する', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = captureResult(ms, 'SF1', result(0));
    expect(ms.find(m => m.id === 'SF1')!.status).toBe('awaiting_confirm');
    // 未確定なので下流はまだ pending
    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('pending');

    ms = confirmResult(ms, 'SF1', {});
    expect(ms.find(m => m.id === 'SF1')!.status).toBe('done');
    expect(ms.find(m => m.id === 'FINAL')!.resolvedA).toBe('p01');
  });

  it('同点 (winnerSide=null) を手動決着で確定できる', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = captureResult(ms, 'SF1', result(null));
    ms = confirmResult(ms, 'SF1', { winnerSide: 1, decidedBy: 'manual', note: '抽選' });

    const sf1 = ms.find(m => m.id === 'SF1')!;
    expect(sf1.status).toBe('done');
    expect(sf1.result!.winnerSide).toBe(1);
    expect(sf1.result!.decidedBy).toBe('manual');
    expect(sf1.result!.note).toBe('抽選');
    expect(ms.find(m => m.id === 'FINAL')!.resolvedA).toBe('p04');
  });

  it('winnerSide=null のまま確定すると勝者不在の枠が bye として下流へ伝わる', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = confirmResult(captureResult(ms, 'SF1', result(null)), 'SF1', {});
    ms = play(ms, 'SF2', 0);

    const final = ms.find(m => m.id === 'FINAL')!;
    expect(final.byeA).toBe(true);
    // 相手の不戦勝として自動確定する (ブラケットが詰まない)
    expect(final.status).toBe('done');
    expect(final.result!.decidedBy).toBe('walkover');
    expect(final.result!.winnerSide).toBe(1);
  });
});

describe('setWalkover', () => {
  it('対戦せずに不戦勝で確定できる', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = setWalkover(ms, 'SF1', 0);
    const sf1 = ms.find(m => m.id === 'SF1')!;
    expect(sf1.status).toBe('done');
    expect(sf1.result!.decidedBy).toBe('walkover');
    expect(ms.find(m => m.id === 'FINAL')!.resolvedA).toBe('p01');
  });
});

describe('discardResult', () => {
  it('結果を捨てて ready に戻す', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = captureResult(ms, 'SF1', result(null));
    ms = discardResult(ms, 'SF1');

    const sf1 = ms.find(m => m.id === 'SF1')!;
    expect(sf1.status).toBe('ready');
    expect(sf1.result).toBeUndefined();
  });

  it('再試合用のマップ ID を持ち回れる', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = captureResult(ms, 'SF1', result(null));
    ms = discardResult(ms, 'SF1', 'map-xyz');
    expect(ms.find(m => m.id === 'SF1')!.rematchMapCatalogId).toBe('map-xyz');
  });
});

describe('downstreamOf / reopenMatch', () => {
  // 8人なら1回戦がそのまま準々決勝なので ID は QF1..QF4 になる
  it('推移的な下流だけを列挙する', () => {
    const ms = buildBracket(people(8), OPTS);
    const ds = downstreamOf(ms, 'QF1');
    expect(ds).toContain('SF1');
    expect(ds).toContain('FINAL');
    expect(ds).not.toContain('QF2');
    expect(ds).not.toContain('QF3');
    expect(ds).not.toContain('SF2');
  });

  it('reopen は下流の結果も巻き戻すが、無関係な枝は触らない', () => {
    let ms = resolveMatches(buildBracket(people(8), OPTS));
    for (const id of ['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'FINAL']) {
      ms = play(ms, id, 0);
    }

    expect(hasConfirmedDownstream(ms, 'QF1')).toBe(true);
    const re = reopenMatch(ms, 'QF1');

    expect(re.find(m => m.id === 'QF1')!.status).toBe('ready');
    expect(re.find(m => m.id === 'SF1')!.status).toBe('pending');
    expect(re.find(m => m.id === 'FINAL')!.status).toBe('pending');
    // 反対の枝は無傷
    expect(re.find(m => m.id === 'QF3')!.status).toBe('done');
    expect(re.find(m => m.id === 'SF2')!.status).toBe('done');
  });

  it('16人では1回戦が R1M* になる', () => {
    const ms = buildBracket(people(16), OPTS);
    expect(ms.filter(m => m.stage === 0).map(m => m.id).slice(0, 3))
      .toEqual(['R1M1', 'R1M2', 'R1M3']);
    expect(downstreamOf(ms, 'R1M1')).toContain('FINAL');
  });

  it('下流に確定が無ければ cascade は不要', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = play(ms, 'SF1', 0);
    expect(hasConfirmedDownstream(ms, 'SF1')).toBe(false);
  });
});

describe('nextReadyMatch', () => {
  it('stage / order が最小の ready を返す', () => {
    const ms = resolveMatches(buildBracket(people(8), OPTS));
    expect(nextReadyMatch(ms)!.id).toBe('QF1');
  });

  it('ready が無ければ null', () => {
    let ms = resolveMatches(buildBracket(people(2), OPTS));
    ms = play(ms, 'FINAL', 0);
    expect(nextReadyMatch(ms)).toBeNull();
  });

  it('3位決定戦を決勝より先に案内する', () => {
    // 準決勝が両方終わると決勝と3位決定戦が同時に ready になる。
    // 依存関係は無いので順序は運営の都合で決まる — 決勝を締めくくりにする
    let ms = resolveMatches(buildBracket(people(4), { thirdPlaceMatch: true }));
    ms = play(ms, 'SF1', 0);
    ms = play(ms, 'SF2', 1);

    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('ready');
    expect(ms.find(m => m.id === 'THIRD')!.status).toBe('ready');
    expect(nextReadyMatch(ms)!.id).toBe('THIRD');

    // 3位決定戦が終われば決勝が案内される
    ms = play(ms, 'THIRD', 0);
    expect(nextReadyMatch(ms)!.id).toBe('FINAL');
  });

  it('表示順 (order) は決勝が先のまま — 実施順と表示順は別物', () => {
    const ms = resolveMatches(buildBracket(people(4), { thirdPlaceMatch: true }));
    const final = ms.find(m => m.id === 'FINAL')!;
    const third = ms.find(m => m.id === 'THIRD')!;
    expect(final.stage).toBe(third.stage);
    expect(final.order).toBeLessThan(third.order);
  });

  it('3位決定戦が無ければ決勝がそのまま次の試合', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = play(ms, 'SF1', 0);
    ms = play(ms, 'SF2', 1);
    expect(nextReadyMatch(ms)!.id).toBe('FINAL');
  });
});
