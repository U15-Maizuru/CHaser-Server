import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MapManager } from './MapManager.js';
import { exportMap } from './GameSystem.js';

const INLINE = {
  field: [[0]],
  size: { x: 1, y: 1 },
  turn: 10,
  teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }] as [{ x: number; y: number }, { x: number; y: number }],
};

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

/** カタログの .map ファイルを模した一時ファイルを作る */
function writeTempMap(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-mapmanager-test-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'fixture.map');
  exportMap({
    field: [[0, 0], [0, 0]],
    turn: 42,
    name: 'fixture',
    size: { x: 2, y: 2 },
    teamFirstPoint: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    textureDirPath: 'Jewel',
  }, file);
  return file;
}

describe('MapManager.sourceInfo', () => {
  it('構築直後 (パラメータからのランダム生成) は random', () => {
    const mm = new MapManager();
    expect(mm.sourceInfo).toEqual({ kind: 'random' });
  });

  it('setParams / regenerate 後も random のまま', () => {
    const mm = new MapManager();
    mm.setParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
    expect(mm.sourceInfo.kind).toBe('random');
    mm.regenerate();
    expect(mm.sourceInfo.kind).toBe('random');
  });

  it('loadInlineData (マップエディタ由来) は editor になる', () => {
    const mm = new MapManager();
    mm.loadInlineData(INLINE);
    expect(mm.sourceInfo).toEqual({ kind: 'editor' });
  });

  it('loadFromCatalog はライブラリのエントリを選択状態として覚える', () => {
    const mm = new MapManager();
    expect(mm.loadFromCatalog(writeTempMap(), 'id-1', '決戦マップ')).toBe(true);
    expect(mm.sourceInfo).toEqual({ kind: 'catalog', catalogId: 'id-1', displayName: '決戦マップ' });
    expect(mm.map.turn).toBe(42);
  });

  it('読み込めないファイルなら false を返し、選択状態を変えない', () => {
    const mm = new MapManager();
    mm.loadInlineData(INLINE);
    expect(mm.loadFromCatalog('/does/not/exist.map', 'id-1', 'なし')).toBe(false);
    expect(mm.sourceInfo.kind).toBe('editor');
  });

  it('editor / catalog の状態から setParams すると random に戻る (ランダム生成に切り替え)', () => {
    const mm = new MapManager();
    mm.loadInlineData(INLINE);
    expect(mm.sourceInfo.kind).toBe('editor');

    mm.setParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
    expect(mm.sourceInfo.kind).toBe('random');
  });
});

describe('MapManager.refreshForNewGame', () => {
  it('random のときは新しいマップを引き直す', () => {
    const mm = new MapManager();
    // 引き直しが起きたことを、生成物の同一性 (参照) で判定する
    const before = mm.map;
    mm.refreshForNewGame();
    expect(mm.map).not.toBe(before);
    expect(mm.sourceInfo.kind).toBe('random');
  });

  it('editor (マップエディタ由来) のマップはリセット・リピートでも残る', () => {
    const mm = new MapManager();
    mm.loadInlineData(INLINE);
    const before = mm.map;
    mm.refreshForNewGame();
    expect(mm.map).toBe(before);
    expect(mm.sourceInfo.kind).toBe('editor');
  });

  it('catalog (ライブラリから選んだ) マップはリセット・リピートでも残る', () => {
    const mm = new MapManager();
    mm.loadFromCatalog(writeTempMap(), 'id-1', '決戦マップ');
    const before = mm.map;
    mm.refreshForNewGame();
    expect(mm.map).toBe(before);
    expect(mm.sourceInfo).toEqual({ kind: 'catalog', catalogId: 'id-1', displayName: '決戦マップ' });
  });
});
