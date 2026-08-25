import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InlineMapData } from '@u15/ws-types';
import {
  addMapCatalogEntry,
  addMapCatalogEntryFromInline,
  deleteMapCatalogEntry,
  ensureMapCatalogDir,
  getMapCatalogEntry,
  listMapCatalogEntries,
  mapCatalogDir,
  seedDefaultMapLibrary,
} from './mapCatalog.js';

const DEFAULT_MAP_LIBRARY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'map-library');
const DEFAULT_MAP_COUNT       = fs.readdirSync(DEFAULT_MAP_LIBRARY_DIR).length;

const VALID_MAP = [
  'N:sample',
  'T:100',
  'S:3,3',
  'D:0,0,0',
  'D:0,3,2',
  'D:0,0,0',
  'C:0,0',
  'H:2,2',
].join('\n');

function makeTempFile(name: string, content = VALID_MAP): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-map-catalog-upload-'));
  const filePath = path.join(tmp, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

const inlineData: InlineMapData = {
  field: [
    [0, 0, 0],
    [0, 3, 2],
    [0, 0, 0],
  ],
  size: { x: 3, y: 3 },
  turn: 80,
  teamFirstPoint: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
};

describe('mapCatalog', () => {
  beforeEach(() => {
    ensureMapCatalogDir();
  });

  afterEach(() => {
    fs.rmSync(mapCatalogDir(), { recursive: true, force: true });
  });

  it('ensureMapCatalogDir はディレクトリと空の index.json を作成する', () => {
    expect(fs.existsSync(mapCatalogDir())).toBe(true);
    expect(listMapCatalogEntries()).toEqual([]);
  });

  it('addMapCatalogEntry は .map ファイルを id ベースの名前へ移動し、メタデータを解析する', () => {
    const tempPath = makeTempFile('sample.map');
    const entry = addMapCatalogEntry('sample.map', tempPath);

    expect(entry).not.toBeNull();
    expect(entry!.displayName).toBe('sample.map');
    expect(entry!.mapPath).toContain(entry!.id);
    expect(fs.existsSync(entry!.mapPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(entry!.size).toEqual({ x: 3, y: 3 });
    expect(entry!.turn).toBe(100);
    expect(entry!.blockCount).toBe(1);
    expect(entry!.itemCount).toBe(1);

    expect(listMapCatalogEntries()).toEqual([entry]);
    expect(getMapCatalogEntry(entry!.id)).toEqual(entry);
  });

  it('addMapCatalogEntry は認識できない内容のファイルでも既定値のマップとして登録する (importMap は寛容にパースするため)', () => {
    const tempPath = makeTempFile('broken.map', 'not a valid map file');
    const entry = addMapCatalogEntry('broken.map', tempPath);

    expect(entry).not.toBeNull();
    expect(entry!.size).toEqual({ x: 15, y: 17 });
    expect(entry!.blockCount).toBe(0);
    expect(entry!.itemCount).toBe(0);
  });

  it('addMapCatalogEntryFromInline はエディタのマップを .map として書き出して登録する', () => {
    const entry = addMapCatalogEntryFromInline('エディタで作成', inlineData);

    expect(entry.displayName).toBe('エディタで作成');
    expect(entry.size).toEqual(inlineData.size);
    expect(entry.turn).toBe(80);
    expect(entry.blockCount).toBe(1);
    expect(entry.itemCount).toBe(1);
    expect(fs.existsSync(entry.mapPath)).toBe(true);

    const content = fs.readFileSync(entry.mapPath, 'utf-8');
    expect(content).toContain('N:エディタで作成');

    expect(listMapCatalogEntries()).toEqual([entry]);
  });

  it('deleteMapCatalogEntry は実体ファイルと index のエントリを削除する', () => {
    const entry = addMapCatalogEntryFromInline('削除対象', inlineData);
    deleteMapCatalogEntry(entry.id);

    expect(fs.existsSync(entry.mapPath)).toBe(false);
    expect(listMapCatalogEntries()).toEqual([]);
  });

  it('seedDefaultMapLibrary は同梱の過去大会マップを一括登録する', () => {
    seedDefaultMapLibrary();

    const entries = listMapCatalogEntries();
    expect(entries).toHaveLength(DEFAULT_MAP_COUNT);
    const names = entries.map(e => e.displayName).sort();
    expect(names).toEqual(
      fs.readdirSync(DEFAULT_MAP_LIBRARY_DIR).map(f => f.replace(/\.map$/, '')).sort(),
    );
  });

  it('seedDefaultMapLibrary は2回呼んでも重複登録しない', () => {
    seedDefaultMapLibrary();
    seedDefaultMapLibrary();

    expect(listMapCatalogEntries()).toHaveLength(DEFAULT_MAP_COUNT);
  });

  it('seedDefaultMapLibrary は削除済みの既定マップを復活させない', () => {
    seedDefaultMapLibrary();
    const [first] = listMapCatalogEntries();
    deleteMapCatalogEntry(first!.id);

    seedDefaultMapLibrary();

    expect(listMapCatalogEntries()).toHaveLength(DEFAULT_MAP_COUNT - 1);
  });
});
