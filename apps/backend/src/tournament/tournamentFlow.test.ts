import { describe, it, expect } from 'vitest';
import type {
  ParticipantDef, ResolvedParticipant, StageRules, TournamentFormat,
  TournamentMatch, TournamentMatchResult, TournamentStatePayload,
} from '@u15/ws-types';
import {
  DEFAULT_LEAGUE_POINTS, blockedByQualifiers, isGroupStageDone, isKnockoutMatch,
  compareByPlayOrder, nextOperatorAction, nextReadyMatch, playedCountOf,
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

/**
 * `nextReadyMatch` の案内どおりに (毎回 slotA の勝ちで) 進める。
 *
 * 返すのは**案内された順の試合**と、そこまで進めた試合グラフ。
 * `takeWhile` が false を返したところで止まる (段の途中まで見たいとき)。
 */
function playThrough(
  ms: TournamentMatch[], takeWhile: (m: TournamentMatch, i: number) => boolean = () => true,
): { order: TournamentMatch[]; matches: TournamentMatch[] } {
  const order: TournamentMatch[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const m = nextReadyMatch(ms);
    if (!m || !takeWhile(m, order.length)) break;
    order.push(m);
    ms = play(ms, m.id, 0);
  }
  return { order, matches: ms };
}

/** そのカードで最も消化試合数が少ない人の消化数 (nextReadyMatch の2番目の鍵) */
function behindOf(ms: TournamentMatch[]): (m: TournamentMatch) => number {
  const played = playedCountOf(ms);
  return m => Math.min(played.get(m.resolvedA!) ?? 0, played.get(m.resolvedB!) ?? 0);
}

describe('nextReadyMatch', () => {
  it('弱いほうの選手が弱いカードから消化する (8人なら 1-8 → 2-7 → 3-6 → 4-5)', () => {
    const { order, matches } = playThrough(
      resolveMatches(buildBracket(people(8), OPTS)), (_, i) => i < 4);
    expect(order.map(m => `${m.resolvedA}v${m.resolvedB}`))
      .toEqual(['p01vp08', 'p02vp07', 'p03vp06', 'p04vp05']);
    // 準決勝も同じ規則。想定は 1位-4位 と 2位-3位 なので、弱い4位を含むほうが先
    expect(nextReadyMatch(matches)!.id).toBe('SF1');
  });

  it('実施順は常に試合番号の昇順になる (番号を実施順そのものに振っているため)', () => {
    for (const n of [4, 8, 16, 32]) {
      const { order } = playThrough(
        resolveMatches(buildBracket(people(n), OPTS)), m => m.stage === 0);
      // ラベル「1回戦 第N試合」/「準々決勝 第N試合」から N を取る
      const nums = order.map(m => Number(/第(\d+)試合/.exec(m.label)?.[1] ?? 1));
      expect({ n, nums }).toEqual({ n, nums: [...nums].sort((a, b) => a - b) });
    }
  });

  it('実施順は、どのブロックでも下半分が上半分の180°回転になっている', () => {
    // 番号付けが再帰的点対称なので、実施順もブロック内では鏡像になる
    // (ブロックをまたいで交互に進むが、各ブロックの中の相対順序は上下で逆になる)
    for (const n of [4, 8, 16, 32]) {
      const ms = resolveMatches(buildBracket(people(n), OPTS));
      const stage0 = ms.filter(m => m.stage === 0);
      if (stage0.length < 2) continue;

      // その段を消化しきるまでの実施順を、表示位置 (order) の列として拾う
      const seq = playThrough(ms, m => m.stage === 0).order.map(m => m.order);
      expect(seq.length).toBe(stage0.length);

      // 上半分の実施順 (局所位置) を180°回すと、下半分の実施順に一致する
      const check = (positions: number[], base: number, size: number, path: string) => {
        if (size < 2) return;
        const half  = size / 2;
        const local = positions.map(p => p - base);
        const upper = local.filter(p => p < half);
        const lower = local.filter(p => p >= half).map(p => p - half);
        expect({ n, path, ok: lower.every((p, i) => p === half - 1 - upper[i]!) })
          .toEqual({ n, path, ok: true });
        check(positions.filter(p => p - base < half), base, half, path + '上');
        check(positions.filter(p => p - base >= half), base + half, half, path + '下');
      };
      check(seq, 0, stage0.length, '');
    }
  });

  it('開始時に両者が決まっているカードを、勝ち上がり待ちより先に案内する', () => {
    // 9人の2回戦。1回戦を戦った選手 (8位) を含むカードだけが勝ち上がり待ちなので、
    // 残る3試合を先に消化して1試合ぶんの間を空ける。
    // この混在が起きるのは実質2回戦だけ (bye は1回戦にしか無い)
    const { order } = playThrough(
      resolveMatches(buildBracket(people(9), OPTS)), (_, i) => i < 5);
    expect(order.map(m => `${m.resolvedA}v${m.resolvedB}`)).toEqual([
      'p08vp09',                         // 1回戦 (実戦はこれだけ)
      'p02vp07', 'p03vp06', 'p04vp05',   // 2回戦のうち開始時に両者が決まっているもの
      'p01vp08',                         // 8位-9位 の勝者を待っていたカード
    ]);
  });

  it('同じ回戦では、消化試合数が少ない出場者の試合を先に案内する', () => {
    // 5人 = サイズ8・bye3つ。1回戦で実際に戦うのは1カードだけなので、
    // 準決勝の時点で「1試合こなした人」と「まだ0試合の人」が混ざる
    let ms = resolveMatches(buildBracket(people(5), OPTS));
    const first = nextReadyMatch(ms)!;
    ms = play(ms, first.id, 0);

    // 準決勝は2つとも ready。両者とも0試合のカードを先に案内する
    // (1試合こなした人が絡む SF を先にやると、その勝者が2試合・待つ人が0試合で差2になる)
    const next   = nextReadyMatch(ms)!;
    const behind = behindOf(ms);
    const others = ms.filter(m => m.status === 'ready' && m.id !== next.id);
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) expect(behind(next)).toBeLessThanOrEqual(behind(o));
  });

  it('どの人数でも、消化試合数の少ない人がいるカードを追い越さない', () => {
    // 位置だけでは満たせない: 14人の準々決勝は上から 4人/3人/4人/3人 になり、
    // 左の下ブロック(3人)が右の上ブロック(4人)より上に来るので、
    // 下から取るだけだと遅れている人を追い越す
    for (let n = 2; n <= 32; n++) {
      let ms = resolveMatches(buildBracket(people(n), OPTS));
      for (let guard = 0; guard < 100; guard++) {
        const ready = ms.filter(m => m.status === 'ready');
        if (ready.length === 0) break;
        const next   = nextReadyMatch(ms)!;
        const behind = behindOf(ms);
        const rivals = ready.filter(m => m.stage === next.stage);
        expect({ n, id: next.id, ok: rivals.every(m => behind(next) <= behind(m)) })
          .toEqual({ n, id: next.id, ok: true });
        ms = play(ms, next.id, 0);
      }
    }
  });

  it('不戦勝は消化試合数に数えない', () => {
    // 3人 = サイズ4・bye1つ。bye で勝ち上がった人は0試合のまま
    let ms = resolveMatches(buildBracket(people(3), OPTS));
    const sf = nextReadyMatch(ms)!;
    ms = play(ms, sf.id, 0);
    const counts = playedCountOf(ms);
    const byeMatch = ms.find(m => m.byeA || m.byeB)!;
    const advanced = byeMatch.byeA ? byeMatch.resolvedB : byeMatch.resolvedA;
    expect(counts.get(advanced!) ?? 0).toBe(0);
  });

  it('試合一覧の並び (compareByPlayOrder) と実際の進行が一致する', () => {
    // 運営パネルの一覧・結果CSV・次の試合の選定はすべて compareByPlayOrder を通す。
    // 別々に並べ替えを書くとここがズレて、一覧が 第1・第4・第3・第2 のような順になる
    for (const n of [4, 8, 16, 32]) {
      const ms     = resolveMatches(buildBracket(people(n), { thirdPlaceMatch: true }));
      const listed = [...ms].sort(compareByPlayOrder).map(m => m.id);
      const actual = playThrough(ms).order.map(m => m.id);
      expect({ n, actual }).toEqual({ n, actual: listed });
    }
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
    // 案内するのは nextReadyMatch が選んだ試合 (表の先頭とは限らない)
    const next = nextReadyMatch(ms)!;
    expect(nextOperatorAction(payload(ms))).toEqual({ kind: 'arm', match: next });
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
    const next = nextReadyMatch(ms)!;
    expect(action.participants.map(p => p.id)).toEqual([next.resolvedA, next.resolvedB]);
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
