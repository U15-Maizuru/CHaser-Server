import type {
  LeaguePoints,
  ParticipantDef,
  ParticipantProgram,
  TournamentDefinition,
  TournamentFormat,
  TournamentRules,
} from '@u15/ws-types';

// tournament.json の手書きバリデータ。
// 既存方針どおりスキーマライブラリ (zod 等) は導入せず、日本語のエラーメッセージを返す。

export class DefinitionError extends Error {}

const DEFAULT_LEAGUE_POINTS: LeaguePoints = { win: 3, draw: 1, loss: 0 };

const FORMATS: TournamentFormat[] = ['single-elimination', 'league'];

function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new DefinitionError(`${where} はオブジェクトである必要があります`);
  }
  return v as Record<string, unknown>;
}

function asString(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new DefinitionError(`${where} は空でない文字列である必要があります`);
  }
  return v.trim();
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 表示名から id を作る (id 省略時のフォールバック) */
function slugify(name: string, index: number): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '');
  return s === '' ? `p${index + 1}` : s;
}

function parseProgram(v: unknown, where: string): ParticipantProgram {
  if (v === null || v === undefined) return null;
  const o = asRecord(v, where);

  if (typeof o['builtin'] === 'string') {
    if (o['builtin'] !== 'cpu') {
      throw new DefinitionError(`${where}.builtin は "cpu" のみ指定できます (実際の値: ${String(o['builtin'])})`);
    }
    return { kind: 'builtin', builtin: 'cpu' };
  }

  if (typeof o['file'] === 'string') {
    const file = asString(o['file'], `${where}.file`);
    if (file.includes('..') || file.startsWith('/') || file.startsWith('\\') || /^[a-zA-Z]:/.test(file)) {
      throw new DefinitionError(`${where}.file は大会フォルダ内の相対パスで指定してください (実際の値: ${file})`);
    }
    const displayName = typeof o['displayName'] === 'string' ? o['displayName'] : undefined;
    return displayName === undefined ? { kind: 'file', file } : { kind: 'file', file, displayName };
  }

  throw new DefinitionError(`${where} には file か builtin のどちらかを指定してください`);
}

function parseRules(v: unknown): TournamentRules {
  const o = v === undefined ? {} : asRecord(v, 'rules');
  const lp = o['leaguePoints'] === undefined
    ? DEFAULT_LEAGUE_POINTS
    : (() => {
        const p = asRecord(o['leaguePoints'], 'rules.leaguePoints');
        return {
          win:  asNumber(p['win'],  DEFAULT_LEAGUE_POINTS.win),
          draw: asNumber(p['draw'], DEFAULT_LEAGUE_POINTS.draw),
          loss: asNumber(p['loss'], DEFAULT_LEAGUE_POINTS.loss),
        };
      })();

  return {
    doubleMode:       asBool(o['doubleMode'], true),
    mapCatalogId:     typeof o['mapCatalogId'] === 'string' ? o['mapCatalogId'] : null,
    thirdPlaceMatch:  asBool(o['thirdPlaceMatch'], false),
    leaguePoints:     lp,
    doubleRoundRobin: asBool(o['doubleRoundRobin'], false),
  };
}

function parseParticipants(v: unknown): ParticipantDef[] {
  if (!Array.isArray(v)) {
    throw new DefinitionError('participants は配列である必要があります');
  }
  if (v.length === 0) {
    throw new DefinitionError('participants が空です。参加者を1人以上登録してください');
  }

  const seen  = new Set<string>();
  const seeds = new Set<number>();

  return v.map((raw, i) => {
    const o    = asRecord(raw, `participants[${i}]`);
    const name = asString(o['name'], `participants[${i}].name`);
    const id   = typeof o['id'] === 'string' && o['id'].trim() !== ''
      ? o['id'].trim()
      : slugify(name, i);

    if (seen.has(id)) {
      throw new DefinitionError(`participants[${i}].id "${id}" が重複しています`);
    }
    seen.add(id);

    let seed: number | undefined;
    if (o['seed'] !== undefined && o['seed'] !== null) {
      if (typeof o['seed'] !== 'number' || !Number.isInteger(o['seed']) || o['seed'] < 1) {
        throw new DefinitionError(`participants[${i}].seed は1以上の整数である必要があります`);
      }
      if (seeds.has(o['seed'])) {
        throw new DefinitionError(`participants[${i}].seed ${o['seed']} が重複しています`);
      }
      seeds.add(o['seed']);
      seed = o['seed'];
    }

    const program = parseProgram(o['program'], `participants[${i}].program`);
    return seed === undefined ? { id, name, program } : { id, name, seed, program };
  });
}

export interface ParseOptions {
  /** id 省略時に使うフォルダ名 */
  fallbackId?: string;
}

/** tournament.json をパースして検証する。失敗時は DefinitionError を投げる */
export function parseTournamentDefinition(raw: unknown, opts: ParseOptions = {}): TournamentDefinition {
  const o = asRecord(raw, 'tournament.json');

  const format = o['format'] === undefined ? 'single-elimination' : o['format'];
  if (typeof format !== 'string' || !FORMATS.includes(format as TournamentFormat)) {
    throw new DefinitionError(
      `format は ${FORMATS.map(f => `"${f}"`).join(' か ')} を指定してください (実際の値: ${String(format)})`,
    );
  }

  const id = typeof o['id'] === 'string' && o['id'].trim() !== ''
    ? o['id'].trim()
    : opts.fallbackId;
  if (!id) {
    throw new DefinitionError('id が指定されておらず、フォルダ名からも決められません');
  }

  const name         = asString(o['name'] ?? id, 'name');
  const participants = parseParticipants(o['participants']);
  const rules        = parseRules(o['rules']);
  const ids          = new Set(participants.map(p => p.id));

  const def: TournamentDefinition = {
    formatVersion: asNumber(o['formatVersion'], 1),
    id, name, format: format as TournamentFormat, rules, participants,
  };

  if (o['bracket'] !== undefined && o['bracket'] !== null) {
    const b     = asRecord(o['bracket'], 'bracket');
    const slots = b['slots'];
    if (!Array.isArray(slots)) {
      throw new DefinitionError('bracket.slots は配列である必要があります');
    }
    const parsed = slots.map((s, i) => {
      if (s === null) return null;
      if (typeof s !== 'string') {
        throw new DefinitionError(`bracket.slots[${i}] は participant の id か null である必要があります`);
      }
      if (!ids.has(s)) {
        throw new DefinitionError(`bracket.slots[${i}] の "${s}" に一致する participant がいません`);
      }
      return s;
    });
    def.bracket = { size: asNumber(b['size'], parsed.length), slots: parsed };
  }

  if (o['schedule'] !== undefined && o['schedule'] !== null) {
    const s     = asRecord(o['schedule'], 'schedule');
    const pairs = s['pairs'];
    if (!Array.isArray(pairs)) {
      throw new DefinitionError('schedule.pairs は配列である必要があります');
    }
    def.schedule = {
      pairs: pairs.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) {
          throw new DefinitionError(`schedule.pairs[${i}] は [id, id] の2要素配列である必要があります`);
        }
        for (const x of p) {
          if (typeof x !== 'string' || !ids.has(x)) {
            throw new DefinitionError(`schedule.pairs[${i}] の "${String(x)}" に一致する participant がいません`);
          }
        }
        if (p[0] === p[1]) {
          throw new DefinitionError(`schedule.pairs[${i}] が同じ participant 同士になっています`);
        }
        return [p[0], p[1]] as [string, string];
      }),
    };
  }

  return def;
}
