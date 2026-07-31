import { useCallback, useEffect, useState } from 'react';

export interface AppSettings {
  // ゲーム
  timeout:    number;   // TCP タイムアウト (秒)
  turnDelay:  number;   // 1ターンの表示待機時間 (ミリ秒)
  muted:      boolean;  // SE ミュート
  doubleMode: boolean;  // 2試合制
  repeatMode: boolean;  // リピートモード (試合終了後、接続を維持したまま再戦できるようにする)
  demoMode:   boolean;  // デモモード (無人自動進行)
  bgmMuted:   boolean;  // BGM ミュート (SE 用の muted とは別)
  bgmTrack:   string;   // 選択中の BGM ファイル名 ('none' = 再生しない)
  // 環境 (Electron ローカル限定)
  logDir:        string; // ログ保存先ディレクトリ ('' = 既定値のまま変更しない)
  pythonCommand: string; // Python 実行コマンドの上書き ('' = 既定 (同梱 Python / PATH) を使う)
  // テクスチャ
  theme:    string;   // 'Jewel' | 'Light' | 'Heavy' | 'RPG'
}

const DEFAULTS: AppSettings = {
  timeout:    10,
  turnDelay:  1000,
  muted:      false,
  doubleMode: false,
  repeatMode: false,
  demoMode:   false,
  bgmMuted:   false,
  bgmTrack:   'none',
  logDir:        '',
  pythonCommand: '',
  theme:      'Jewel',
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

  // 別ウィンドウ (コントロール/観戦/手動操作) で設定が変更された場合に同期する。
  // 同一オリジンの別ドキュメントで localStorage が変わったときだけ発火し、
  // 変更元の自ウィンドウでは発火しない (標準の storage イベント仕様)。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setSettings(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { settings, update };
}
