import type {
  BotStageRules,
  LeaguePoints,
  LeagueRules,
  MapPlan,
  ParticipantDef,
  ParticipantProgram,
  StageRules,
  TournamentDefinition,
  TournamentFormat,
} from '@u15/ws-types';
import { DEFAULT_LEAGUE_POINTS } from '@u15/ws-types';

// tournament.json の手書きバリデータ。
// スキーマライブラリは導入せず、運営がそのまま読める日本語のエラーメッセージを返す。

export class DefinitionError extends Error {}

const FORMATS: TournamentFormat[] = [
  'single-elimination', 'league', 'group-then-bracket', 'bot-then-bracket',
];

const DEFAULT_GROUP_COUNT       = 2;
const DEFAULT_ADVANCE_PER_GROUP = 2;

function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new DefinitionError(`${where} はオブジェクトである必要があります`);
  }
  return v as Record<string, unknown>;
}

/**
 * format はトップレベルに書く運用 (手書きの tournament.json、docs/user-manual.md の例) と
 * stage.format にしか無い運用 (`StageRules` が判別共用体なので、型どおりに組み立てる
 * 大会作成 UI はここにしか書かない) の両方を受け付ける。トップレベルを優先し、
 * 無ければ stage.format を見る。
 */
function readFormat(o: Record<string, unknown>): unknown {
  const stage = o['stage'];
  const nested = typeof stage === 'object' && stage !== null && !Array.isArray(stage)
    ? (stage as Record<string, unknown>)['format']
    : undefined;
  return o['format'] ?? nested;
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

/** 空文字と未指定を null に寄せる (「指定なし」の表現を1つに保つ) */
function asIdOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
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

/**
 * マップの指定。
 *
 * マップライブラリの ID はこの PC でしか通じないため、存在チェックはしない
 * (別の PC で書かれた tournament.json を読めなくしないため)。見つからない ID は
 * ServerManager.loadMap 側で黙って無視され、ランダム生成にフォールバックする。
 */
function parseMapPlan(v: unknown): MapPlan {
  const o = v === undefined || v === null ? {} : asRecord(v, 'stage.map');
  return {
    catalogId:     asIdOrNull(o['catalogId']),
    bracketStages: parseBracketStages(o['bracketStages']),
  };
}

function parseBracketStages(v: unknown): (string | null)[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new DefinitionError('stage.map.bracketStages は配列である必要があります');
  }
  return v.map((s, i) => {
    if (s === null || s === undefined || s === '') return null;
    if (typeof s !== 'string') {
      throw new DefinitionError(`stage.map.bracketStages[${i}] はマップの ID か null である必要があります`);
    }
    return s;
  });
}

function parseLeagueRules(v: unknown): LeagueRules {
  const o = v === undefined || v === null ? {} : asRecord(v, 'stage.league');
  return {
    points:           parseLeaguePoints(o['points']),
    doubleRoundRobin: asBool(o['doubleRoundRobin'], false),
  };
}

function parseLeaguePoints(v: unknown): LeaguePoints {
  if (v === undefined || v === null) return DEFAULT_LEAGUE_POINTS;
  const p = asRecord(v, 'stage.league.points');
  return {
    win:  asNumber(p['win'],  DEFAULT_LEAGUE_POINTS.win),
    draw: asNumber(p['draw'], DEFAULT_LEAGUE_POINTS.draw),
    loss: asNumber(p['loss'], DEFAULT_LEAGUE_POINTS.loss),
  };
}

function parseBotRules(v: unknown): BotStageRules {
  const o = v === undefined || v === null ? {} : asRecord(v, 'stage.bot');
  return {
    program:         parseProgram(o['program'], 'stage.bot.program'),
    name:            asIdOrNull(o['name']),
    map:             asIdOrNull(o['map']),
    // 0 = 先攻 / 1 = 後攻。それ以外の値は先攻に倒す
    participantSide: o['participantSide'] === 1 ? 1 : 0,
  };
}

/**
 * 形式ごとに意味を持つ設定だけを読む。他の形式の項目が書いてあっても黙って捨てる。
 *
 * `matchDoubleMode` は予選専用の qualifyingDoubleMode を省略したときの既定値に使う。
 * 大会全体の doubleMode に揃えることで、この項目が無い (= 旧仕様の) tournament.json は
 * 予選も決勝も同じゲーム数のまま読める。
 */
function parseStageRules(format: TournamentFormat, v: unknown, matchDoubleMode: boolean): StageRules {
  const o   = v === undefined || v === null ? {} : asRecord(v, 'stage');
  const map = parseMapPlan(o['map']);

  switch (format) {
    case 'single-elimination':
      return { format, map, thirdPlaceMatch: asBool(o['thirdPlaceMatch'], false) };

    case 'league':
      return { format, map, league: parseLeagueRules(o['league']) };

    case 'group-then-bracket':
      return {
        format, map,
        thirdPlaceMatch:      asBool(o['thirdPlaceMatch'], false),
        league:               parseLeagueRules(o['league']),
        groupCount:           asNumber(o['groupCount'],      DEFAULT_GROUP_COUNT),
        advancePerGroup:      asNumber(o['advancePerGroup'], DEFAULT_ADVANCE_PER_GROUP),
        qualifyingDoubleMode: asBool(o['qualifyingDoubleMode'], matchDoubleMode),
        groupScheduleMode:    o['groupScheduleMode'] === 'sequential' ? 'sequential' : 'parallel',
      };

    case 'bot-then-bracket':
      return {
        format, map,
        thirdPlaceMatch:      asBool(o['thirdPlaceMatch'], false),
        bot:                  parseBotRules(o['bot']),
        advanceCount:         asNumber(o['advanceCount'], DEFAULT_ADVANCE_PER_GROUP),
        qualifyingDoubleMode: asBool(o['qualifyingDoubleMode'], matchDoubleMode),
      };
  }
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

    // 所属する予選リーグ。groupCount との突き合わせは stage を読んだあと (validateGroupStage)
    let group: number | undefined;
    if (o['group'] !== undefined && o['group'] !== null) {
      if (typeof o['group'] !== 'number' || !Number.isInteger(o['group']) || o['group'] < 0) {
        throw new DefinitionError(`participants[${i}].group は0以上の整数である必要があります`);
      }
      group = o['group'];
    }

    const program = parseProgram(o['program'], `participants[${i}].program`);
    const base: ParticipantDef = { id, name, program };
    if (seed  !== undefined) base.seed  = seed;
    if (group !== undefined) base.group = group;
    return base;
  });
}

/**
 * 予選リーグの設定を検証する。
 *
 * リーグ分けそのもの (group 省略時の自動振り分け) は groupStage.ts の仕事なので、
 * ここでは「そもそも大会として成立するか」だけを見る。
 */
function validateGroupStage(
  participants: ParticipantDef[],
  stage: Extract<StageRules, { format: 'group-then-bracket' }>,
): void {
  const { groupCount, advancePerGroup } = stage;

  if (!Number.isInteger(groupCount) || groupCount < 2) {
    throw new DefinitionError(`stage.groupCount は2以上の整数である必要があります (実際の値: ${groupCount})`);
  }
  if (!Number.isInteger(advancePerGroup) || advancePerGroup < 1) {
    throw new DefinitionError(`stage.advancePerGroup は1以上の整数である必要があります (実際の値: ${advancePerGroup})`);
  }
  if (participants.length < groupCount * 2) {
    throw new DefinitionError(
      `予選${groupCount}リーグには最低${groupCount * 2}人の参加者が必要です (実際の人数: ${participants.length})`,
    );
  }

  for (const [i, p] of participants.entries()) {
    if (p.group !== undefined && p.group >= groupCount) {
      throw new DefinitionError(
        `participants[${i}].group は 0〜${groupCount - 1} の範囲で指定してください (実際の値: ${p.group})`,
      );
    }
  }
}

/**
 * BOT対戦予選の設定を検証する。
 *
 * この形式の根拠は「運営側はプログラムもマップも全参加者に対して同一」なので、
 * **マップが決まっていないものは大会として成立しない** — ランダム生成のまま走らせると
 * 参加者ごとに違う盤面になり、ポイントで順位を付ける前提が崩れる。
 * BOT プログラム自体は当日割り当てを許す (参加者の未提出と同じ扱い)。
 */
function validateBotStage(
  participants: ParticipantDef[],
  stage: Extract<StageRules, { format: 'bot-then-bracket' }>,
): void {
  const { advanceCount } = stage;

  if (!Number.isInteger(advanceCount) || advanceCount < 2) {
    throw new DefinitionError(
      `stage.advanceCount (決勝トーナメント進出人数) は2以上の整数である必要があります (実際の値: ${advanceCount})`,
    );
  }
  if (participants.length < advanceCount) {
    throw new DefinitionError(
      `決勝トーナメント進出人数 ${advanceCount} に対して参加者が足りません (実際の人数: ${participants.length})`,
    );
  }
  if (stage.bot.map === null && stage.map.catalogId === null) {
    throw new DefinitionError(
      'BOT対戦予選では全参加者が同じマップで戦う必要があります。'
      + 'stage.bot.map か stage.map.catalogId でマップを指定してください',
    );
  }
}

export interface ParseOptions {
  /** id 省略時に使うフォルダ名 */
  fallbackId?: string;
}

/** tournament.json をパースして検証する。失敗時は DefinitionError を投げる */
export function parseTournamentDefinition(raw: unknown, opts: ParseOptions = {}): TournamentDefinition {
  const o = asRecord(raw, 'tournament.json');

  const format = readFormat(o) ?? 'single-elimination';
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
  const match        = { doubleMode: asBool(asRecord(o['match'] ?? {}, 'match')['doubleMode'], true) };
  const stage        = parseStageRules(format as TournamentFormat, o['stage'], match.doubleMode);
  const ids          = new Set(participants.map(p => p.id));

  const def: TournamentDefinition = {
    formatVersion: asNumber(o['formatVersion'], 1),
    id, name, match, stage, participants,
  };

  // 予選のある形式では、1回戦の顔ぶれは予選の結果で決まるので明示的な組み合わせ指定は
  // 意味を持たない。黙って無視すると「指定したのに効かない」になるため、はっきり断る
  if (stage.format === 'group-then-bracket' || stage.format === 'bot-then-bracket') {
    const what = stage.format === 'group-then-bracket'
      ? { name: '予選リーグ + 決勝トーナメント', pairs: 'リーグごとに自動生成されます' }
      : { name: 'BOT対戦予選 + 決勝トーナメント', pairs: '参加者ごとに BOT との1試合が自動生成されます' };

    if (stage.format === 'group-then-bracket') validateGroupStage(participants, stage);
    else                                       validateBotStage(participants, stage);

    if (o['bracket'] !== undefined && o['bracket'] !== null) {
      throw new DefinitionError(`${what.name}では bracket を指定できません (1回戦は予選の順位で決まります)`);
    }
    if (o['schedule'] !== undefined && o['schedule'] !== null) {
      throw new DefinitionError(`${what.name}では schedule を指定できません (対戦カードは${what.pairs})`);
    }
    return def;
  }

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
