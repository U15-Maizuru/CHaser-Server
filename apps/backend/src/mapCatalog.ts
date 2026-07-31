import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InlineMapData, MapCatalogEntry } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { exportMap, importMap } from './game/GameSystem.js';
import type { GameMap } from './game/types.js';

// マップの永続保存先。room/slot に紐付かず、アプリ・システムの再起動をまたいで
// 保持される (server/program-catalog, server/music と同じ層のグローバルディレクトリ)。
const CATALOG_DIR = path.resolve('server/map-catalog');
const INDEX_PATH  = path.join(CATALOG_DIR, 'index.json');

export function ensureMapCatalogDir(): void {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) {
    writeIndex([]);
  }
}

export function mapCatalogDir(): string {
  return CATALOG_DIR;
}

export function listMapCatalogEntries(): MapCatalogEntry[] {
  return readIndex().filter(e => fs.existsSync(e.mapPath));
}

export function getMapCatalogEntry(id: string): MapCatalogEntry | undefined {
  return readIndex().find(e => e.id === id);
}

/**
 * アップロード済みの一時ファイル (tempPath) を id ベースの名前へリネームして登録する。
 * importMap は内容を寛容にパースする (未知の行は無視して既定値で埋める)ため、
 * 実際に null を返すのはファイル読み込み自体に失敗した場合のみ。
 */
export function addMapCatalogEntry(displayName: string, tempPath: string): MapCatalogEntry | null {
  const id        = randomUUID();
  const finalPath = path.join(CATALOG_DIR, `${id}.map`);
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

  const entries = readIndex();
  entries.push(entry);
  writeIndex(entries);
  return entry;
}

/** マップエディタで組んだインラインデータを、既存の .map テキスト形式でカタログへ書き出して登録する。 */
export function addMapCatalogEntryFromInline(displayName: string, data: InlineMapData): MapCatalogEntry {
  const id        = randomUUID();
  const finalPath = path.join(CATALOG_DIR, `${id}.map`);

  const gameMap: GameMap = {
    field:          data.field as MapObject[][],
    turn:           data.turn,
    name:           displayName,
    size:           data.size,
    teamFirstPoint: data.teamFirstPoint,
    textureDirPath: 'Jewel',
  };
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

  const entries = readIndex();
  entries.push(entry);
  writeIndex(entries);
  return entry;
}

export function deleteMapCatalogEntry(id: string): void {
  const entries = readIndex();
  const entry   = entries.find(e => e.id === id);
  if (!entry) return;
  if (fs.existsSync(entry.mapPath)) fs.unlinkSync(entry.mapPath);
  writeIndex(entries.filter(e => e.id !== id));
}

function countObj(field: MapObject[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}

function readIndex(): MapCatalogEntry[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')) as MapCatalogEntry[];
  } catch {
    return [];
  }
}

function writeIndex(entries: MapCatalogEntry[]): void {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2));
}
