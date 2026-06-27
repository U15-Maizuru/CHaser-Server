import { useCallback, useState } from 'react';

export interface AppSettings {
  // ゲーム
  timeout:    number;   // TCP タイムアウト (秒)
  turnDelay:  number;   // 1ターンの表示待機時間 (ミリ秒)
  muted:      boolean;  // SE ミュート
  doubleMode: boolean;  // 2試合制
  // テクスチャ
  theme:    string;   // 'Jewel' | 'Light' | 'Heavy' | 'RPG'
  // ランダムマップ
  itemNum:  number;
  blockNum: number;
  turnNum:  number;
  mirror:   boolean;
}

const DEFAULTS: AppSettings = {
  timeout:    5,
  turnDelay:  1000,
  muted:      false,
  doubleMode: false,
  theme:      'Jewel',
  itemNum:    51,
  blockNum:   20,
  turnNum:    100,
  mirror:     true,
};

const STORAGE_KEY = 'u15_settings';

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) as Partial<AppSettings> };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function save(s: AppSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { settings, update };
}
