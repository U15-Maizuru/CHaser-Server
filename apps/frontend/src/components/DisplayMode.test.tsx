import { describe, expect, it } from 'vitest';
import type { TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import { stageRulesFor } from '../test/tournamentFixture';
import { baseDisplayScene } from './DisplayMode';

function match(id: string, extra: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id, stage: 0, order: 0, label: id,
    slotA: { kind: 'participant', participantId: 'p1' },
    slotB: { kind: 'participant', participantId: 'p2' },
    resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
    status: 'ready',
    ...extra,
  };
}

function tournamentState(matches: TournamentMatch[], armedMatchId: string | null): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: true },
    stage: stageRulesFor('single-elimination'),
    participants: ['A', 'B'].map((name, i) => ({
      id: `p${i + 1}`, name, seed: i + 1,
      programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
    })),
    matches, standings: null, groups: null, qualifiers: null, qualifierCandidates: null,
    stageMaps: [], thirdPlaceMapId: null, stageLabels: [], qualifiersConfirmed: false,
    displayView: 'auto', autoPlay: { enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null },
    lanes: [{ roomId: 'room', primary: true, armedMatchId }],
    armedMatchId, boundRoomId: 'room', updatedAt: 0,
  };
}

// 両ゲームとも終わっている (awaiting_confirm) 間、armedMatchId は confirmResult まで
// 残ったまま。運営が「この結果で確定」を押すまでは盤面の結果画面 (result) を見せ続け、
// トーナメント表 (standby) には進めない — 運営が裁定で結果を変えるかもしれない間に、
// 確定済みのような表示を観客に見せないため
describe('baseDisplayScene — 確定待ちの試合の場面選択', () => {
  it('両ゲーム終了・確定待ち (awaiting_confirm) でも、運営が確定するまでは盤面の結果画面のまま', () => {
    const state = tournamentState([match('SF1', { status: 'awaiting_confirm' })], 'SF1');
    expect(baseDisplayScene('finished', state, 'bracket')).toBe('result');
  });

  it('確定して armedMatchId が外れれば、トーナメント表 (standby) へ切り替わる', () => {
    // 大会全体が終わっていない (award にならない) よう、確定待ちの試合をもう1つ残す
    const state = tournamentState(
      [match('SF1', { status: 'done' }), match('SF2', { status: 'ready' })], null,
    );
    expect(baseDisplayScene('finished', state, 'bracket')).toBe('standby');
  });

  it('大会に紐付いていなければ (tournament が無ければ)、これまでどおり盤面の結果画面のまま', () => {
    expect(baseDisplayScene('finished', null, 'bracket')).toBe('result');
  });

  // 同点は confirmResult できない (再試合か審判裁定が要る) ので、armedMatchId は
  // すぐには外れない。運営が「この結果で確定」で同点を認めた (tieAcknowledged) 時点で、
  // 再試合/裁定のどちらを選ぶかを待つ間もトーナメント表 (スコアと「引き分け」) へ進めてよい
  it('同点を「この結果で確定」で認めた (tieAcknowledged) ら、確定を待たずトーナメント表へ進める', () => {
    const state = tournamentState(
      [
        match('SF1', { status: 'awaiting_confirm', tieAcknowledged: true }),
        match('SF2', { status: 'ready' }),
      ],
      'SF1',
    );
    expect(baseDisplayScene('finished', state, 'bracket')).toBe('standby');
  });

  it('同点でもまだ認めていなければ (tieAcknowledged が無ければ)、盤面の結果画面のまま', () => {
    const state = tournamentState(
      [
        match('SF1', { status: 'awaiting_confirm' }),
        match('SF2', { status: 'ready' }),
      ],
      'SF1',
    );
    expect(baseDisplayScene('finished', state, 'bracket')).toBe('result');
  });
});
