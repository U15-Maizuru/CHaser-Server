import fs from 'node:fs';
import path from 'node:path';
import type { DisplayPrefs } from '@u15/ws-types';

/**
 * ローカルモード (Electron) の唯一の room に限って永続化する設定。
 * web モードの room やテストでは使わない (呼び出し側で opt-in するまで発火しない)。
 */
export interface LocalSettings {
  darkMode:     boolean;
  displayPrefs: DisplayPrefs;
  doubleMode:   boolean;
  repeatMode:   boolean;
  demoMode:     boolean;
}

/** 読めない・壊れている場合は空として扱う (呼び出し側がデフォルト値にマージする) */
export function loadLocalSettings(filePath: string): Partial<LocalSettings> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LocalSettings>;
  } catch {
    return {};
  }
}

/** 保存に失敗しても対戦の続行を妨げないよう、握りつぶす */
export function saveLocalSettings(filePath: string, settings: LocalSettings): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  } catch { /* ignore */ }
}
