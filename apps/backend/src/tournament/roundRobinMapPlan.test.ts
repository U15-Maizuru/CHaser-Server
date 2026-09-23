import { describe, expect, it } from 'vitest';
import type {
  StageRules, TournamentDefinition, TournamentMatch, TournamentState,
} from '@u15/ws-types';
import { DEFAULT_LEAGUE_POINTS } from '@u15/ws-types';
import { roundRobinMapPlanFor, type LoadedTournament } from './TournamentStore.js';

// roundRobinMapPlanFor は総当たり (league / 予選リーグ) 試合のマップ方針を決める純関数。
// 「リーグ内で違うマップを使ってはいけない」という制約のため、対戦カードごとではなく
// リーグ単位 (group-then-bracket は group、league は大会全体) でしか解決しない。

function match(over: Partial<TournamentMatch> = {}): TournamentMatch {
  return {
    id: 'M1', stage: 0, label: '第1節 第1試合', order: 0,
    slotA: { kind: 'participant', participantId: 'p1' },
    slotB: { kind: 'participant', participantId: 'p2' },
    resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
    status: 'ready',
    ...over,
  };
}

function loaded(stage: StageRules): LoadedTournament {
  const def: TournamentDefinition = {
    formatVersion: 1, id: 'cup', name: '大会', ruleSet: 'maizuru',
    match: { doubleMode: true }, stage, participants: [],
  };
  return { def, state: {} as TournamentState };
}

const LEAGUE = { points: DEFAULT_LEAGUE_POINTS, doubleRoundRobin: false };

describe('roundRobinMapPlanFor', () => {
  describe('league', () => {
    it('固定マップがあれば fixed', () => {
      const l = loaded({ format: 'league', map: { catalogId: 'cup-map', bracketStages: [] }, league: LEAGUE });
      expect(roundRobinMapPlanFor(l, match())).toEqual({ kind: 'fixed', catalogId: 'cup-map' });
    });

    it('固定マップが無ければ random (大会全体で共有する \'*\')', () => {
      const l = loaded({ format: 'league', map: { catalogId: null, bracketStages: [] }, league: LEAGUE });
      expect(roundRobinMapPlanFor(l, match())).toEqual({ kind: 'random', decisionKey: '*' });
    });
  });

  describe('group-then-bracket', () => {
    const base = {
      format: 'group-then-bracket' as const,
      thirdPlaceMatch: false, league: LEAGUE, groupCount: 2, advancePerGroup: 2,
      qualifyingDoubleMode: true, groupScheduleMode: 'parallel' as const,
    };

    it('予選の試合 (group あり) で groupMaps にリーグ固有の catalogId があれば fixed', () => {
      const l = loaded({
        ...base, map: { catalogId: null, bracketStages: [] }, groupMaps: ['a-map', null],
      });
      expect(roundRobinMapPlanFor(l, match({ group: 0 }))).toEqual({ kind: 'fixed', catalogId: 'a-map' });
    });

    it('groupMaps が \'random\' ならそのリーグ専用の decisionKey', () => {
      const l = loaded({
        ...base, map: { catalogId: null, bracketStages: [] }, groupMaps: ['random', null],
      });
      expect(roundRobinMapPlanFor(l, match({ group: 0 })))
        .toEqual({ kind: 'random', decisionKey: '0' });
      expect(roundRobinMapPlanFor(l, match({ id: 'M2', group: 1 })))
        .toEqual({ kind: 'random', decisionKey: '*' }); // 未指定リーグは大会全体の設定へフォールバック
    });

    it('groupMaps が null かつ大会全体が固定マップなら、全リーグ共通で fixed', () => {
      const l = loaded({
        ...base, map: { catalogId: 'cup-map', bracketStages: [] }, groupMaps: [],
      });
      expect(roundRobinMapPlanFor(l, match({ group: 0 }))).toEqual({ kind: 'fixed', catalogId: 'cup-map' });
      expect(roundRobinMapPlanFor(l, match({ id: 'M2', group: 1 })))
        .toEqual({ kind: 'fixed', catalogId: 'cup-map' });
    });

    it('groupMaps が無く大会全体もランダムなら、全リーグ共通の \'*\' で random (既定)', () => {
      const l = loaded({ ...base, map: { catalogId: null, bracketStages: [] }, groupMaps: [] });
      expect(roundRobinMapPlanFor(l, match({ group: 0 })))
        .toEqual({ kind: 'random', decisionKey: '*' });
      expect(roundRobinMapPlanFor(l, match({ id: 'M2', group: 1 })))
        .toEqual({ kind: 'random', decisionKey: '*' });
    });

    it('決勝トーナメントの試合 (group なし) は対象外 (null)', () => {
      const l = loaded({
        ...base, map: { catalogId: null, bracketStages: [] }, groupMaps: ['random', 'random'],
      });
      expect(roundRobinMapPlanFor(l, match({ id: 'FINAL', group: undefined }))).toBeNull();
    });
  });

  describe('bot-then-bracket / single-elimination は対象外', () => {
    it('BOT対戦予選の予選試合 (group あり) は null', () => {
      const l = loaded({
        format: 'bot-then-bracket', map: { catalogId: null, bracketStages: [] },
        thirdPlaceMatch: false, advanceCount: 4, qualifyingDoubleMode: true,
        bot: { program: null, name: null, map: 'bot-map', participantSide: 0 },
      });
      expect(roundRobinMapPlanFor(l, match({ group: 0 }))).toBeNull();
    });

    it('トーナメント (勝ち上がり) の試合は null', () => {
      const l = loaded({ format: 'single-elimination', map: { catalogId: null, bracketStages: [] }, thirdPlaceMatch: false });
      expect(roundRobinMapPlanFor(l, match())).toBeNull();
    });
  });
});
