import { usePersistedState } from './usePersistedState';

/**
 * Electron ローカル起動時のみ意味を持つ環境設定。
 * バックエンドも U15_MODE!=='local' では無視する (リモートから任意パス書き込み・
 * 任意コマンド実行の経路を作らないため)。
 */
export interface EnvConfig {
  logDir:        string;  // ログ保存先ディレクトリ ('' = 既定のまま変更しない)
  pythonCommand: string;  // Python 実行コマンドの上書き ('' = 既定 (同梱 Python / PATH))
}

const DEFAULTS: EnvConfig = {
  logDir:        '',
  pythonCommand: '',
};

const STORAGE_KEY = 'u15_env_config';

export function useEnvConfig() {
  const [envConfig, update] = usePersistedState(STORAGE_KEY, DEFAULTS);
  return { envConfig, update };
}
