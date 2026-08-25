import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { InlineMapData, MapCatalogEntry } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { exportMap, importMap } from './game/GameSystem.js';
import { toGameMap } from './game/inlineMap.js';
import { JsonIndexStore } from './catalog/JsonIndexStore.js';

// マップの永続保存先。room/slot に紐付かず、アプリ・システムの再起動をまたいで
// 保持される (server/program-catalog, server/music と同じ層のグローバルディレクトリ)。
const store = new JsonIndexStore<MapCatalogEntry>('server/map-catalog');

export function ensureMapCatalogDir(): void {
  store.ensureDir();
}

// 既定で同梱する過去大会マップ。実行時ロケーションと同じ階層に assets/map-library を
// 置く運用は assets/lib-templates (libTemplates.ts) と同じ。
const DEFAULT_MAP_LIBRARY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'map-library');
const SEEDED_MARKER_PATH      = () => path.join(store.dir, '.default-maps-seeded.json');

/**
 * 同梱の過去大会マップをマップライブラリへ取り込む。
 *
 * 導入済みかどうかはファイル名を記録した marker で判定する。index.json (実際のカタログ)
 * ではなく marker を見るのは、運営が既定マップを削除しても次回起動で復活させないため
 * — 削除後に index.json だけを見ると「無い = 未導入」と誤判定して再登録してしまう。
 */
export function seedDefaultMapLibrary(): void {
  store.ensureDir();
  if (!fs.existsSync(DEFAULT_MAP_LIBRARY_DIR)) return;

  const markerPath = SEEDED_MARKER_PATH();
  const seeded = new Set<string>(
    fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as string[] : [],
  );

  let changed = false;
  for (const filename of fs.readdirSync(DEFAULT_MAP_LIBRARY_DIR)) {
    if (seeded.has(filename)) continue;
    const tempPath = path.join(store.dir, `.seed-${filename}`);
    fs.copyFileSync(path.join(DEFAULT_MAP_LIBRARY_DIR, filename), tempPath);
    addMapCatalogEntry(filename.replace(/\.map$/, ''), tempPath);
    seeded.add(filename);
    changed = true;
  }
  if (changed) fs.writeFileSync(markerPath, JSON.stringify([...seeded]));
}

export function mapCatalogDir(): string {
  return store.dir;
}

export function listMapCatalogEntries(): MapCatalogEntry[] {
  return store.read().filter(e => fs.existsSync(e.mapPath));
}

export function getMapCatalogEntry(id: string): MapCatalogEntry | undefined {
  return store.find(id);
}

/**
 * アップロード済みの一時ファイル (tempPath) を id ベースの名前へリネームして登録する。
 * importMap は内容を寛容にパースする (未知の行は無視して既定値で埋める)ため、
 * 実際に null を返すのはファイル読み込み自体に失敗した場合のみ。
 */
export function addMapCatalogEntry(displayName: string, tempPath: string): MapCatalogEntry | null {
  const id        = randomUUID();
  const finalPath = path.join(store.dir, `${id}.map`);
  fs.renameSync(tempPath, finalPath);

  const parsed = importMap(finalPath);
  if (!parsed) {
    fs.unlinkSync(finalPath);
    return null;
  }

  const entry: MapCatalogEntry = {
    id,
    displayName,
    mapPath:    finalPath,
    uploadedAt: Date.now(),
    size:       parsed.size,
    turn:       parsed.turn,
    blockCount: countObj(parsed.field, MapObject.BLOCK),
    itemCount:  countObj(parsed.field, MapObject.ITEM),
  };

  store.add(entry);
  return entry;
}

/** マップエディタで組んだインラインデータを、既存の .map テキスト形式でカタログへ書き出して登録する。 */
export function addMapCatalogEntryFromInline(displayName: string, data: InlineMapData): MapCatalogEntry {
  const id        = randomUUID();
  const finalPath = path.join(store.dir, `${id}.map`);

  const gameMap = toGameMap(data, displayName);
  exportMap(gameMap, finalPath);
  // exportMap は "N:" 行をファイル名 (id ベース) から生成するため、表示名で上書きする。
  // (exportMap 自体が既定の utf-8 で書き込むため、読み戻しも utf-8 で揃える)
  const content = fs.readFileSync(finalPath, 'utf-8');
  fs.writeFileSync(finalPath, content.replace(/^N:.*/, `N:${displayName}`), 'utf-8');

  const entry: MapCatalogEntry = {
    id,
    displayName,
    mapPath:    finalPath,
    uploadedAt: Date.now(),
    size:       data.size,
    turn:       data.turn,
    blockCount: countObj(gameMap.field, MapObject.BLOCK),
    itemCount:  countObj(gameMap.field, MapObject.ITEM),
  };

  store.add(entry);
  return entry;
}

export function deleteMapCatalogEntry(id: string): void {
  const entry = store.remove(id);
  if (entry && fs.existsSync(entry.mapPath)) fs.unlinkSync(entry.mapPath);
}

function countObj(field: MapObject[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}
