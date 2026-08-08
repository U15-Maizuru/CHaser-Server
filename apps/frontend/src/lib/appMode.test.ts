import { describe, it, expect } from 'vitest';
import { readAppLocation } from './appMode';

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
