import { describe, it, expect } from 'vitest';
import type { ParticipantDef, TournamentMatch, TournamentMatchResult } from '@u15/ws-types';
import { buildBracket } from './bracket.js';
import {
  captureResult,
  confirmResult,
  discardResult,
  downstreamOf,
  hasConfirmedDownstream,
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

  it('運営を開始していない大会 (started=false) では bye を確定させない', () => {
    // 開始前の大会を「もう1試合終わっている」ことにしないため。
    // 大会一覧の進行が 0/3 ではなく 1/3 から始まってしまう
    const ms = resolveMatches(buildBracket(people(3), OPTS), Date.now(), { started: false });

    const byeMatch = ms.find(m => m.byeA || m.byeB)!;
    expect(byeMatch.status).not.toBe('done');
    expect(byeMatch.result).toBeUndefined();
    expect(ms.filter(m => m.status === 'done')).toHaveLength(0);

    // それでも「誰が上がるか」は対戦を待たずに決まっているので、次の回戦には顔が出る
    // (組み合わせ表として先に見せてよい。立たないのは結果と done だけ)
    const final = ms.find(m => m.id === 'FINAL')!;
    expect([final.resolvedA, final.resolvedB]).toContain('p01');
  });

  it('開始すれば (既定) 同じ試合グラフから bye が確定する', () => {
    const before = resolveMatches(buildBracket(people(3), OPTS), Date.now(), { started: false });
    const after  = resolveMatches(before);
    expect(after.find(m => m.byeA || m.byeB)!.status).toBe('done');
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

  it('16人では1回戦が R1M* になる (番号は表示位置ではなくシードで決まる)', () => {
    const ms = buildBracket(people(16), OPTS);
    // 第N試合 = 「弱いほうの選手が N 番目に弱い」カード。表の上から見ると飛び飛びになる
    expect(ms.filter(m => m.stage === 0).map(m => m.id))
      .toEqual(['R1M1', 'R1M8', 'R1M5', 'R1M4', 'R1M3', 'R1M6', 'R1M7', 'R1M2']);
    expect(downstreamOf(ms, 'R1M1')).toContain('FINAL');
  });

  it('下流に確定が無ければ cascade は不要', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = play(ms, 'SF1', 0);
    expect(hasConfirmedDownstream(ms, 'SF1')).toBe(false);
  });
});

// ── 予選リーグ → 決勝トーナメント (group-rank) ─────────────────────────────

describe('group-rank の解決', () => {
  const GROUPS = [['a1', 'a2'], ['b1', 'b2']];
  const CTX = {
    groups: GROUPS,
    leaguePoints: { win: 3, draw: 1, loss: 0 },
  };

  /** 各リーグ2人 (1試合ずつ) + 決勝1試合 の最小構成 */
  function cup(): TournamentMatch[] {
    const league = (group: number, a: string, b: string): TournamentMatch => ({
      id: `G${group + 1}-D1M1`, stage: 0, order: group, label: `第1節`, group,
      slotA: { kind: 'participant', participantId: a },
      slotB: { kind: 'participant', participantId: b },
      resolvedA: null, resolvedB: null, byeA: false, byeB: false, status: 'pending',
    });
    const final: TournamentMatch = {
      id: 'FINAL', stage: 1, order: 0, label: '決勝',
      slotA: { kind: 'group-rank', group: 0, rank: 1 },
      slotB: { kind: 'group-rank', group: 1, rank: 1 },
      resolvedA: null, resolvedB: null, byeA: false, byeB: false, status: 'pending',
    };
    return resolveMatches([league(0, 'a1', 'a2'), league(1, 'b1', 'b2'), final], Date.now(), CTX);
  }

  const playIn = (ms: TournamentMatch[], id: string, side: 0 | 1) =>
    confirmResult(captureResult(ms, id, result(side), CTX), id, {}, Date.now(), CTX);

  it('予選が終わるまで決勝は pending', () => {
    let ms = cup();
    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('pending');

    ms = playIn(ms, 'G1-D1M1', 0);
    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('pending');   // B リーグが未消化
  });

  it('両リーグが終われば決勝進出者が決まって ready になる', () => {
    let ms = cup();
    ms = playIn(ms, 'G1-D1M1', 0);
    ms = playIn(ms, 'G2-D1M1', 1);

    const final = ms.find(m => m.id === 'FINAL')!;
    expect(final.status).toBe('ready');
    expect([final.resolvedA, final.resolvedB]).toEqual(['a1', 'b2']);
  });

  it('手動指定が自動判定を上書きする', () => {
    let ms = cup();
    ms = playIn(ms, 'G1-D1M1', 0);
    ms = playIn(ms, 'G2-D1M1', 0);

    const overridden = resolveMatches(ms, Date.now(), {
      ...CTX, qualifierOverrides: { '0:1': 'a2' },
    });
    expect(overridden.find(m => m.id === 'FINAL')!.resolvedA).toBe('a2');
  });

  it('予選の試合は決勝の上流として扱われる', () => {
    const ms = cup();
    expect(downstreamOf(ms, 'G1-D1M1').has('FINAL')).toBe(true);
    // 同じリーグの他の試合を巻き込まない (リーグの試合は participant 参照しか持たない)
    expect(downstreamOf(ms, 'G1-D1M1').has('G2-D1M1')).toBe(false);
  });

  it('予選をやり直すと決勝の結果も巻き戻る', () => {
    let ms = cup();
    ms = playIn(ms, 'G1-D1M1', 0);
    ms = playIn(ms, 'G2-D1M1', 0);
    ms = playIn(ms, 'FINAL', 0);
    expect(ms.find(m => m.id === 'FINAL')!.status).toBe('done');

    expect(hasConfirmedDownstream(ms, 'G1-D1M1')).toBe(true);

    const reopened = reopenMatch(ms, 'G1-D1M1', CTX);
    expect(reopened.find(m => m.id === 'FINAL')!.status).toBe('pending');
    expect(reopened.find(m => m.id === 'FINAL')!.result).toBeUndefined();
  });

  it('確定済みの試合の対戦相手が、あとから別人にすり替わらない', () => {
    // 予選をやり直したあと順位が変わっても、既に確定した決勝の resolvedA/B が
    // 「戦っていない相手」に書き換わってはいけない (巻き戻しで結果ごと消えるのが正しい)
    let ms = cup();
    ms = playIn(ms, 'G1-D1M1', 0);
    ms = playIn(ms, 'G2-D1M1', 0);
    ms = playIn(ms, 'FINAL', 0);

    // A リーグの結果をひっくり返す
    let after = reopenMatch(ms, 'G1-D1M1', CTX);
    after = playIn(after, 'G1-D1M1', 1);

    for (const m of after) {
      if (m.status !== 'done' || !m.result || m.byeA || m.byeB) continue;
      expect(m.resolvedA).not.toBeNull();
      expect(m.resolvedB).not.toBeNull();
    }
    // 決勝は巻き戻っているので、勝者を名乗る記録は残っていない
    expect(after.find(m => m.id === 'FINAL')!.result).toBeUndefined();
  });

  it('文脈を渡さなければ group-rank は解決されない (既存形式に影響しない)', () => {
    let ms = cup();
    ms = playIn(ms, 'G1-D1M1', 0);
    ms = playIn(ms, 'G2-D1M1', 0);

    const noCtx = resolveMatches(ms);
    expect(noCtx.find(m => m.id === 'FINAL')!.status).toBe('pending');
  });
});
