import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  GroupStanding,
  ParticipantProgram,
  QualifierCandidate,
  QualifierSlot,
  ResolvedParticipant,
  TournamentAutoPlay,
  TournamentDisplayView,
  TournamentDefinition,
  TournamentMatch,
  TournamentState,
  TournamentStatePayload,
  TournamentSummary,
} from '@u15/ws-types';
import { BOT_PARTICIPANT_ID, hasBotStage, hasQualifying, stageLabel } from '@u15/ws-types';
import { addCatalogEntry, getCatalogEntry, setDemoEnabled } from '../programCatalog.js';
import { buildBracket } from './bracket.js';
import { buildLeague } from './league.js';
import { orderBySeed } from './bracket.js';
import { buildBotStage } from './botStage.js';
import { assignGroups, buildGroupStage, groupStageCountOf, isGroupStageDone } from './groupStage.js';
import { resolveMatches, type ResolveContext } from './progress.js';
import {
  computeGroupStandings, computeQualifierCandidates, computeQualifiers, qualifierKey,
} from './qualifiers.js';
import { computeStandings, type StandingsRankBy } from './standings.js';
import { DefinitionError, parseTournamentDefinition } from './definition.js';
import { extractZip } from './zip.js';

// 大会データの永続化。program-catalog / map-catalog と同じ「同期 fs + JSON」方式。
//
// 「定義」と「進行状態」を分けているのが要点:
//   tournament.json … 人が書く。アプリは読むだけで絶対に書き戻さない
//   state.json      … アプリが書く進行状態。消せば大会をやり直せる
//
// ルームは30分 TTL で消えるため、大会データをルームに紐づけて保存してはいけない。

const ROOT = () => path.resolve('server/tournament');

export function tournamentRootDir(): string {
  return ROOT();
}

export function ensureTournamentDir(): void {
  fs.mkdirSync(ROOT(), { recursive: true });
}

function dirOf(id: string): string {
  return path.join(ROOT(), id);
}

function defPath(id: string): string {
  return path.join(dirOf(id), 'tournament.json');
}

function statePath(id: string): string {
  return path.join(dirOf(id), 'state.json');
}

/** 大会 id として使えるフォルダ名か (パストラバーサル防止) */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._\-]+$/.test(id) && id !== '.' && id !== '..';
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ── 試合グラフの構築 ────────────────────────────────────────────────────────

export function buildMatches(def: TournamentDefinition): TournamentMatch[] {
  if (def.format === 'league') {
    const opts: Parameters<typeof buildLeague>[1] = { doubleRoundRobin: def.rules.doubleRoundRobin };
    if (def.schedule?.pairs) opts.pairs = def.schedule.pairs;
    return resolveMatches(buildLeague(def.participants, opts));
  }
  if (def.format === 'group-then-bracket') {
    const built = buildGroupStage(def.participants, {
      groupCount:       def.rules.groupCount,
      advancePerGroup:  def.rules.advancePerGroup,
      doubleRoundRobin: def.rules.doubleRoundRobin,
      thirdPlaceMatch:  def.rules.thirdPlaceMatch,
    });
    return resolveMatches(built, Date.now(), contextOf(def, {}));
  }
  if (def.format === 'bot-then-bracket') {
    const built = buildBotStage(def.participants, {
      advanceCount:    def.rules.advancePerGroup,
      participantSide: def.rules.participantSide,
      thirdPlaceMatch: def.rules.thirdPlaceMatch,
    });
    return resolveMatches(built, Date.now(), contextOf(def, {}));
  }
  const opts: Parameters<typeof buildBracket>[1] = { thirdPlaceMatch: def.rules.thirdPlaceMatch };
  if (def.bracket?.slots) opts.slots = def.bracket.slots;
  return resolveMatches(buildBracket(def.participants, opts));
}

// ── group-rank の解決文脈 ──────────────────────────────────────────────────
//
// 「どのリーグに誰がいるか」「勝ち点は何点か」「運営が誰を差し替えたか」の3つ。
// 組み立てをここ1箇所に閉じて、呼ぶ側が文脈を作り分けないようにする
// (作り分けると、片方の経路だけ手動指定が効かないといった事故になる)。

/**
 * その予選グループに属する参加者 id (エントリー順)。予選を持たない形式では空。
 *
 * BOT対戦予選は1グループなので「全参加者が入った配列1つ」を返す。BOT 自身は
 * エントリーではないので入れない — 入れると順位表に BOT の行が立ってしまう。
 */
export function groupsOf(def: TournamentDefinition): string[][] {
  if (hasBotStage(def.format)) return [orderBySeed(def.participants).map(p => p.id)];
  if (def.format !== 'group-then-bracket') return [];
  return assignGroups(def.participants, def.rules.groupCount).map(g => g.map(p => p.id));
}

/** 順位の付け方。予選リーグは公式ルールの勝ち点制、BOT対戦予選はポイント制 */
export function rankByOf(def: TournamentDefinition): StandingsRankBy {
  return hasBotStage(def.format) ? 'total-points' : 'league-points';
}

function contextOf(
  def: TournamentDefinition,
  overrides: Record<string, string | null>,
  exclusions: readonly string[] = [],
): ResolveContext {
  if (!hasQualifying(def.format)) return {};
  return {
    groups:              groupsOf(def),
    leaguePoints:        def.rules.leaguePoints,
    qualifierOverrides:  overrides,
    rankBy:              rankByOf(def),
    qualifierExclusions: exclusions,
  };
}

export function resolveContextOf(loaded: LoadedTournament): ResolveContext {
  return contextOf(
    loaded.def,
    loaded.state.qualifierOverrides ?? {},
    loaded.state.qualifierExclusions ?? [],
  );
}

/**
 * 今の定義から見て意味を失った手動指定を捨てる。
 *
 * 参加者を入れ替えた・リーグ分けを変えた古い state.json を読んだとき、存在しない人を
 * 指したままにすると armMatch が「参加者が見つかりません」で落ちる — しかも本番の
 * 対戦直前に落ちる。読み込みの時点で黙って落としておく。
 */
function sanitizeQualifierOverrides(
  def: TournamentDefinition, overrides: Record<string, string | null> | undefined,
): Record<string, string | null> | undefined {
  if (!overrides || !hasQualifying(def.format)) return undefined;

  const groups = groupsOf(def);
  const out: Record<string, string | null> = {};
  for (let g = 0; g < groups.length; g++) {
    for (let rank = 1; rank <= def.rules.advancePerGroup; rank++) {
      const key = qualifierKey(g, rank);
      const v   = overrides[key];
      if (typeof v === 'string' && groups[g]!.includes(v)) out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 同上。参加者から消えた人の削除指定は落とす */
function sanitizeQualifierExclusions(
  def: TournamentDefinition, exclusions: string[] | undefined,
): string[] | undefined {
  if (!exclusions || !hasQualifying(def.format)) return undefined;
  const ids = new Set(def.participants.map(p => p.id));
  const out = exclusions.filter(id => ids.has(id));
  return out.length > 0 ? out : undefined;
}

// ── 回戦ごとのマップ ──────────────────────────────────────────────────────
//
// 解決順は「試合の再試合指定 → 運営中の差し替え → 定義の回戦指定 → 大会全体の固定マップ」。
// 定義 (tournament.json) は配布物なので運営中は書き換えず、差し替えは state.json 側に持つ
// (プログラムの割り当て = programs と同じ二層構造)。

/** その大会の回戦数。試合グラフから数えるので league (節) でも破綻しない */
export function stageCountOf(matches: TournamentMatch[]): number {
  return matches.reduce((max, m) => Math.max(max, m.stage + 1), 0);
}

/**
 * 回戦ごとの実効マップ (index = stage)。null は「大会の設定に従う」。
 *
 * **index は予選と決勝を通した stage 番号 (combined) で統一する。** 運営中の差し替え
 * (stageMapOverrides) も mapForStage への引数も combined なので、ここで index 空間を
 * 分けると必ずズレる。ゲタを当てるのは「定義に書かれた回戦ごとのマップ」の読み出しだけ —
 * 作成画面は決勝トーナメントの回戦しか出さないので、そちらは決勝T相対で書かれている。
 * 予選を持たない形式ではゲタが 0 なので、従来の挙動と1ミリも変わらない。
 */
export function resolveStageMaps(loaded: LoadedTournament): (string | null)[] {
  const count     = stageCountOf(loaded.state.matches);
  const authored  = loaded.def.rules.stageMaps;
  const overrides = loaded.state.stageMapOverrides ?? {};
  const offset    = groupStageCountOf(loaded.state.matches);

  return Array.from({ length: count }, (_, stage) => {
    const o = overrides[String(stage)];
    if (o !== undefined) return o;
    const authoredIndex = stage - offset;
    // 予選の節。BOT対戦予選だけは「全参加者が同じマップで戦う」ための専用指定を持つ
    if (authoredIndex < 0) {
      return hasBotStage(loaded.def.format) ? loaded.def.rules.botStageMap : null;
    }
    return authored[authoredIndex] ?? null;
  });
}

/**
 * stage ごとの表示名 (index = stage)。節数の算出を frontend に二重定義しないよう、
 * 試合グラフから組み立てて配信ペイロードに載せる。
 */
export function stageLabelsOf(matches: TournamentMatch[], botStage = false): string[] {
  const count  = stageCountOf(matches);
  const offset = groupStageCountOf(matches);
  const bracketStages = count - offset;

  return Array.from({ length: count }, (_, stage) => (
    stage >= offset ? stageLabel(stage - offset, bracketStages)
    // BOT対戦予選は1段だけなので「第N節」と数える意味が無い
    : botStage      ? 'BOT対戦予選'
    :                 `予選 第${stage + 1}節`
  ));
}

/** その回戦のマップ (再試合の指定を除いた実効値)。null ならランダム生成のまま */
export function mapForStage(loaded: LoadedTournament, stage: number): string | null {
  return resolveStageMaps(loaded)[stage] ?? loaded.def.rules.mapCatalogId;
}

/** その試合で実際に使うマップ。null ならランダム生成のまま */
export function mapForMatch(loaded: LoadedTournament, match: TournamentMatch): string | null {
  return match.rematchMapCatalogId ?? mapForStage(loaded, match.stage);
}

/** 試合グラフの骨組みを1本の文字列にする (結果は含めない) */
function slotKey(ref: TournamentMatch['slotA']): string {
  switch (ref.kind) {
    case 'participant': return `p:${ref.participantId}`;
    case 'winner-of':   return `w:${ref.matchId}`;
    case 'loser-of':    return `l:${ref.matchId}`;
    case 'group-rank':  return `g:${ref.group}:${ref.rank}`;
    case 'bye':         return 'bye';
  }
}

function fingerprint(matches: TournamentMatch[]): string {
  return matches
    .map(m => [m.id, m.stage, m.order, m.group ?? '-', slotKey(m.slotA), slotKey(m.slotB)].join('|'))
    .sort()
    .join('\n');
}

/**
 * 保存済みの進行状態が今の定義とまだ噛み合っているか。
 *
 * 定義から組み直したグラフと骨組みを突き合わせる。participant id だけを見ていた頃は
 * 「参加者はそのままでルールだけ変えた上書き」を検知できず、リーグ分けの入れ替えや
 * advancePerGroup の変更も素通りしていた。骨組み比較ならその全部が引っかかる。
 */
function stateMatchesDefinition(def: TournamentDefinition, state: TournamentState): boolean {
  if (state.matches.length === 0) return false;
  return fingerprint(state.matches) === fingerprint(buildMatches(def));
}

// ── プログラムライブラリへの取り込み ──────────────────────────────────────

/**
 * 参加プログラムをプログラムライブラリへ登録する。
 *
 * addCatalogEntry は渡したパスを rename する (元ファイルが消える) ので、大会フォルダの
 * 原本を直接渡してはいけない。必ず一時ファイルへコピーしてから渡す。
 */
function registerProgram(srcPath: string, displayName: string): string {
  const tmp = path.join(os.tmpdir(), `u15-tp-${randomUUID()}${path.extname(srcPath)}`);
  fs.copyFileSync(srcPath, tmp);
  const entry = addCatalogEntry(displayName, tmp);
  // 大会用プログラムがデモモードのランダム抽選に混ざらないようにする
  setDemoEnabled(entry.id, false);
  return entry.id;
}

/** 定義の program.file を読み、必要なぶんだけライブラリへ登録し直す (再スキャンで冪等) */
function syncPrograms(
  def: TournamentDefinition, prev: TournamentState['programs'],
): { programs: TournamentState['programs']; errors: string[] } {
  const programs: TournamentState['programs'] = { ...prev };
  const errors: string[] = [];

  // 運営BOT は participants に居ないが、実体を持つ点は参加者と全く同じなので同じ経路で登録する
  const entries: { id: string; name: string; program: ParticipantProgram }[] = [
    ...def.participants.map(p => ({ id: p.id, name: p.name, program: p.program })),
    ...(hasBotStage(def.format)
      ? [{
          id:      BOT_PARTICIPANT_ID,
          name:    def.rules.botName ?? '運営BOT',
          program: def.rules.botProgram,
        }]
      : []),
  ];

  for (const p of entries) {
    if (!p.program || p.program.kind !== 'file') continue;

    const src = path.join(dirOf(def.id), p.program.file);
    if (!fs.existsSync(src)) {
      errors.push(`${p.name}: プログラム "${p.program.file}" が見つかりません`);
      delete programs[p.id];
      continue;
    }

    const hash    = sha256(src);
    const current = programs[p.id];
    if (current && current.sha256 === hash && getCatalogEntry(current.catalogId)) {
      continue; // 変わっていないので何もしない
    }

    const displayName = p.program.displayName ?? `${p.name} (${path.basename(p.program.file)})`;
    programs[p.id] = { catalogId: registerProgram(src, displayName), sha256: hash };
  }

  return { programs, errors };
}

// ── 読み書き ──────────────────────────────────────────────────────────────

export interface LoadedTournament {
  def:   TournamentDefinition;
  state: TournamentState;
}

export function saveState(state: TournamentState): void {
  const dir = dirOf(state.tournamentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(state.tournamentId), JSON.stringify(state, null, 2));
}

function readState(id: string): TournamentState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(id), 'utf-8')) as TournamentState;
    if (!Array.isArray(raw.matches)) return null;
    return { ...raw, tournamentId: id, programs: raw.programs ?? {} };
  } catch {
    return null; // 未作成・壊れている → 定義から作り直す
  }
}

function readDefinition(id: string): TournamentDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(defPath(id), 'utf-8'));
  } catch (e) {
    throw new DefinitionError(`tournament.json を JSON として読めません: ${(e as Error).message}`);
  }
  return parseTournamentDefinition(raw, { fallbackId: id });
}

/**
 * 大会を読み込む。state.json が無い/壊れている/定義と噛み合わない場合は
 * 定義から試合グラフを作り直す (進行はリセットされるが読み込みは必ず成功する)。
 *
 * 大会が存在しなければ null。**定義が不正な場合は DefinitionError を投げる** —
 * 「participants が空です」のような原因を運営に見せるため、ここで握りつぶさない。
 */
export function loadTournament(id: string): LoadedTournament | null {
  if (!isSafeId(id) || !fs.existsSync(defPath(id))) return null;

  const def  = readDefinition(id);
  const prev = readState(id);
  const { programs } = syncPrograms(def, prev?.programs ?? {});

  let state: TournamentState;
  if (prev && stateMatchesDefinition(def, prev)) {
    const overrides  = sanitizeQualifierOverrides(def, prev.qualifierOverrides);
    const exclusions = sanitizeQualifierExclusions(def, prev.qualifierExclusions);
    state = { ...prev, programs, matches: prev.matches };
    if (overrides === undefined) delete state.qualifierOverrides;
    else state.qualifierOverrides = overrides;
    if (exclusions === undefined) delete state.qualifierExclusions;
    else state.qualifierExclusions = exclusions;
    state.matches = resolveMatches(
      prev.matches, Date.now(), contextOf(def, overrides ?? {}, exclusions ?? []),
    );
  } else {
    state = { tournamentId: id, matches: buildMatches(def), programs, updatedAt: Date.now() };
  }

  saveState(state);
  return { def, state };
}

export interface ScanResult {
  imported: TournamentSummary[];
  errors:   { id: string; message: string }[];
}

/** server/tournament/ 配下を走査して取り込む */
export function scanTournaments(boundRoomOf?: (id: string) => string | null): ScanResult {
  ensureTournamentDir();
  const imported: TournamentSummary[] = [];
  const errors: ScanResult['errors']  = [];

  for (const entry of fs.readdirSync(ROOT(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
    if (!fs.existsSync(defPath(entry.name))) continue;

    try {
      const loaded = loadTournament(entry.name);
      if (!loaded) continue; // 定義ファイルが無い (上でチェック済みだが念のため)
      imported.push(toSummary(loaded, boundRoomOf?.(entry.name) ?? null));
    } catch (e) {
      // 1つの大会が壊れていても他の検出は止めない。原因はそのまま運営に見せる
      const message = e instanceof DefinitionError ? e.message : (e as Error).message;
      errors.push({ id: entry.name, message });
    }
  }

  imported.sort((a, b) => a.id.localeCompare(b.id));
  return { imported, errors };
}

export function toSummary(loaded: LoadedTournament, boundRoomId: string | null): TournamentSummary {
  const total = loaded.state.matches.length;
  const done  = loaded.state.matches.filter(m => m.status === 'done').length;
  return {
    id:           loaded.def.id,
    name:         loaded.def.name,
    format:       loaded.def.format,
    participants: loaded.def.participants.length,
    progress:     [done, total],
    boundRoomId,
  };
}

/** 進行状態だけを初期化する (定義とプログラム登録は残す) */
export function resetTournamentState(id: string): LoadedTournament | null {
  const loaded = loadTournament(id);
  if (!loaded) return null;
  const state: TournamentState = {
    tournamentId: id,
    matches:      buildMatches(loaded.def),
    programs:     loaded.state.programs,
    updatedAt:    Date.now(),
  };
  saveState(state);
  return { def: loaded.def, state };
}

export function deleteTournament(id: string): void {
  if (!isSafeId(id)) return;
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

export type RenameResult = 'ok' | 'invalid' | 'not-found' | 'exists';

/**
 * 大会 id を変える (= フォルダ名を変える)。
 *
 * **作り直しではなく移動にすること。** 新しい id で取り込んで古いのを消す作り方だと、
 * 同梱プログラム (programs/*.py) と進行状態が付いてこず、`program.kind === 'file'` の
 * 参加者が「プログラムが見つかりません」になる。
 *
 * state.json の中の tournamentId は次の loadTournament が id で上書きするので、
 * ここでは触らない。
 */
export function renameTournament(oldId: string, newId: string): RenameResult {
  if (!isSafeId(oldId) || !isSafeId(newId)) return 'invalid';
  if (oldId === newId) return 'ok';
  if (!fs.existsSync(defPath(oldId))) return 'not-found';
  if (fs.existsSync(dirOf(newId))) return 'exists';

  fs.renameSync(dirOf(oldId), dirOf(newId));
  return 'ok';
}

/** 未提出だった参加者 (BOT対戦予選では運営BOT も) に、プログラムライブラリのエントリを紐付ける */
export function assignProgram(
  id: string, participantId: string, catalogId: string | null,
): LoadedTournament | null {
  const loaded = loadTournament(id);
  if (!loaded) return null;

  const isBot = participantId === BOT_PARTICIPANT_ID && hasBotStage(loaded.def.format);
  if (!isBot && !loaded.def.participants.some(p => p.id === participantId)) return null;

  const programs = { ...loaded.state.programs };
  if (catalogId === null) {
    delete programs[participantId];
  } else {
    const entry = getCatalogEntry(catalogId);
    if (!entry) return null;
    programs[participantId] = { catalogId, sha256: '' };
  }

  const state = { ...loaded.state, programs, updatedAt: Date.now() };
  saveState(state);
  return { def: loaded.def, state };
}

// ── インポート ────────────────────────────────────────────────────────────

export interface ImportResult {
  id:      string;
  summary: TournamentSummary;
}

/** .json を直接取り込む (プログラムは別途ライブラリから紐付ける運用) */
export function importFromJson(raw: unknown, suggestedId?: string): ImportResult {
  const fallback = suggestedId && isSafeId(suggestedId) ? suggestedId : `cup-${Date.now()}`;
  const def = parseTournamentDefinition(raw, { fallbackId: fallback });
  if (!isSafeId(def.id)) {
    throw new DefinitionError(`id "${def.id}" にはフォルダ名に使えない文字が含まれています`);
  }

  fs.mkdirSync(dirOf(def.id), { recursive: true });
  fs.writeFileSync(defPath(def.id), JSON.stringify(raw, null, 2));

  const loaded = loadTournament(def.id);
  if (!loaded) throw new DefinitionError('取り込んだ大会を読み込めませんでした');
  return { id: def.id, summary: toSummary(loaded, null) };
}

/**
 * .zip (tournament.json + programs/*.py) を取り込む。
 *
 * アーカイブのルート直下でも、フォルダを1階層かぶせた形でも受け付ける
 * (Windows のエクスプローラーで「送る > 圧縮」するとフォルダごと入るため)。
 */
export function importFromZip(buf: Buffer, suggestedId?: string): ImportResult {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-tz-'));
  try {
    extractZip(buf, staging, { allowedExtensions: ['.json', '.py', '.txt', '.md'] });

    const root = findDefinitionRoot(staging);
    if (!root) {
      throw new DefinitionError('ZIP の中に tournament.json が見つかりません');
    }

    const raw = JSON.parse(fs.readFileSync(path.join(root, 'tournament.json'), 'utf-8')) as unknown;
    const fallback = suggestedId && isSafeId(suggestedId)
      ? suggestedId
      : path.basename(root) !== path.basename(staging) && isSafeId(path.basename(root))
        ? path.basename(root)
        : `cup-${Date.now()}`;

    const def = parseTournamentDefinition(raw, { fallbackId: fallback });
    if (!isSafeId(def.id)) {
      throw new DefinitionError(`id "${def.id}" にはフォルダ名に使えない文字が含まれています`);
    }

    // 検証を通ってから初めて本番の場所へ置く (壊れたデータを残さない)
    const dest = dirOf(def.id);
    fs.rmSync(dest, { recursive: true, force: true });
    copyDirSync(root, dest);

    const loaded = loadTournament(def.id);
    if (!loaded) throw new DefinitionError('取り込んだ大会を読み込めませんでした');
    return { id: def.id, summary: toSummary(loaded, null) };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * ディレクトリを再帰的にコピーする。
 *
 * fs.cpSync は使わない — Node 22.23 (Windows) でこの経路 (一時ディレクトリ →
 * OneDrive 配下のワークスペース) を渡すとセグメンテーションフォルトでプロセスごと落ちる。
 * readdir/mkdir/copyFile だけで組めば安定して動く。
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to   = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

/** tournament.json のあるディレクトリを、直下と1階層下から探す */
function findDefinitionRoot(staging: string): string | null {
  if (fs.existsSync(path.join(staging, 'tournament.json'))) return staging;
  for (const e of fs.readdirSync(staging, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(staging, e.name, 'tournament.json'))) {
      return path.join(staging, e.name);
    }
  }
  return null;
}

// ── 配信ペイロード ────────────────────────────────────────────────────────

/**
 * 配信する参加者一覧。
 *
 * BOT対戦予選では**末尾に運営BOT を合成して足す**。BOT は `def.participants` に居ないので
 * エントリー数・順位表・決勝トーナメントからは自動的に外れるが、試合の slot は普通の
 * participant としてこの id を指す。おかげで armMatch・カード表示・CSV 書き出しは
 * BOT を知らないまま動く。
 */
export function resolveParticipants(loaded: LoadedTournament): ResolvedParticipant[] {
  const resolve = (
    id: string, name: string, program: ParticipantProgram, seed: number,
  ): ResolvedParticipant => {
    const link  = loaded.state.programs[id];
    const entry = link ? getCatalogEntry(link.catalogId) : undefined;
    const cpu   = program?.kind === 'builtin';
    return {
      id, name, seed,
      programCatalogId: entry?.id ?? null,
      builtinCpu:       cpu,
      programName:      cpu ? '内蔵CPU' : entry?.displayName ?? null,
    };
  };

  const ordered = orderBySeed(loaded.def.participants)
    .map((p, i) => resolve(p.id, p.name, p.program, i + 1));

  if (!hasBotStage(loaded.def.format)) return ordered;

  // seed 0 = 選手番号を持たない。BOT は組み合わせ表に載る存在ではない
  const bot = resolve(
    BOT_PARTICIPANT_ID, loaded.def.rules.botName ?? '運営BOT', loaded.def.rules.botProgram, 0,
  );
  return [...ordered, { ...bot, isBot: true }];
}

/** 予選グループごとの順位表。予選を持たない形式では null */
export function groupStandingsOf(loaded: LoadedTournament): GroupStanding[] | null {
  if (!hasQualifying(loaded.def.format)) return null;
  return computeGroupStandings(
    groupsOf(loaded.def), loaded.state.matches, loaded.def.rules.leaguePoints,
    rankByOf(loaded.def),
  );
}

/** 決勝トーナメントの枠と、そこに入る人。予選を持たない形式では null */
export function qualifiersOf(loaded: LoadedTournament): QualifierSlot[] | null {
  const groups = groupStandingsOf(loaded);
  if (!groups) return null;
  return computeQualifiers(
    groups, loaded.state.matches, loaded.def.rules.advancePerGroup,
    loaded.state.qualifierOverrides ?? {},
    loaded.state.qualifierExclusions ?? [],
  );
}

/** 決勝進出者の最終決定確認リスト。予選を持たない形式では null */
export function qualifierCandidatesOf(loaded: LoadedTournament): QualifierCandidate[] | null {
  const groups = groupStandingsOf(loaded);
  if (!groups) return null;
  return computeQualifierCandidates(
    groups, loaded.state.matches, loaded.def.rules.advancePerGroup,
    loaded.state.qualifierExclusions ?? [],
  );
}

/**
 * 決勝進出者が運営に確定されているか。
 *
 * **予選が終わっていない間は必ず false に倒す。** 予選の試合を1つ取り消せば確定も
 * 自動で外れるので、巻き戻しの経路 (reopen / discard / setQualifier / cascade) の
 * すべてでフラグを消して回る必要がなくなる。
 */
export function qualifiersConfirmedOf(loaded: LoadedTournament): boolean {
  if (!hasQualifying(loaded.def.format)) return false;
  return loaded.state.qualifiersConfirmed === true && isGroupStageDone(loaded.state.matches);
}

export function buildStatePayload(
  loaded: LoadedTournament, boundRoomId: string, armedMatchId: string | null,
  displayView: TournamentDisplayView = 'auto',
  autoPlay: TournamentAutoPlay = { enabled: false, loop: false, stoppedReason: null },
): TournamentStatePayload {
  const participants = resolveParticipants(loaded);
  return {
    tournamentId: loaded.def.id,
    name:         loaded.def.name,
    format:       loaded.def.format,
    rules:        loaded.def.rules,
    participants,
    matches:      loaded.state.matches,
    standings:    loaded.def.format === 'league'
      ? computeStandings(participants.map(p => p.id), loaded.state.matches, loaded.def.rules.leaguePoints)
      : null,
    groups:       groupStandingsOf(loaded),
    qualifiers:   qualifiersOf(loaded),
    qualifierCandidates: qualifierCandidatesOf(loaded),
    qualifiersConfirmed: qualifiersConfirmedOf(loaded),
    stageMaps:    resolveStageMaps(loaded),
    stageLabels:  stageLabelsOf(loaded.state.matches, hasBotStage(loaded.def.format)),
    displayView,
    autoPlay,
    armedMatchId,
    boundRoomId,
    updatedAt:    loaded.state.updatedAt,
  };
}
