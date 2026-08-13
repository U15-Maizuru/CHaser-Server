import { usePersistedState } from './usePersistedState';

/**
 * ブラウザ観戦者が自分の端末の音量として、コントロールパネルの SE/BGM ミュート設定を
 * 上書きするための値。`override` が null なら上書きしていない (コントロールパネルの値に従う)。
 * サーバーには送らない — この端末だけのローカル設定。
 */
export interface MuteOverride {
  override: boolean | null;
}

const DEFAULTS: MuteOverride = { override: null };

const STORAGE_KEY = 'u15_mute_override';

export function useMuteOverride() {
  const [state, update] = usePersistedState(STORAGE_KEY, DEFAULTS);
  return { override: state.override, setOverride: (override: boolean | null) => update({ override }) };
}
