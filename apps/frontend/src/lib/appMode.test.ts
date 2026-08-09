import { describe, it, expect } from 'vitest';
import { appWindowTitle, readAppLocation } from './appMode';

describe('readAppLocation', () => {
  it('room が無ければロビー (roomId=null)', () => {
    expect(readAppLocation('').roomId).toBeNull();
  });

  it('Electron が組み立てる4つの mode をそのまま読む', () => {
    for (const mode of ['display', 'control', 'manual', 'tournament'] as const) {
      expect(readAppLocation(`?room=local&mode=${mode}`).mode).toBe(mode);
    }
  });

  // 観戦画面は読むだけなので、指定ミスで操作画面が開くより安全side に倒す
  it('mode が無い・知らない値なら display に倒す', () => {
    expect(readAppLocation('?room=local').mode).toBe('display');
    expect(readAppLocation('?room=local&mode=typo').mode).toBe('display');
  });

  it('slot は 1 のときだけ 1、それ以外は 0', () => {
    expect(readAppLocation('?room=local&mode=manual&slot=1').slot).toBe(1);
    expect(readAppLocation('?room=local&mode=manual&slot=0').slot).toBe(0);
    expect(readAppLocation('?room=local&mode=manual').slot).toBe(0);
  });
});

describe('appWindowTitle', () => {
  const titleOf = (search: string) => appWindowTitle(readAppLocation(search));

  it('用途を先頭に置く (タスクバー・タブは末尾から削られるため)', () => {
    expect(titleOf('?room=local&mode=display')).toBe('対戦表示 — CHaser Server');
    expect(titleOf('?room=local&mode=control')).toBe('コントロール — CHaser Server');
    expect(titleOf('?room=local&mode=tournament')).toBe('大会運営 — CHaser Server');
  });

  it('手動操作はスロットまで出す (COOL と HOT で2枚開く)', () => {
    expect(titleOf('?room=local&mode=manual&slot=0')).toBe('手動操作 (COOL) — CHaser Server');
    expect(titleOf('?room=local&mode=manual&slot=1')).toBe('手動操作 (HOT) — CHaser Server');
  });

  it('room なし (ロビー) も専用の名前を持つ', () => {
    expect(titleOf('')).toBe('ロビー — CHaser Server');
  });

  // 並べて区別できることがこの関数の目的なので、重複が出たら失敗させる
  it('同時に開きうるウィンドウのタイトルが重複しない', () => {
    const titles = [
      '?room=local&mode=display',
      '?room=local&mode=control',
      '?room=local&mode=tournament',
      '?room=local&mode=manual&slot=0',
      '?room=local&mode=manual&slot=1',
    ].map(titleOf);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
