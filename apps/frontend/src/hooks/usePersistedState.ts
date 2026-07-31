import { useCallback, useEffect, useState } from 'react';

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

/**
 * localStorage に永続化される設定オブジェクトを保持する。
 * 別ウィンドウ (コントロール/観戦/手動操作) で変更された場合は storage イベントで同期する。
 * 標準仕様どおり、変更元の自ウィンドウでは storage イベントは発火しない。
 *
 * `defaults` はモジュールレベルの定数を渡すこと (レンダーごとに新しいオブジェクトを渡さない)。
 */
export function usePersistedState<T extends object>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(() => loadPersisted(key, defaults));

  const update = useCallback((patch: Partial<T>) => {
    setValue(prev => {
      const next = { ...prev, ...patch };
      savePersisted(key, next);
      return next;
    });
  }, [key]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setValue(loadPersisted(key, defaults));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  // defaults はモジュール定数を前提とするため依存に含めない
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, update] as const;
}
