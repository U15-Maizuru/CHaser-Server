import { useCallback, useEffect, useRef, useState } from 'react';

// 旧・一枚岩の設定キー。useSettings を性質別のフックへ分割した際の移行用に、
// 新しいキーがまだ存在しない場合に限り、該当するフィールドだけを引き継ぐ。
const LEGACY_KEY = 'u15_settings';

export function loadPersisted<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) as Partial<T> };

    // 新キーが無いときだけ旧キーから拾う (旧キー自体は消さない — 他のフックもまだ参照しうるため)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const k of Object.keys(defaults)) {
        if (k in parsed) picked[k] = parsed[k];
      }
      return { ...defaults, ...picked as Partial<T> };
    }
  } catch { /* ignore */ }
  return { ...defaults };
}

function savePersisted<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// 同一ウィンドウ内の購読者。storage イベントは仕様上「変更元のウィンドウでは発火しない」ため、
// これが無いと同じキーを使う別コンポーネントが古い値を持ち続ける。
// (例: マップ生成パラメータは MapSourceSection の入力欄が書き換え、送信するのは App。
//  同期しないと App は読み込み時点の値を送り続け、パネルの数値が反映されない)
type Subscriber = (next: unknown) => void;
const subscribers = new Map<string, Set<Subscriber>>();

function notifyLocal(key: string, next: unknown, self: Subscriber | undefined): void {
  for (const fn of subscribers.get(key) ?? []) {
    if (fn !== self) fn(next);
  }
}

/**
 * localStorage に永続化される設定オブジェクトを保持する。
 * 別ウィンドウ (コントロール/観戦/手動操作) とは storage イベントで、
 * 同じウィンドウ内の他インスタンスとは購読レジストリで同期する。
 *
 * `defaults` はモジュールレベルの定数を渡すこと (レンダーごとに新しいオブジェクトを渡さない)。
 */
export function usePersistedState<T extends object>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => loadPersisted(key, defaults));

  // 連続更新でも取りこぼさないよう、次の値は最新値から作る
  const valueRef = useRef(value);
  const selfRef  = useRef<Subscriber>();

  const apply = useCallback((next: unknown) => {
    valueRef.current = next as T;
    setValue(next as T);
  }, []);

  const update = useCallback((patch: Partial<T>) => {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    savePersisted(key, next);
    setValue(next);
    notifyLocal(key, next, selfRef.current);
  }, [key]);

  useEffect(() => {
    const self: Subscriber = next => apply(next);
    selfRef.current = self;
    const set = subscribers.get(key) ?? new Set<Subscriber>();
    set.add(self);
    subscribers.set(key, set);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      apply(loadPersisted(key, defaults));
    };
    window.addEventListener('storage', onStorage);
    return () => {
      set.delete(self);
      if (set.size === 0) subscribers.delete(key);
      window.removeEventListener('storage', onStorage);
    };
  // defaults はモジュール定数を前提とするため依存に含めない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update] as const;
}
