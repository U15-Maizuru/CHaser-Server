import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistedState } from './usePersistedState';

interface Params { blockNum: number; itemNum: number }
const DEFAULTS: Params = { blockNum: 20, itemNum: 51 };
const KEY = 'u15_test_params';

beforeEach(() => localStorage.clear());

describe('usePersistedState', () => {
  it('未保存なら既定値、update すると localStorage に書き込む', () => {
    const { result } = renderHook(() => usePersistedState(KEY, DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);

    act(() => result.current[1]({ blockNum: 8 }));
    expect(result.current[0]).toEqual({ blockNum: 8, itemNum: 51 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ blockNum: 8, itemNum: 51 });
  });

  // storage イベントは仕様上「変更元のウィンドウでは発火しない」ため、同じウィンドウ内の
  // 別インスタンスへは購読レジストリで伝える。これが無いと、入力欄を持つコンポーネント
  // (MapSourceSection) と送信するコンポーネント (App) で値がずれる。
  it('同じウィンドウ内の別インスタンスへ変更が伝わる', () => {
    const a = renderHook(() => usePersistedState(KEY, DEFAULTS));
    const b = renderHook(() => usePersistedState(KEY, DEFAULTS));

    act(() => a.result.current[1]({ blockNum: 8 }));

    expect(a.result.current[0].blockNum).toBe(8);
    expect(b.result.current[0].blockNum).toBe(8);
  });

  it('連続 update でも取りこぼさない', () => {
    const a = renderHook(() => usePersistedState(KEY, DEFAULTS));
    const b = renderHook(() => usePersistedState(KEY, DEFAULTS));

    act(() => {
      a.result.current[1]({ blockNum: 8 });
      a.result.current[1]({ itemNum: 3 });
    });

    expect(a.result.current[0]).toEqual({ blockNum: 8, itemNum: 3 });
    expect(b.result.current[0]).toEqual({ blockNum: 8, itemNum: 3 });
  });

  it('アンマウントされたインスタンスへは通知しない (購読解除)', () => {
    const a = renderHook(() => usePersistedState(KEY, DEFAULTS));
    const b = renderHook(() => usePersistedState(KEY, DEFAULTS));
    b.unmount();

    expect(() => act(() => a.result.current[1]({ blockNum: 8 }))).not.toThrow();
    expect(a.result.current[0].blockNum).toBe(8);
  });
});
