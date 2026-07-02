import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTextures } from './useTextures';

class FakeImage {
  onload:  (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(value: string) {
    this._src = value;
    // jsdom は実際に画像を読み込まないため、非同期に onload/onerror を発火してブラウザの読込を模倣する
    queueMicrotask(() => {
      if (FakeImage.shouldFail(value)) this.onerror?.();
      else this.onload?.();
    });
  }
  static failPattern: RegExp | null = null;
  static shouldFail(src: string): boolean {
    return FakeImage.failPattern ? FakeImage.failPattern.test(src) : false;
  }
}

describe('useTextures', () => {
  beforeEach(() => {
    FakeImage.failPattern = null;
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('初期状態は空オブジェクト', () => {
    const { result } = renderHook(() => useTextures('Jewel'));
    expect(result.current).toEqual({});
  });

  it('全テクスチャの読込に成功すると5キー分のImageを返す', async () => {
    const { result } = renderHook(() => useTextures('Jewel'));

    await waitFor(() => {
      expect(Object.keys(result.current)).toHaveLength(5);
    });

    for (const key of ['Floor', 'Block', 'Item', 'Cool', 'Hot'] as const) {
      expect(result.current[key]).toBeInstanceOf(FakeImage);
    }
  });

  it('一部の読込が失敗しても (onerror) 残りの読込完了時点で state が確定する', async () => {
    FakeImage.failPattern = /Block\.png$/;
    const { result } = renderHook(() => useTextures('Jewel'));

    await waitFor(() => {
      // Block 以外の4キーが揃った時点で確定しているはず
      expect(Object.keys(result.current)).toHaveLength(4);
    });

    expect(result.current.Block).toBeUndefined();
    expect(result.current.Floor).toBeInstanceOf(FakeImage);
  });

  it('theme が変わると即座に空へリセットしてから再読込する', async () => {
    const { result, rerender } = renderHook(({ theme }) => useTextures(theme), {
      initialProps: { theme: 'Jewel' },
    });
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(5));

    rerender({ theme: 'Retro' });
    expect(result.current).toEqual({});

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(5));
  });
});
