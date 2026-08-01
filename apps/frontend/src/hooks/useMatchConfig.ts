import { usePersistedState } from './usePersistedState';

/**
 * 対戦の進行パラメータ。ServerStatusPayload には含まれない (サーバーが返してこない) ため、
 * クライアント側でキャッシュして明示的に送信する必要がある。
 *
 * バックエンドの setTurnDelay / setTcpTimeout にフェーズゲートは無いが、turnDelay は
 * requestStart 時に値渡しで消費されるため、進行中の試合には影響せず「次の試合から」効く。
 */
export interface MatchConfig {
  timeout:   number;  // TCP タイムアウト (秒)
  turnDelay: number;  // 1ターンの表示待機時間 (ミリ秒)
}

const DEFAULTS: MatchConfig = {
  timeout:   10,
  turnDelay: 500,
};

const STORAGE_KEY = 'u15_match_config';

export function useMatchConfig() {
  const [config, update] = usePersistedState(STORAGE_KEY, DEFAULTS);
  return { config, update };
}
