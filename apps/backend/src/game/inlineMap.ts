import type { InlineMapData } from '@u15/ws-types';
import type { GameMap, MapObject } from './types.js';

// InlineMapData (フロントエンドとやりとりする盤面) と GameMap (バックエンド内部の盤面) の相互変換。
//
// 以前はマップエディタの読み込み・ライブラリ保存・エクスポートの3箇所がそれぞれ
// オブジェクトリテラルを手書きしていて、textureDirPath の値もその都度書かれていた。
// 変換規則が増えたときに1箇所だけ直し忘れることを防ぐため、ここに集約する。

/** .map 形式が要求するテクスチャ指定。インライン由来のマップは常にこれで作る */
const TEXTURE_DIR_PATH = 'Jewel';

/**
 * フロントエンド由来の盤面を GameMap にする。
 *
 * 呼び出し元がそのまま状態として保持することがあるため、field と座標は必ず複製する
 * (エディタ側の配列と参照を共有すると、あとからの編集が対戦中の盤面に漏れる)。
 */
export function toGameMap(data: InlineMapData, name: string): GameMap {
  return {
    field:          data.field.map(row => [...row]) as MapObject[][],
    size:           { ...data.size },
    turn:           data.turn,
    name,
    teamFirstPoint: [{ ...data.teamFirstPoint[0] }, { ...data.teamFirstPoint[1] }],
    textureDirPath: TEXTURE_DIR_PATH,
  };
}

/** GameMap をフロントエンドへ渡せる形にする (name と textureDirPath は落ちる) */
export function toInlineData(map: GameMap): InlineMapData {
  return {
    field:          map.field.map(row => [...row]),
    size:           { ...map.size },
    turn:           map.turn,
    teamFirstPoint: [{ ...map.teamFirstPoint[0] }, { ...map.teamFirstPoint[1] }],
  };
}
