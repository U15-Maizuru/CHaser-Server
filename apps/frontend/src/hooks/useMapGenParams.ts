import type { MapParams } from '@u15/ws-types';
import { DEFAULT_MAP_PARAMS } from '@u15/ws-types';
import { usePersistedState } from './usePersistedState';

/**
 * ランダムマップの生成パラメータ。ServerStatusPayload には含まれないため
 * (サーバーが返してこない)、クライアント側でキャッシュして明示的に送信する。
 *
 * サーバーは受け取ったパラメータを MapManager に覚え、リセット・リピート時の
 * regenerate() でも使い続ける。逆に言うと送らない限りサーバーはハードコードの
 * 既定値 (15×17 / ブロック20 / アイテム51 / ターン100) のままなので、
 * 起動直後に一度 push しないと初期マップに設定が効かない。
 */
export interface MapGenParams {
  sizeIdx:  number;
  blockNum: number;
  itemNum:  number;
  turnNum:  number;
  mirror:   boolean;
}

export const MAP_SIZES = [
  { label: '決戦 (15×17)', x: 15, y: 17 },
  { label: '広域 (21×17)', x: 21, y: 17 },
] as const;

// 数値の既定はサーバーと同じものを使う (ここだけ変えるとパラメータを送る前と後で盤面が変わる)
const DEFAULTS: MapGenParams = { sizeIdx: 0, ...DEFAULT_MAP_PARAMS };

const STORAGE_KEY = 'u15_map_gen_params';

/** WS の set_map_params に載せる形へ変換する */
export function toMapParams(gen: MapGenParams): MapParams {
  const size = MAP_SIZES[gen.sizeIdx] ?? MAP_SIZES[0];
  return {
    size:     { x: size.x, y: size.y },
    blockNum: gen.blockNum,
    itemNum:  gen.itemNum,
    turnNum:  gen.turnNum,
    mirror:   gen.mirror,
  };
}

export function useMapGenParams() {
  const [params, update] = usePersistedState(STORAGE_KEY, DEFAULTS);
  return { params, update };
}
