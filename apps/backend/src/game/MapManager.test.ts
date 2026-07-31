import { describe, expect, it } from 'vitest';
import { MapManager } from './MapManager.js';

describe('MapManager.isCustom', () => {
  it('構築直後 (パラメータからのランダム生成) は isCustom が false', () => {
    const mm = new MapManager();
    expect(mm.isCustom).toBe(false);
  });

  it('setParams / regenerate 後も isCustom は false のまま', () => {
    const mm = new MapManager();
    mm.setParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
    expect(mm.isCustom).toBe(false);
    mm.regenerate();
    expect(mm.isCustom).toBe(false);
  });

  it('loadInlineData (マップエディタ由来) は isCustom を true にする', () => {
    const mm = new MapManager();
    mm.loadInlineData({
      field: [[0]],
      size: { x: 1, y: 1 },
      turn: 10,
      teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    });
    expect(mm.isCustom).toBe(true);
  });

  it('isCustom=true の状態から setParams すると false に戻る (ランダム生成に切り替え)', () => {
    const mm = new MapManager();
    mm.loadInlineData({
      field: [[0]],
      size: { x: 1, y: 1 },
      turn: 10,
      teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    });
    expect(mm.isCustom).toBe(true);

    mm.setParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
    expect(mm.isCustom).toBe(false);
  });
});
