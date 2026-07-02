import { createRandomMap, importMap } from './GameSystem.js';
import type { GameMap, MapObject } from './types.js';
import type { InlineMapData, MapParams } from '@u15/ws-types';

export class MapManager {
  private currentMap: GameMap;
  private params: MapParams = { itemNum: 51, blockNum: 20, turnNum: 100, mirror: true };

  constructor() {
    this.currentMap = generate(this.params);
  }

  get map(): GameMap {
    return this.currentMap;
  }

  regenerate(): void {
    this.currentMap = generate(this.params);
  }

  /** 成功したら true を返す (呼び出し元は失敗時に emitStatus しない) */
  loadFromFile(filePath: string): boolean {
    const loaded = importMap(filePath);
    if (!loaded) return false;
    this.currentMap = loaded;
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
  }
}

function generate(params: MapParams): GameMap {
  return createRandomMap(undefined, params.blockNum, params.itemNum, params.turnNum, params.mirror);
}
