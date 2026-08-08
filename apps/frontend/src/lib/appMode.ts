/**
 * URL のクエリから「どの画面を出すか」を読む。
 *
 * `mode` の語彙は Electron 側 (apps/electron/src/main.ts の WindowMode) が組み立てて渡す。
 * E2E も `url().includes('mode=...')` でウィンドウを特定しているので、値を変えるときは
 * その3箇所を揃えること。
 *
 * モジュールのトップレベルで読むとテストから差し替えられないため、関数にしてある。
 */
export type AppMode = 'display' | 'control' | 'manual' | 'tournament';

const MODES: readonly AppMode[] = ['display', 'control', 'manual', 'tournament'];

export interface AppLocation {
  /** ルーム指定なし = ロビー (Web サービスモード) */
  roomId: string | null;
  mode:   AppMode;
  slot:   0 | 1;
}

export function readAppLocation(search: string): AppLocation {
  const params = new URLSearchParams(search);
  const mode   = params.get('mode');
  return {
    roomId: params.get('room'),
    mode:   MODES.includes(mode as AppMode) ? mode as AppMode : 'display',
    slot:   params.get('slot') === '1' ? 1 : 0,
  };
}
