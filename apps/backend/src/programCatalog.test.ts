import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCatalogEntry,
  catalogDir,
  deleteCatalogEntry,
  ensureCatalogDir,
  getCatalogEntry,
  listCatalogEntries,
  pickRandomPair,
  setDemoEnabled,
} from './programCatalog.js';

function makeTempFile(name: string, content = 'print("hi")'): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-catalog-upload-'));
  const filePath = path.join(tmp, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('programCatalog', () => {
  beforeEach(() => {
    ensureCatalogDir();
  });

  afterEach(() => {
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  it('ensureCatalogDir はディレクトリと空の index.json を作成する', () => {
    expect(fs.existsSync(catalogDir())).toBe(true);
    expect(listCatalogEntries()).toEqual([]);
  });

  it('addCatalogEntry はファイルを id ベースの名前へ移動し、デモ対象を既定で有効にする', () => {
    const tempPath = makeTempFile('main.py');
    const entry    = addCatalogEntry('main.py', tempPath);

    expect(entry.displayName).toBe('main.py');
    expect(entry.demoEnabled).toBe(true);
    expect(entry.programPath).toContain(entry.id);
    expect(fs.existsSync(entry.programPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false); // リネームにより元ファイルは消える

    expect(listCatalogEntries()).toEqual([entry]);
    expect(getCatalogEntry(entry.id)).toEqual(entry);
  });

  it('同名ファイルを複数回アップロードしても on-disk では衝突しない', () => {
    const entryA = addCatalogEntry('main.py', makeTempFile('main.py', 'A'));
    const entryB = addCatalogEntry('main.py', makeTempFile('main.py', 'B'));

    expect(entryA.id).not.toBe(entryB.id);
    expect(entryA.programPath).not.toBe(entryB.programPath);
    expect(fs.readFileSync(entryA.programPath, 'utf-8')).toBe('A');
    expect(fs.readFileSync(entryB.programPath, 'utf-8')).toBe('B');
    expect(listCatalogEntries()).toHaveLength(2);
  });

  it('deleteCatalogEntry は実体ファイルと index のエントリを削除する', () => {
    const entry = addCatalogEntry('main.py', makeTempFile('main.py'));
    deleteCatalogEntry(entry.id);

    expect(fs.existsSync(entry.programPath)).toBe(false);
    expect(listCatalogEntries()).toEqual([]);
  });

  it('setDemoEnabled はデモ対象フラグを更新する', () => {
    const entry = addCatalogEntry('main.py', makeTempFile('main.py'));
    const updated = setDemoEnabled(entry.id, false);

    expect(updated?.demoEnabled).toBe(false);
    expect(getCatalogEntry(entry.id)?.demoEnabled).toBe(false);
  });

  describe('pickRandomPair', () => {
    it('エントリが無ければ null', () => {
      expect(pickRandomPair()).toBeNull();
    });

    it('デモ対象が無ければ null (demoEnabled=false は除外される)', () => {
      const entry = addCatalogEntry('main.py', makeTempFile('main.py'));
      setDemoEnabled(entry.id, false);
      expect(pickRandomPair()).toBeNull();
    });

    it('1件のみなら同じエントリを2つ返す', () => {
      const entry = addCatalogEntry('main.py', makeTempFile('main.py'));
      const pair  = pickRandomPair();
      expect(pair).toEqual([entry, entry]);
    });

    it('2件以上ならデモ対象の中から異なる2件を返す', () => {
      const a = addCatalogEntry('a.py', makeTempFile('a.py'));
      const b = addCatalogEntry('b.py', makeTempFile('b.py'));
      const c = addCatalogEntry('c.py', makeTempFile('c.py'));
      setDemoEnabled(c.id, false); // デモ対象から除外

      for (let i = 0; i < 20; i++) {
        const pair = pickRandomPair();
        expect(pair).not.toBeNull();
        const [p0, p1] = pair!;
        expect([a.id, b.id]).toContain(p0.id);
        expect([a.id, b.id]).toContain(p1.id);
        expect(p0.id).not.toBe(p1.id);
      }
    });
  });
});
