import { describe, it, expect } from 'vitest';
import { leagueRulesOf } from '@u15/ws-types';
import { DefinitionError, parseTournamentDefinition } from './definition.js';

const OK = {
  name: 'テスト大会',
  participants: [
    { id: 'p1', name: 'A', seed: 1, program: { file: 'programs/a.py' } },
    { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
  ],
};

function parse(raw: unknown, fallbackId = 'cup') {
  return parseTournamentDefinition(raw, { fallbackId });
}

describe('parseTournamentDefinition', () => {
  it('最小構成を読める', () => {
    const def = parse(OK);
    expect(def.id).toBe('cup');
    expect(def.name).toBe('テスト大会');
    expect(def.stage.format).toBe('single-elimination');
    expect(def.participants).toHaveLength(2);
    expect(def.participants[0]!.program).toEqual({ kind: 'file', file: 'programs/a.py' });
    expect(def.participants[1]!.program).toEqual({ kind: 'builtin', builtin: 'cpu' });
  });

  it('match / stage は既定値で埋まる', () => {
    const def = parse(OK);
    expect(def.match).toEqual({ doubleMode: true });
    expect(def.stage).toEqual({
      format:          'single-elimination',
      map:             { catalogId: null, bracketStages: [] },
      thirdPlaceMatch: false,
    });
  });

  it('形式が意味を持たない設定は捨てる', () => {
    // 他の形式の項目が書いてあっても、トーナメントには持ち込まない
    const def = parse({ ...OK, stage: { league: { doubleRoundRobin: true } } });
    expect(def.stage).not.toHaveProperty('league');
  });

  describe('stage.map.bracketStages (回戦ごとのマップ)', () => {
    const withStages = (bracketStages: unknown) =>
      parse({ ...OK, stage: { map: { bracketStages } } }).stage.map.bracketStages;

    it('マップ ID と null の配列を読める', () => {
      expect(withStages(['m1', null, 'm2'])).toEqual(['m1', null, 'm2']);
    });

    it('空文字は「大会の設定に従う」(null) として扱う', () => {
      expect(withStages(['', 'm2'])).toEqual([null, 'm2']);
    });

    it('配列でなければエラー', () => {
      expect(() => withStages('m1')).toThrow(/bracketStages は配列/);
    });

    it('要素が文字列でも null でもなければエラー', () => {
      expect(() => withStages([1])).toThrow(/bracketStages\[0\]/);
    });
  });

  it('id 省略時はフォルダ名を使う', () => {
    expect(parse(OK, 'maizuru-2026').id).toBe('maizuru-2026');
  });

  it('participant の id 省略時は名前から作る', () => {
    const def = parse({ name: 'x', participants: [{ name: 'Team Alpha', program: null }] });
    expect(def.participants[0]!.id).toBe('team-alpha');
  });

  it('program: null (未提出) を許す', () => {
    const def = parse({ name: 'x', participants: [{ id: 'a', name: 'A', program: null }] });
    expect(def.participants[0]!.program).toBeNull();
  });

  it('program 省略も未提出として扱う', () => {
    const def = parse({ name: 'x', participants: [{ id: 'a', name: 'A' }] });
    expect(def.participants[0]!.program).toBeNull();
  });

  describe('エラー', () => {
    it('participants が無い', () => {
      expect(() => parse({ name: 'x' })).toThrow(DefinitionError);
      expect(() => parse({ name: 'x' })).toThrow(/participants は配列/);
    });

    it('participants が空', () => {
      expect(() => parse({ name: 'x', participants: [] })).toThrow(/participants が空/);
    });

    it('name が空', () => {
      expect(() => parse({ name: 'x', participants: [{ id: 'a', name: '' }] }))
        .toThrow(/participants\[0\]\.name/);
    });

    it('id の重複', () => {
      expect(() => parse({
        name: 'x',
        participants: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }],
      })).toThrow(/id "a" が重複/);
    });

    it('seed の重複', () => {
      expect(() => parse({
        name: 'x',
        participants: [{ id: 'a', name: 'A', seed: 1 }, { id: 'b', name: 'B', seed: 1 }],
      })).toThrow(/seed 1 が重複/);
    });

    it('seed が0以下', () => {
      expect(() => parse({ name: 'x', participants: [{ id: 'a', name: 'A', seed: 0 }] }))
        .toThrow(/seed は1以上の整数/);
    });

    it('未知の format', () => {
      expect(() => parse({ ...OK, format: 'swiss' })).toThrow(/format は/);
    });

    it('builtin が cpu 以外', () => {
      expect(() => parse({
        name: 'x', participants: [{ id: 'a', name: 'A', program: { builtin: 'gpu' } }],
      })).toThrow(/builtin は "cpu" のみ/);
    });

    it('program に file も builtin も無い', () => {
      expect(() => parse({
        name: 'x', participants: [{ id: 'a', name: 'A', program: { foo: 1 } }],
      })).toThrow(/file か builtin/);
    });

    it('program.file のパストラバーサルを弾く', () => {
      for (const file of ['../secret.py', '/etc/passwd', 'C:\\win.py', 'a/../../b.py']) {
        expect(() => parse({
          name: 'x', participants: [{ id: 'a', name: 'A', program: { file } }],
        })).toThrow(/相対パスで指定/);
      }
    });

    it('bracket.slots に未知の participant', () => {
      expect(() => parse({ ...OK, bracket: { slots: ['p1', 'p9'] } }))
        .toThrow(/"p9" に一致する participant がいません/);
    });

    it('schedule.pairs が同じ participant 同士', () => {
      expect(() => parse({ ...OK, format: 'league', schedule: { pairs: [['p1', 'p1']] } }))
        .toThrow(/同じ participant 同士/);
    });
  });

  it('bracket.slots の null (bye) は許す', () => {
    const def = parse({ ...OK, bracket: { slots: ['p1', null, 'p2', null] } });
    expect(def.bracket!.slots).toEqual(['p1', null, 'p2', null]);
  });

  it('league の schedule.pairs を読める', () => {
    const def = parse({ ...OK, format: 'league', schedule: { pairs: [['p1', 'p2']] } });
    expect(def.schedule!.pairs).toEqual([['p1', 'p2']]);
  });

  it('勝ち点を上書きできる', () => {
    const def = parse({
      ...OK, format: 'league', stage: { league: { points: { win: 2, draw: 1, loss: -1 } } },
    });
    expect(leagueRulesOf(def.stage)?.points).toEqual({ win: 2, draw: 1, loss: -1 });
  });
});

describe('予選リーグ + 決勝トーナメント', () => {
  const GROUP_OK = {
    name: '予選あり大会',
    format: 'group-then-bracket',
    participants: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`, name: `T${i + 1}`, program: null,
    })),
  };
  const parseGroup = (o: Record<string, unknown>) =>
    parseTournamentDefinition({ ...GROUP_OK, ...o }, { fallbackId: 'cup' });

  it('groupCount / advancePerGroup は既定 2/2', () => {
    const stage = parseGroup({}).stage;
    expect(stage).toMatchObject({ groupCount: 2, advancePerGroup: 2 });
  });

  it('participants[].group を読む', () => {
    const def = parseGroup({
      participants: GROUP_OK.participants.map((p, i) => (i === 0 ? { ...p, group: 1 } : p)),
    });
    expect(def.participants[0]!.group).toBe(1);
    expect(def.participants[1]!.group).toBeUndefined();
  });

  it('リーグ数が2未満なら弾く', () => {
    expect(() => parseGroup({ stage: { groupCount: 1 } })).toThrow(/groupCount/);
  });

  it('進出人数が0以下なら弾く', () => {
    expect(() => parseGroup({ stage: { advancePerGroup: 0 } })).toThrow(/advancePerGroup/);
  });

  it('各リーグ2人に満たない人数なら弾く', () => {
    expect(() => parseGroup({
      participants: GROUP_OK.participants.slice(0, 3),
    })).toThrow(/最低4人/);
  });

  it('範囲外の group を弾く', () => {
    expect(() => parseGroup({
      participants: GROUP_OK.participants.map((p, i) => (i === 0 ? { ...p, group: 2 } : p)),
    })).toThrow(/group は 0〜1/);
  });

  it('1回戦は予選の結果で決まるので bracket / schedule は指定できない', () => {
    expect(() => parseGroup({ bracket: { slots: ['p1', 'p2'] } })).toThrow(/bracket/);
    expect(() => parseGroup({ schedule: { pairs: [['p1', 'p2']] } })).toThrow(/schedule/);
  });
});

describe('BOT対戦予選 + 決勝トーナメント', () => {
  const BOT_OK = {
    name: 'BOT予選大会',
    format: 'bot-then-bracket',
    stage: { bot: { map: 'map-1' }, advanceCount: 4 },
    participants: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`, name: `T${i + 1}`, program: null,
    })),
  };

  /** stage は1階層深いので、上書きも stage 単位でマージする */
  const parseBot = (stage: Record<string, unknown> = {}, o: Record<string, unknown> = {}) =>
    parseTournamentDefinition(
      {
        ...BOT_OK, ...o,
        stage: { ...BOT_OK.stage, ...stage, bot: { ...BOT_OK.stage.bot, ...(stage['bot'] as object ?? {}) } },
      },
      { fallbackId: 'cup' },
    );

  const botStage = (stage: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
    const s = parseBot(stage, o).stage;
    if (s.format !== 'bot-then-bracket') throw new Error('bot-then-bracket として読めていない');
    return s;
  };

  it('最小構成を読める', () => {
    const s = botStage();
    expect(s.bot.map).toBe('map-1');
    expect(s.advanceCount).toBe(4);
  });

  it('bot.program を参加者と同じ書式で読む', () => {
    expect(botStage({ bot: { program: { file: 'programs/bot.py' } } }).bot.program)
      .toEqual({ kind: 'file', file: 'programs/bot.py' });
    expect(botStage({ bot: { program: { builtin: 'cpu' } } }).bot.program)
      .toEqual({ kind: 'builtin', builtin: 'cpu' });
  });

  it('bot.name は空文字なら null (既定名にフォールバックさせる)', () => {
    expect(botStage({ bot: { name: '運営くん' } }).bot.name).toBe('運営くん');
    expect(botStage({ bot: { name: '  ' } }).bot.name).toBeNull();
  });

  it('participantSide は 0 (先攻) が既定で、1 のときだけ後攻になる', () => {
    expect(botStage().bot.participantSide).toBe(0);
    expect(botStage({ bot: { participantSide: 1 } }).bot.participantSide).toBe(1);
    // 想定外の値は先攻に倒す (壊れた定義でも読めなくしない)
    expect(botStage({ bot: { participantSide: 7 } }).bot.participantSide).toBe(0);
  });

  it('マップが決まっていなければ弾く (全参加者同一条件がこの形式の根拠)', () => {
    expect(() => parseBot({ bot: { map: null } })).toThrow(/同じマップ/);
    // 大会全体の固定マップでもよい
    expect(() => parseBot({ bot: { map: null }, map: { catalogId: 'map-9' } })).not.toThrow();
  });

  it('進出人数が2未満なら弾く (決勝が組めない)', () => {
    expect(() => parseBot({ advanceCount: 1 })).toThrow(/advanceCount/);
  });

  it('進出人数に参加者が足りなければ弾く', () => {
    expect(() => parseBot({ advanceCount: 4 }, {
      participants: BOT_OK.participants.slice(0, 3),
    })).toThrow(/参加者が足りません/);
  });

  it('BOT プログラム未提出は許す (当日割り当てるため)', () => {
    expect(botStage().bot.program).toBeNull();
  });

  it('対戦カードは自動生成なので bracket / schedule は指定できない', () => {
    expect(() => parseBot({}, { bracket: { slots: ['p1', 'p2'] } })).toThrow(/bracket/);
    expect(() => parseBot({}, { schedule: { pairs: [['p1', 'p2']] } })).toThrow(/schedule/);
  });
});
