import type {
  LeaguePoints, MapPlan, ParticipantDef, ParticipantProgram, StageRules,
  TournamentDefinition, TournamentFormat, TournamentStatePayload,
} from '@u15/ws-types';
import {
  DEFAULT_LEAGUE_POINTS, autoGroupAssign, botRulesOf, bracketSizeFor, groupLabel,
  hasQualifying, hasThirdPlaceMatch, leagueRulesOf, stageCountFor,
} from '@u15/ws-types';
import { matchCountOf } from '../../../lib/bracketSlots';

// 大会データ作成フォームの下書きと、その純粋な操作。
//
// フォームは形式を切り替えても入力値を保持したい (行き来しても消えない) ので、
// 全形式ぶんの項目を平坦に持つ。**保存するときだけ**その形式が意味を持つ項目を取り出して
// StageRules に組み直す。逆向き (定義 → 下書き) も同じ理由でここに置く。

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  'single-elimination': 'トーナメント (勝ち上がり)',
  'league':             'リーグ (総当たり)',
  'group-then-bracket': '予選リーグ + 決勝トーナメント',
  'bot-then-bracket':   'BOT対戦予選 + 決勝トーナメント',
};

export const FORMATS = Object.keys(FORMAT_LABEL) as TournamentFormat[];

/** プログラムの指定。'' 未提出 / 'cpu' 内蔵CPU / 'file' 同梱 / 'lib:<catalogId>' ライブラリ */
export type ProgramChoice = string;

/** 同梱ファイルの元指定。編集で失わないよう保持する */
export interface BundledFile { file: string; displayName?: string }

/** 参加者1人ぶんの編集状態 */
export interface DraftParticipant {
  /** React の key。id を書き換えても行が作り直されないように別に持つ */
  key:  string;
  id:   string;
  name: string;
  program: ProgramChoice;
  file?: BundledFile;
  /**
   * 直前にプログラム側の宣言名 (CatalogEntry.declaredName) から自動で入れた name。
   * name がこれと一致している間は「まだ手を入れていない初期値」とみなしてプログラムの
   * 選び直しに追従させ、一致しなくなったら手入力として保護する。保存対象ではない。
   */
  nameFromProgram?: string;
  /** 所属する予選リーグ。undefined は「自動で振り分ける」 */
  group?: number;
}

export interface DraftBot {
  program: ProgramChoice;
  file?:   BundledFile;
  name:    string;
  /** 予選専用マップ。'' なら固定マップに従う */
  map:     string;
  participantSide: 0 | 1;
}

export interface TournamentDraft {
  id:     string;
  name:   string;
  format: TournamentFormat;

  doubleMode:       boolean;
  /** 予選専用の doubleMode (group-then-bracket / bot-then-bracket のみ意味を持つ) */
  qualifyingDoubleMode: boolean;
  thirdPlaceMatch:  boolean;
  doubleRoundRobin: boolean;
  leaguePoints:     LeaguePoints;
  /** 大会全体の固定マップ。'' なら毎回ランダム生成 */
  mapCatalogId:     string;
  /** index = 決勝トーナメントの回戦。'' は「大会の設定に従う」 */
  stageMaps:        string[];

  groupCount:   number;
  /**
   * 決勝トーナメントへ進む人数。
   * group-then-bracket … 各リーグから / bot-then-bracket … 全体で
   */
  advanceCount: number;
  /** 複数予選リーグの進行順序 (group-then-bracket のみ意味を持つ) */
  groupScheduleMode: 'parallel' | 'sequential';

  bot: DraftBot;

  participants:  DraftParticipant[];
  manualBracket: boolean;
  slots:         (string | null)[];
}

export const ID_RE = /^[A-Za-z0-9._-]+$/;

/** 既定の大会 id (フォルダ名になるので ASCII のみ) */
export function defaultId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `cup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
       + `-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** 別名保存の初期 id。`-2`, `-3` … と空いている番号を探す */
export function suggestCopyId(base: string, taken: string[]): string {
  const root = base.replace(/-\d+$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

function nextParticipantId(taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    if (!taken.has(id)) return id;
  }
}

export function newParticipant(taken: Set<string>, name: string): DraftParticipant {
  const id = nextParticipantId(taken);
  return { key: `${id}-${Math.random().toString(36).slice(2, 8)}`, id, name, program: '' };
}

export function emptyDraft(id = defaultId()): TournamentDraft {
  return {
    id, name: '', format: 'single-elimination',
    doubleMode: true, qualifyingDoubleMode: true, thirdPlaceMatch: false, doubleRoundRobin: false,
    leaguePoints: DEFAULT_LEAGUE_POINTS,
    mapCatalogId: '', stageMaps: [],
    groupCount: 2, advanceCount: 2, groupScheduleMode: 'parallel',
    bot: { program: '', name: '', map: '', participantSide: 0 },
    participants: [], manualBracket: false, slots: [],
  };
}

/** 数値入力を範囲に収める (空欄・非数値は既定値へ) */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ── 定義 ⇄ 下書き ────────────────────────────────────────────────────────────

/**
 * 保存済みの定義を下書きへ。
 *
 * ライブラリのプログラム割り当ては配布物である tournament.json に無いので、
 * 配信ペイロード (state) の側から拾う。
 */
export function draftFromDefinition(
  def: TournamentDefinition, state: TournamentStatePayload | null,
): TournamentDraft {
  const stage  = def.stage;
  const league = leagueRulesOf(stage);
  const bot    = botRulesOf(stage);
  const d      = emptyDraft(def.id);

  // 表示順 = 選手番号順 (小さいほど第1ゲームで先攻)。seed 未指定は記載順で後ろへ
  const ordered = [...def.participants]
    .map((p, i) => ({ p, i }))
    .sort((a, b) =>
      (a.p.seed ?? Number.POSITIVE_INFINITY) - (b.p.seed ?? Number.POSITIVE_INFINITY) || a.i - b.i)
    .map(x => x.p);

  const assigned = new Map((state?.participants ?? []).map(p => [p.id, p.programCatalogId] as const));

  const draft: TournamentDraft = {
    ...d,
    name:   def.name,
    format: stage.format,

    doubleMode:       def.match.doubleMode,
    qualifyingDoubleMode:
      stage.format === 'group-then-bracket' || stage.format === 'bot-then-bracket'
        ? stage.qualifyingDoubleMode
        : d.qualifyingDoubleMode,
    thirdPlaceMatch:  hasThirdPlaceMatch(stage),
    doubleRoundRobin: league?.doubleRoundRobin ?? d.doubleRoundRobin,
    leaguePoints:     league?.points ?? d.leaguePoints,
    mapCatalogId:     stage.map.catalogId ?? '',
    stageMaps:        stage.map.bracketStages.map(m => m ?? ''),

    groupCount: stage.format === 'group-then-bracket' ? stage.groupCount : d.groupCount,
    advanceCount:
        stage.format === 'group-then-bracket' ? stage.advancePerGroup
      : stage.format === 'bot-then-bracket'   ? stage.advanceCount
      : d.advanceCount,
    groupScheduleMode:
      stage.format === 'group-then-bracket' ? stage.groupScheduleMode : d.groupScheduleMode,

    bot: {
      ...toChoice(bot?.program ?? null, assigned.get('__bot__')),
      name:            bot?.name ?? '',
      map:             bot?.map ?? '',
      participantSide: bot?.participantSide ?? 0,
    },

    participants: ordered.map((p): DraftParticipant => {
      const base: Omit<DraftParticipant, 'program'> = { key: p.id, id: p.id, name: p.name };
      if (p.group !== undefined) base.group = p.group;
      return { ...base, ...toChoice(p.program, assigned.get(p.id)) };
    }),
  };

  if (stage.format === 'single-elimination' && def.bracket?.slots?.length) {
    draft.manualBracket = true;
    draft.slots = def.bracket.slots;
  }
  return draft;
}

/** 定義側のプログラム指定を、フォームの選択肢へ (未提出はライブラリ割り当てを引き継ぐ) */
function toChoice(
  program: ParticipantProgram, assignedCatalogId: string | null | undefined,
): { program: ProgramChoice; file?: BundledFile } {
  if (program?.kind === 'builtin') return { program: 'cpu' };
  if (program?.kind === 'file') {
    const file: BundledFile = program.displayName === undefined
      ? { file: program.file }
      : { file: program.file, displayName: program.displayName };
    return { program: 'file', file };
  }
  return { program: assignedCatalogId ? `lib:${assignedCatalogId}` : '' };
}

/** フォームの選択肢を、配布物に書ける形へ (ライブラリ割り当ては書かない) */
function toProgram(choice: ProgramChoice, file?: BundledFile): ParticipantProgram {
  if (choice === 'cpu') return { kind: 'builtin', builtin: 'cpu' };
  if (choice === 'file' && file) return { kind: 'file', ...file };
  return null;
}

/** 下書きを tournament.json の中身へ */
export function definitionFromDraft(d: TournamentDraft): TournamentDefinition {
  const participants: ParticipantDef[] = d.participants.map((p, i) => ({
    id:      p.id,
    name:    p.name.trim(),
    seed:    i + 1,
    ...(d.format === 'group-then-bracket' ? { group: groupOf(d, i) } : {}),
    program: toProgram(p.program, p.file),
  }));

  const map: MapPlan = {
    catalogId: d.mapCatalogId === '' ? null : d.mapCatalogId,
    // 回戦数ぶんだけ保存する (参加者を減らして回戦が減ったときの残骸を持ち越さない)
    bracketStages: Array.from(
      { length: bracketStageCount(d) }, (_, i) => d.stageMaps[i] || null),
  };

  const def: TournamentDefinition = {
    formatVersion: 1,
    id:    d.id,
    name:  d.name.trim(),
    match: { doubleMode: d.doubleMode },
    stage: stageRulesFromDraft(d, map),
    participants,
  };

  if (d.format === 'single-elimination' && d.manualBracket) {
    def.bracket = { size: d.slots.length, slots: d.slots };
  }
  return def;
}

function stageRulesFromDraft(d: TournamentDraft, map: MapPlan): StageRules {
  const league = { points: d.leaguePoints, doubleRoundRobin: d.doubleRoundRobin };
  switch (d.format) {
    case 'single-elimination':
      return { format: d.format, map, thirdPlaceMatch: d.thirdPlaceMatch };
    case 'league':
      return { format: d.format, map, league };
    case 'group-then-bracket':
      return {
        format: d.format, map, thirdPlaceMatch: d.thirdPlaceMatch, league,
        groupCount: d.groupCount, advancePerGroup: d.advanceCount,
        qualifyingDoubleMode: d.qualifyingDoubleMode,
        groupScheduleMode: d.groupScheduleMode,
      };
    case 'bot-then-bracket':
      return {
        format: d.format, map, thirdPlaceMatch: d.thirdPlaceMatch,
        advanceCount: d.advanceCount,
        qualifyingDoubleMode: d.qualifyingDoubleMode,
        bot: {
          // ライブラリ割り当て (lib:) は配布物に書かず、/assign で state.json 側へ保存する
          program:         toProgram(d.bot.program, d.bot.file),
          name:            d.bot.name.trim() === '' ? null : d.bot.name.trim(),
          map:             d.bot.map === '' ? null : d.bot.map,
          participantSide: d.bot.participantSide,
        },
      };
  }
}

/** 保存後に /assign へ送るライブラリ割り当て (内蔵CPU・同梱ファイルは定義側で決まる) */
export function libraryAssignments(d: TournamentDraft): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const put = (id: string, choice: ProgramChoice) => {
    if (choice === 'cpu' || choice === 'file') return;
    out[id] = choice.startsWith('lib:') ? choice.slice(4) : null;
  };
  for (const p of d.participants) put(p.id, p.program);
  // 運営BOT も同じ経路。BOT は participants に居ないので id は予約値
  if (d.format === 'bot-then-bracket') put('__bot__', d.bot.program);
  return out;
}

// ── 派生値 ────────────────────────────────────────────────────────────────────

/**
 * 予選リーグの自動振り分け。
 *
 * **バックエンドの group 省略時と同じ関数を使うこと** — 二重定義するとズレる。
 * 表示順 = 選手番号順なので、蛇行配分はその並びにそのまま当たる。
 */
export function autoGroupsOf(d: TournamentDraft): number[] {
  return autoGroupAssign(d.participants.length, d.groupCount);
}

export function groupOf(d: TournamentDraft, i: number): number {
  return d.participants[i]?.group ?? autoGroupsOf(d)[i] ?? 0;
}

/**
 * 決勝トーナメントの回戦数。参加者数だけで決まる (bracketSizeFor の log2)。
 *
 * 予選の節数は参加者数だけでは決まらないので数えない (backend が解決する)。
 * 回戦ごとのマップの index も決勝トーナメント相対。
 */
export function bracketStageCount(d: TournamentDraft): number {
  switch (d.format) {
    case 'single-elimination': return stageCountFor(d.participants.length);
    case 'group-then-bracket': return stageCountFor(d.groupCount * d.advanceCount);
    // BOT対戦予選は1グループなので、進出人数がそのまま決勝T の出場者数
    case 'bot-then-bracket':   return stageCountFor(d.advanceCount);
    case 'league':             return 0;
  }
}

/** 全部で何試合になるかの見積り (フォームのプレビュー) */
export function previewMatchCount(d: TournamentDraft): number {
  const n = d.participants.length;
  if (d.format === 'group-then-bracket') {
    const sizes = Array.from({ length: d.groupCount }, (_, g) =>
      autoGroupsOf(d).filter(x => x === g).length);
    const league = sizes.reduce((sum, k) => sum + (k * (k - 1)) / 2, 0)
      * (d.doubleRoundRobin ? 2 : 1);
    return league + bracketMatches(d.groupCount * d.advanceCount, d.thirdPlaceMatch);
  }
  if (d.format === 'bot-then-bracket') {
    // 予選は参加者ごとに BOT との1試合、決勝は進出者ぶんの勝ち上がり
    return n + bracketMatches(Math.min(d.advanceCount, n), d.thirdPlaceMatch);
  }
  return matchCountOf(d.format, n, {
    thirdPlaceMatch: d.thirdPlaceMatch, doubleRoundRobin: d.doubleRoundRobin,
  });
}

function bracketMatches(entrants: number, thirdPlaceMatch: boolean): number {
  const size = bracketSizeFor(entrants);
  return (size < 2 ? 0 : size - 1) + (thirdPlaceMatch && size >= 4 ? 1 : 0);
}

/** エディタ下部プレビューの「何ゲーム制か」の文言。予選・決勝で違うときは内訳を出す */
export function doubleModeSummary(d: TournamentDraft): string {
  const g = (v: boolean) => (v ? '2' : '1');
  if (hasQualifying(d.format) && d.qualifyingDoubleMode !== d.doubleMode) {
    return `（予選${g(d.qualifyingDoubleMode)}ゲーム・決勝${g(d.doubleMode)}ゲーム）`;
  }
  return d.doubleMode ? '（各2ゲーム）' : '';
}

// ── 検証 ──────────────────────────────────────────────────────────────────────

export interface ValidateOptions {
  /** 編集中の大会 id。新規作成なら null */
  editId:      string | null;
  existingIds: string[];
  /** 別名保存 (新しい id で複製する) */
  saveAs:      boolean;
}

/**
 * 保存できない理由。問題が無ければ null。
 *
 * **バックエンド (definition.ts) と同じ条件をここでも見る。** 保存してから弾かれるより、
 * 入力しながら気づける方がよい。片方だけ緩めると「保存できたのに読めない」大会ができる。
 */
export function validateDraft(d: TournamentDraft, opts: ValidateOptions): string | null {
  const creatingNew = opts.editId === null || opts.saveAs;

  if (d.name.trim() === '') return '大会名を入力してください';
  if (!ID_RE.test(d.id)) {
    return '大会ID は半角英数字と . _ - だけで入力してください（フォルダ名になります）';
  }
  // 同じIDへの上書き保存だけは衝突ではない
  if (opts.existingIds.includes(d.id) && (creatingNew || d.id !== opts.editId)) {
    return `大会ID "${d.id}" は既に使われています。別のIDにしてください`;
  }
  if (d.participants.length < 2) return '参加者を2人以上登録してください';

  const names = new Set<string>();
  for (const p of d.participants) {
    const name = p.name.trim();
    if (name === '') return '名前が空の参加者がいます';
    if (names.has(name)) return `参加者名 "${name}" が重複しています`;
    names.add(name);
  }

  if (d.format === 'single-elimination' && d.manualBracket) {
    const placed = d.slots.filter((s): s is string => s !== null);
    if (new Set(placed).size !== d.participants.length) {
      return '組み合わせに未配置または重複した参加者がいます';
    }
  }

  if (d.format === 'group-then-bracket') {
    if (d.participants.length < d.groupCount * 2) {
      return `予選${d.groupCount}リーグには最低${d.groupCount * 2}人の参加者が必要です`;
    }
    const sizes = Array.from({ length: d.groupCount }, (_, g) =>
      d.participants.filter((_, i) => groupOf(d, i) === g).length);
    const empty = sizes.findIndex(k => k < 2);
    if (empty >= 0) return `${groupLabel(empty)}リーグの参加者が2人未満です`;
    const short = sizes.findIndex(k => k < d.advanceCount);
    if (short >= 0) {
      return `${groupLabel(short)}リーグの人数 (${sizes[short]}人) が進出人数 ${d.advanceCount} に足りません`;
    }
  }

  if (d.format === 'bot-then-bracket') {
    if (d.advanceCount < 2) return '決勝トーナメント進出人数は2以上にしてください';
    if (d.participants.length < d.advanceCount) {
      return `決勝トーナメント進出人数 ${d.advanceCount} に対して参加者が足りません`;
    }
    if (d.bot.map === '' && d.mapCatalogId === '') {
      return 'BOT対戦予選のマップを指定してください（全参加者が同じマップで戦う必要があります）';
    }
  }
  return null;
}
