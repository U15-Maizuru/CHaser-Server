import { createRandomMap, importMap } from './GameSystem.js';
import type { GameMap, MapObject } from './types.js';
import type { InlineMapData, MapParams } from '@u15/ws-types';

export class MapManager {
  private currentMap: GameMap;
  private params: MapParams = { itemNum: 51, blockNum: 20, turnNum: 100, mirror: true };
  private custom = false;

  constructor() {
    this.currentMap = generate(this.params);
  }

  get map(): GameMap {
    return this.currentMap;
  }

  /** 現在のマップが、パラメータからのランダム生成ではなく
   *  ファイル読み込み/インライン(エディタ)由来かどうか */
  get isCustom(): boolean {
    return this.custom;
  }

  regenerate(): void {
    this.currentMap = generate(this.params);
    this.custom = false;
  }

  /** 成功したら true を返す (呼び出し元は失敗時に emitStatus しない) */
  loadFromFile(filePath: string): boolean {
    const loaded = importMap(filePath);
    if (!loaded) return false;
    this.currentMap = loaded;
    this.custom = true;
    return true;
  }

  setParams(params: MapParams): void {
    this.params = params;
    this.regenerate();
  }

  loadInlineData(data: InlineMapData): void {
    this.currentMap = {
      field: data.field.map(r => [...r]) as MapObject[][],
      size: { ...data.size },
      turn: data.turn,
      name: '[CUSTOM MAP]',
      teamFirstPoint: [{ ...data.teamFirstPoint[0] }, { ...data.teamFirstPoint[1] }],
      textureDirPath: 'Jewel',
    };
    this.custom = true;
  }

  /** 現在配信中のマップをフロントエンドへ渡せる形 (InlineMapData) で返す (エディタ起点・現在マップ表示用) */
  getCurrentMapData(): InlineMapData {
    return {
      field: this.currentMap.field.map(r => [...r]),
      size:  { ...this.currentMap.size },
      turn:  this.currentMap.turn,
      teamFirstPoint: [{ ...this.currentMap.teamFirstPoint[0] }, { ...this.currentMap.teamFirstPoint[1] }],
    };
  }
}

function generate(params: MapParams): GameMap {
  return createRandomMap(params.size, params.blockNum, params.itemNum, params.turnNum, params.mirror);
}
