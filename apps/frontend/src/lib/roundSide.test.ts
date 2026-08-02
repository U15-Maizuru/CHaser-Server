import { describe, it, expect } from 'vitest';
import { idxForSide } from './roundSide';

describe('idxForSide', () => {
  it('第1ゲーム (round=0) は side どおりの team-index を返す', () => {
    expect(idxForSide(0, 0)).toBe(0); // 左=COOL(先攻)
    expect(idxForSide(1, 0)).toBe(1); // 右=HOT(後攻)
  });

  it('第2ゲーム (round=1) は先攻/後攻が入れ替わるため team-index も反転する', () => {
    expect(idxForSide(0, 1)).toBe(1); // 左=HOT(後攻)
    expect(idxForSide(1, 1)).toBe(0); // 右=COOL(先攻)
  });
});
