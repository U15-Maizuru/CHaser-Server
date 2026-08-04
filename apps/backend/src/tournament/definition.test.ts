import { describe, it, expect } from 'vitest';
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
    expect(def.format).toBe('single-elimination');
    expect(def.participants).toHaveLength(2);
    expect(def.participants[0]!.program).toEqual({ kind: 'file', file: 'programs/a.py' });
    expect(def.participants[1]!.program).toEqual({ kind: 'builtin', builtin: 'cpu' });
  });

  it('rules は既定値で埋まる', () => {
    const def = parse(OK);
    expect(def.rules).toEqual({
      doubleMode: true,
      mapCatalogId: null,
      stageMaps: [],
      thirdPlaceMatch: false,
      leaguePoints: { win: 3, draw: 1, loss: 0 },
      doubleRoundRobin: false,
    });
  });

  describe('rules.stageMaps (回戦ごとのマップ)', () => {
    const withStageMaps = (stageMaps: unknown) => parse({ ...OK, rules: { stageMaps } });

    it('マップ ID と null の配列を読める', () => {
      expect(withStageMaps(['m1', null, 'm2']).rules.stageMaps).toEqual(['m1', null, 'm2']);
    });

    it('空文字は「大会の設定に従う」(null) として扱う', () => {
      expect(withStageMaps(['', 'm2']).rules.stageMaps).toEqual([null, 'm2']);
    });

    it('配列でなければエラー', () => {
      expect(() => withStageMaps('m1')).toThrow(/rules.stageMaps は配列/);
    });

    it('要素が文字列でも null でもなければエラー', () => {
      expect(() => withStageMaps([1])).toThrow(/rules.stageMaps\[0\]/);
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

  it('leaguePoints を上書きできる', () => {
    const def = parse({ ...OK, rules: { leaguePoints: { win: 2, draw: 1, loss: -1 } } });
    expect(def.rules.leaguePoints).toEqual({ win: 2, draw: 1, loss: -1 });
  });
});
