import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CatalogEntry } from '@u15/ws-types';
import { JsonIndexStore } from './catalog/JsonIndexStore.js';
import { extractDeclaredName } from './programName.js';

// 対戦用プログラムの永続保存先。room/slot に紐付かず、アプリ・システムの再起動を
// またいで保持される (server/maps, server/music と同じ層のグローバルディレクトリ)。
const store = new JsonIndexStore<CatalogEntry>('server/program-catalog');

export function ensureCatalogDir(): void {
  store.ensureDir();
}

export function catalogDir(): string {
  return store.dir;
}

export function listCatalogEntries(): CatalogEntry[] {
  return store.read()
    .filter(e => fs.existsSync(e.programPath))
    .map(withDeclaredName);
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  const entry = store.find(id);
  return entry && withDeclaredName(entry);
}

/**
 * アップロード済みの一時ファイル (tempPath) を id+拡張子の名前へリネームして登録する。
 * 同名ファイルを複数回アップロードしても on-disk では衝突しない (表示名は displayName に保持)。
 */
export function addCatalogEntry(displayName: string, tempPath: string): CatalogEntry {
  const id        = randomUUID();
  const finalPath = path.join(store.dir, `${id}${path.extname(tempPath)}`);
  fs.renameSync(tempPath, finalPath);

  const entry: CatalogEntry = {
    id,
    displayName,
    programPath:    finalPath,
    programType:    'python',
    runtimeCommand: 'python',
    uploadedAt:     Date.now(),
    demoEnabled:    true,
  };

  store.add(entry);
  return withDeclaredName(entry);
}

/**
 * プログラムが名乗るプレイヤー名をソースから読み取って付け足す。
 *
 * index.json には保存しない。JSON は undefined を落とすため「名前が無い」ことを
 * 保存できず、結局どちらにせよ毎回読み直すことになるので、都度パースに統一する
 * (対象は数十件の小さな .py で、カタログを引くのはダイアログを開いたときだけ)。
 * 読めない・パースできない場合は名前なしとして扱い、カタログ自体は壊さない。
 */
function withDeclaredName(entry: CatalogEntry): CatalogEntry {
  if (path.extname(entry.programPath).toLowerCase() !== '.py') return entry;
  try {
    const declaredName = extractDeclaredName(fs.readFileSync(entry.programPath, 'utf-8'));
    return declaredName === undefined ? entry : { ...entry, declaredName };
  } catch {
    return entry;
  }
}

export function deleteCatalogEntry(id: string): void {
  const entry = store.remove(id);
  if (entry && fs.existsSync(entry.programPath)) fs.unlinkSync(entry.programPath);
}

export function setDemoEnabled(id: string, enabled: boolean): CatalogEntry | undefined {
  const entries = store.read();
  const entry   = entries.find(e => e.id === id);
  if (!entry) return undefined;
  entry.demoEnabled = enabled;
  store.write(entries);
  return entry;
}

/** デモモード用: デモ対象 (demoEnabled) のエントリからランダムに2つ選ぶ。1件しか無ければ同じものを2つ返す。 */
export function pickRandomPair(): [CatalogEntry, CatalogEntry] | null {
  const candidates = listCatalogEntries().filter(e => e.demoEnabled);
  if (candidates.length === 0) return null;

  const a = candidates[Math.floor(Math.random() * candidates.length)]!;
  if (candidates.length === 1) return [a, a];

  let b = a;
  while (b.id === a.id) {
    b = candidates[Math.floor(Math.random() * candidates.length)]!;
  }
  return [a, b];
}
