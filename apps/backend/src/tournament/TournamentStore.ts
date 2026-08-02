import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ResolvedParticipant,
  TournamentDefinition,
  TournamentMatch,
  TournamentState,
  TournamentStatePayload,
  TournamentSummary,
} from '@u15/ws-types';
import { addCatalogEntry, getCatalogEntry, setDemoEnabled } from '../programCatalog.js';
import { buildBracket } from './bracket.js';
import { buildLeague } from './league.js';
import { orderBySeed } from './bracket.js';
import { resolveMatches } from './progress.js';
import { computeStandings } from './standings.js';
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
  const opts: Parameters<typeof buildBracket>[1] = { thirdPlaceMatch: def.rules.thirdPlaceMatch };
  if (def.bracket?.slots) opts.slots = def.bracket.slots;
  return resolveMatches(buildBracket(def.participants, opts));
}

/** 保存済みの進行状態が今の定義とまだ噛み合っているか */
function stateMatchesDefinition(def: TournamentDefinition, state: TournamentState): boolean {
  if (state.matches.length === 0) return false;
  const ids = new Set(def.participants.map(p => p.id));
  for (const m of state.matches) {
    for (const ref of [m.slotA, m.slotB]) {
      if (ref.kind === 'participant' && !ids.has(ref.participantId)) return false;
    }
  }
  return true;
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

  for (const p of def.participants) {
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

  const state: TournamentState = prev && stateMatchesDefinition(def, prev)
    ? { ...prev, programs, matches: resolveMatches(prev.matches) }
    : { tournamentId: id, matches: buildMatches(def), programs, updatedAt: Date.now() };

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

/** 未提出だった参加者に、あとからプログラムライブラリのエントリを紐付ける */
export function assignProgram(
  id: string, participantId: string, catalogId: string | null,
): LoadedTournament | null {
  const loaded = loadTournament(id);
  if (!loaded) return null;
  if (!loaded.def.participants.some(p => p.id === participantId)) return null;

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

export function resolveParticipants(loaded: LoadedTournament): ResolvedParticipant[] {
  const ordered = orderBySeed(loaded.def.participants);
  return ordered.map((p, i) => {
    const link  = loaded.state.programs[p.id];
    const entry = link ? getCatalogEntry(link.catalogId) : undefined;
    const cpu   = p.program?.kind === 'builtin';
    return {
      id:               p.id,
      name:             p.name,
      seed:             i + 1,
      programCatalogId: entry?.id ?? null,
      builtinCpu:       cpu,
      programName:      cpu ? '内蔵CPU' : entry?.displayName ?? null,
    };
  });
}

export function buildStatePayload(
  loaded: LoadedTournament, boundRoomId: string, armedMatchId: string | null,
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
    armedMatchId,
    boundRoomId,
    updatedAt:    loaded.state.updatedAt,
  };
}
