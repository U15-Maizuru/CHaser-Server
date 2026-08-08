import { createRandomMap, importMap } from './GameSystem.js';
import { toGameMap, toInlineData } from './inlineMap.js';
import type { GameMap } from './types.js';
import type { InlineMapData, MapParams, MapSourceInfo } from '@u15/ws-types';
import { DEFAULT_MAP_PARAMS } from '@u15/ws-types';

/** 現在のマップが「どこから来たか」。リセット・リピート時に引き直すかどうかもこれで決まる。 */
type Source =
  | { kind: 'random' }
  | { kind: 'catalog'; catalogId: string; displayName: string }
  | { kind: 'editor' };

export class MapManager {
  private currentMap: GameMap;
  private params: MapParams = { ...DEFAULT_MAP_PARAMS };
  private source: Source = { kind: 'random' };

  constructor() {
    this.currentMap = generate(this.params);
  }

  get map(): GameMap {
    return this.currentMap;
  }

  /** 選択中のマップソース (ServerStatusPayload 経由で全コントロール窓へ配る) */
  get sourceInfo(): MapSourceInfo {
    return this.source.kind === 'catalog'
      ? { kind: 'catalog', catalogId: this.source.catalogId, displayName: this.source.displayName }
      : { kind: this.source.kind };
  }

  regenerate(): void {
    this.currentMap = generate(this.params);
    this.source = { kind: 'random' };
  }

  /**
   * 新しい対戦を始める前の処理 (リセット・リピート)。
   * ランダム生成を選んでいるときだけ引き直し、ライブラリ・エディタ由来のマップは
   * 「選んだもの」なのでそのまま残す。
   */
  refreshForNewGame(): void {
    if (this.source.kind === 'random') this.regenerate();
  }

  /** 成功したら true を返す (呼び出し元は失敗時に emitStatus しない) */
  loadFromCatalog(mapPath: string, catalogId: string, displayName: string): boolean {
    const loaded = importMap(mapPath);
    if (!loaded) return false;
    this.currentMap = loaded;
    this.source = { kind: 'catalog', catalogId, displayName };
    return true;
  }

  setParams(params: MapParams): void {
    this.params = params;
    this.regenerate();
  }

  loadInlineData(data: InlineMapData): void {
    this.currentMap = toGameMap(data, '[CUSTOM MAP]');
    this.source = { kind: 'editor' };
  }

  /** 現在配信中のマップをフロントエンドへ渡せる形 (InlineMapData) で返す (エディタ起点・現在マップ表示用) */
  getCurrentMapData(): InlineMapData {
    return toInlineData(this.currentMap);
  }
}

function generate(params: MapParams): GameMap {
  return createRandomMap(params.size, params.blockNum, params.itemNum, params.turnNum, params.mirror);
}
