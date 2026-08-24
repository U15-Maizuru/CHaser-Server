import { describe, it, expect } from 'vitest';
import type {
  ParticipantDef, ResolvedParticipant, StageRules, TournamentFormat,
  TournamentMatch, TournamentMatchResult, TournamentStatePayload,
} from '@u15/ws-types';
import {
  DEFAULT_LEAGUE_POINTS, blockedByQualifiers, isGroupStageDone, isKnockoutMatch,
  nextOperatorAction, nextReadyMatch,
} from '@u15/ws-types';
import { buildBracket } from './bracket.js';
import { buildGroupStage } from './groupStage.js';
import { confirmResult, captureResult, resolveMatches } from './progress.js';

const OPTS = { thirdPlaceMatch: false };

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

/** 1試合を勝敗つきで確定させる */
function play(ms: TournamentMatch[], id: string, winnerSide: 0 | 1 | null): TournamentMatch[] {
  return confirmResult(captureResult(ms, id, result(winnerSide)), id, {});
}

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

describe('isKnockoutMatch', () => {
  const bracketMatch = resolveMatches(buildBracket(people(2), OPTS))[0]!;

  it('リーグの試合は勝ち上がりでない (引き分けをそのまま確定できる)', () => {
    expect(isKnockoutMatch('league', bracketMatch)).toBe(false);
  });

  it('トーナメントの試合は勝ち上がり', () => {
    expect(isKnockoutMatch('single-elimination', bracketMatch)).toBe(true);
  });

  it('予選のある形式は group の有無で分ける (1つの大会に予選と決勝が同居する)', () => {
    const ms = buildGroupStage(people(4), {
      groupCount: 2, advancePerGroup: 1, doubleRoundRobin: false, thirdPlaceMatch: false,
    });
    const group   = ms.find(m => m.group !== undefined)!;
    const bracket = ms.find(m => m.group === undefined)!;
    expect(isKnockoutMatch('group-then-bracket', group)).toBe(false);
    expect(isKnockoutMatch('group-then-bracket', bracket)).toBe(true);
  });
});

describe('isGroupStageDone', () => {
  const groupMatches = () => resolveMatches(buildGroupStage(people(4), {
    groupCount: 2, advancePerGroup: 1, doubleRoundRobin: false, thirdPlaceMatch: false,
  }));

  it('予選が1つでも残っていれば false', () => {
    expect(isGroupStageDone(groupMatches())).toBe(false);
  });

  it('予選が無い大会では false (「終わった」とは言えない)', () => {
    expect(isGroupStageDone(resolveMatches(buildBracket(people(4), OPTS)))).toBe(false);
  });

  it('予選を全部消化すれば true', () => {
    let ms = groupMatches();
    for (const m of ms.filter(x => x.group !== undefined)) ms = play(ms, m.id, 0);
    expect(isGroupStageDone(ms)).toBe(true);
  });
});

describe('blockedByQualifiers', () => {
  const ms = resolveMatches(buildGroupStage(people(4), {
    groupCount: 2, advancePerGroup: 1, doubleRoundRobin: false, thirdPlaceMatch: false,
  }));
  const group   = ms.find(m => m.group !== undefined)!;
  const bracket = ms.find(m => m.group === undefined)!;

  it('確定前は決勝トーナメントの試合を塞ぐ', () => {
    expect(blockedByQualifiers('group-then-bracket', bracket, false)).toBe(true);
  });

  it('予選の試合は塞がない', () => {
    expect(blockedByQualifiers('group-then-bracket', group, false)).toBe(false);
  });

  it('確定後は塞がない', () => {
    expect(blockedByQualifiers('group-then-bracket', bracket, true)).toBe(false);
  });

  it('予選を持たない形式では常に塞がない', () => {
    expect(blockedByQualifiers('single-elimination', bracket, false)).toBe(false);
  });
});

// ── 運営が次に押すもの ────────────────────────────────────────────────────────

const CPU: ResolvedParticipant = {
  id: 'p01', name: 'T1', seed: 1, programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
};

function stageOf(format: TournamentFormat): StageRules {
  const map = { catalogId: null, bracketStages: [] };
  if (format === 'league') return { format, map, league: { points: DEFAULT_LEAGUE_POINTS, doubleRoundRobin: false } };
  if (format === 'group-then-bracket') {
    return {
      format, map, thirdPlaceMatch: false, groupCount: 2, advancePerGroup: 1,
      league: { points: DEFAULT_LEAGUE_POINTS, doubleRoundRobin: false },
      qualifyingDoubleMode: false, groupScheduleMode: 'parallel',
    };
  }
  if (format === 'bot-then-bracket') {
    return {
      format, map, thirdPlaceMatch: false, advanceCount: 2,
      bot: { program: null, name: null, map: 'm', participantSide: 0 },
      qualifyingDoubleMode: false,
    };
  }
  return { format, map, thirdPlaceMatch: false };
}

function payload(
  matches: TournamentMatch[],
  over: Partial<TournamentStatePayload> = {},
  format: TournamentFormat = 'single-elimination',
): TournamentStatePayload {
  return {
    tournamentId: 'cup',
    name:         'テスト杯',
    ruleSet:      'maizuru',
    match:        { doubleMode: false },
    stage:        stageOf(format),
    // 出場者は全員 内蔵CPU にしておく (プログラム未登録の判定に引っかからないように)
    participants: people(8).map((p, i) => ({ ...CPU, id: p.id, name: p.name, seed: i + 1 })),
    matches,
    standings: null, groups: null, qualifiers: null, qualifierCandidates: null,
    qualifiersConfirmed: false,
    displayView: 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    armedMatchId: null,
    boundRoomId: 'room',
    updatedAt: 0,
    ...over,
  };
}

describe('nextOperatorAction', () => {
  it('未実施なら次の試合を準備する', () => {
    const ms = resolveMatches(buildBracket(people(4), OPTS));
    expect(nextOperatorAction(payload(ms))).toEqual({ kind: 'arm', match: ms[0] });
  });

  it('準備済みならそれを始める', () => {
    const ms = resolveMatches(buildBracket(people(4), OPTS))
      .map(m => (m.id === 'SF1' ? { ...m, status: 'armed' as const } : m));
    const action = nextOperatorAction(payload(ms, { armedMatchId: 'SF1' }));
    expect(action).toMatchObject({ kind: 'start', match: { id: 'SF1' } });
  });

  it('確定待ちが最優先 (飛ばすと次の試合を準備してしまう)', () => {
    let ms = resolveMatches(buildBracket(people(4), OPTS));
    ms = captureResult(ms, 'SF1', result(0));
    // SF2 は ready のままだが、確定待ちが先に来る
    expect(nextOperatorAction(payload(ms))).toMatchObject({ kind: 'confirm', match: { id: 'SF1' } });
  });

  it('全部終われば finished', () => {
    let ms = resolveMatches(buildBracket(people(2), OPTS));
    ms = play(ms, 'FINAL', 0);
    expect(nextOperatorAction(payload(ms))).toEqual({ kind: 'finished' });
  });

  it('出場者にプログラムが無ければ、準備の前に割り当てを促す', () => {
    const ms = resolveMatches(buildBracket(people(4), OPTS));
    const state = payload(ms, {
      participants: people(8).map((p, i) => ({
        ...CPU, id: p.id, name: p.name, seed: i + 1, builtinCpu: false, programName: null,
      })),
    });
    const action = nextOperatorAction(state);
    expect(action.kind).toBe('assign-programs');
    if (action.kind !== 'assign-programs') return;
    expect(action.participants.map(p => p.id)).toEqual([ms[0]!.resolvedA, ms[0]!.resolvedB]);
  });

  describe('予選のある形式', () => {
    // group-rank を解くには「どのリーグに誰がいるか」の文脈が要る
    const CTX = { groups: [['p01', 'p03'], ['p02', 'p04']], rankBy: 'league-points' as const };
    const build = () => resolveMatches(
      buildGroupStage(people(4), {
        groupCount: 2, advancePerGroup: 1, doubleRoundRobin: false, thirdPlaceMatch: false,
      }), Date.now(), CTX);

    /** 予選を全部 slotA の勝ちで終わらせる */
    const finishGroups = () => {
      let ms = build();
      for (const m of ms.filter(x => x.group !== undefined)) {
        ms = confirmResult(captureResult(ms, m.id, result(0), CTX), m.id, {}, Date.now(), CTX);
      }
      return ms;
    };

    it('予選が終われば決勝進出者の確定を促す', () => {
      expect(nextOperatorAction(payload(finishGroups(), {}, 'group-then-bracket')))
        .toEqual({ kind: 'confirm-qualifiers' });
    });

    it('確定すれば決勝トーナメントの試合を準備できる', () => {
      const action = nextOperatorAction(
        payload(finishGroups(), { qualifiersConfirmed: true }, 'group-then-bracket'));
      expect(action.kind).toBe('arm');
      if (action.kind !== 'arm') return;
      expect(action.match.group).toBeUndefined();
    });

    it('予選の途中では予選の試合を案内する', () => {
      const action = nextOperatorAction(payload(build(), {}, 'group-then-bracket'));
      expect(action.kind).toBe('arm');
      if (action.kind !== 'arm') return;
      expect(action.match.group).toBeDefined();
    });
  });
});
