import { MapObject } from '@u15/ws-types';
import type { Point } from '@u15/ws-types';
import type { TextureKey } from '../hooks/useTextures';

// 盤面 canvas の共通部品。対戦画面 (GameBoardCanvas)・マップエディタ (MapEditorDialog)・
// サムネイル (MapThumbnail) の3つが使う。
//
// 以前は3ファイルが色・反転の式・テクスチャのフォールバックをそれぞれ持っていて、
// MapThumbnail のコメントが「GameBoardCanvas と同一」「MapEditorDialog.draw() の縮小版」と
// 手動同期の必要を自認していた。実際にフォールバックの図形は3者で食い違っていた
// (アイテムが円 / 円 / 四角、プレイヤーが角丸 / 内寄せ矩形 / べた塗り)。

/**
 * 盤面の色。
 *
 * ui/tokens.ts の値をそのまま使わないのは、tokens のパステル寄りの色が暗い盤面の上では
 * 沈むため。盤面は canvas 専用の色を持つ、というのがここの前提。
 */
export const BOARD_COLOR = {
  floor:   '#d4cbb8',
  block:   '#3a3330',
  item:    '#f5c842',
  cool:    '#3a82c4',
  hot:     '#c43a3a',
  outline: '#ffffff22',
  // 決着演出の2色。gold (勝者) と warn (自滅) は色相が近いので、色だけでなく
  // 「面のグロー vs 線のリング」という形の違いと明暗 (勝者は明るく、敗者は暗転) でも
  // 区別が付くように描く。
  gold:    '#ffd24a', // 勝者・引き分け (tokens.ts の GOLD_BASE を盤面向けに明るくした値)
  warn:    '#ff7a1a', // 自滅 (衝突/自縛/通信エラー)。gold と紛れないよう橙寄りにする
} as const;

/** マップエディタだけが常時引くセル境界線 (編集時にマスの当たりを見せるため) */
export const EDITOR_GRID_COLOR = '#00000022';

export interface CellMapper {
  cx: (col: number) => number;
  cy: (row: number) => number;
}

/**
 * 列・行から canvas 座標を求める。flip=true で盤面を180°回す
 * (2ゲーム制の第2ゲーム)。対戦画面と待機画面で向きが食い違わないよう、式はここだけに置く。
 */
export function cellMapper(size: Point, cell: number, flip: boolean): CellMapper {
  return {
    cx: (col: number) => (flip ? size.x - col - 1 : col) * cell,
    cy: (row: number) => (flip ? size.y - row - 1 : row) * cell,
  };
}

export type Textures = Partial<Record<TextureKey, HTMLImageElement>>;

/** テクスチャがあれば描いて true。無ければ何もせず false (呼び出し側がフォールバックを描く) */
export function drawTexture(
  ctx: CanvasRenderingContext2D, textures: Textures, key: TextureKey,
  x: number, y: number, cell: number,
): boolean {
  const img = textures[key];
  if (!img) return false;
  ctx.drawImage(img, x, y, cell, cell);
  return true;
}

// ── テクスチャが読めなかったときのフォールバック描画 ────────────────────────

export function drawFloorFallback(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  ctx.fillStyle = BOARD_COLOR.floor;
  ctx.fillRect(x, y, cell, cell);
  ctx.strokeStyle = BOARD_COLOR.outline;
  ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
}

export function drawBlockFallback(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  ctx.fillStyle = BOARD_COLOR.block;
  ctx.fillRect(x, y, cell, cell);
  ctx.fillStyle = '#ffffff18';
  ctx.fillRect(x, y, cell, Math.max(2, cell * 0.08));
  ctx.fillRect(x, y, Math.max(2, cell * 0.08), cell);
}

export function drawItemFallback(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  const cx2 = x + cell / 2, cy2 = y + cell / 2, r = cell / 2 - Math.max(3, cell * 0.15);
  ctx.fillStyle = BOARD_COLOR.item;
  ctx.beginPath();
  ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffffaa';
  ctx.beginPath();
  ctx.arc(cx2 - r * 0.3, cy2 - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPlayerFallback(
  ctx: CanvasRenderingContext2D, x: number, y: number, color: string, cell: number,
): void {
  const pad = Math.max(2, Math.floor(cell * 0.11));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, Math.max(3, cell * 0.15));
  ctx.fill();
  ctx.fillStyle = '#ffffff55';
  ctx.fillRect(x + pad + 2, y + pad + 2, (cell - pad * 2) / 2, Math.max(2, cell * 0.1));
}

// ── 静止した盤面 ───────────────────────────────────────────────────────────

export interface StaticBoardOptions {
  field:          MapObject[][];
  size:           Point;
  teamFirstPoint: [Point, Point];
  textures:       Textures;
  cell:           number;
  /** 盤面を180°反転して描く (2ゲーム制の第2ゲーム) */
  flip?:          boolean;
  /** 指定するとテクスチャの有無に関わらずセル境界線を引く (マップエディタ用) */
  gridColor?:     string;
}

/**
 * 床 → グリッド → ブロック/アイテム → 初期位置、を一度だけ描く。
 *
 * 対戦画面はアニメーションのために独自のループを持つのでこれは使わず、上の部品だけを共有する。
 */
export function drawStaticBoard(ctx: CanvasRenderingContext2D, opts: StaticBoardOptions): void {
  const { field, size, teamFirstPoint, textures, cell, flip = false, gridColor } = opts;
  const { cx, cy } = cellMapper(size, cell, flip);

  for (let r = 0; r < size.y; r++) {
    for (let c = 0; c < size.x; c++) {
      const x = cx(c), y = cy(r);
      if (!drawTexture(ctx, textures, 'Floor', x, y, cell)) drawFloorFallback(ctx, x, y, cell);
      if (gridColor) {
        ctx.strokeStyle = gridColor;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }

      const obj = field[r]?.[c] ?? MapObject.NOTHING;
      if (obj === MapObject.BLOCK) {
        if (!drawTexture(ctx, textures, 'Block', x, y, cell)) drawBlockFallback(ctx, x, y, cell);
      } else if (obj === MapObject.ITEM) {
        if (!drawTexture(ctx, textures, 'Item', x, y, cell)) drawItemFallback(ctx, x, y, cell);
      }
    }
  }

  const players: [TextureKey, string][] = [['Cool', BOARD_COLOR.cool], ['Hot', BOARD_COLOR.hot]];
  players.forEach(([key, color], i) => {
    const p = teamFirstPoint[i]!;
    const x = cx(p.x), y = cy(p.y);
    if (!drawTexture(ctx, textures, key, x, y, cell)) drawPlayerFallback(ctx, x, y, color, cell);
  });
}

/** 盤面に含まれる特定オブジェクトの数 (ブロック数・アイテム数の表示用) */
export function countObj(field: MapObject[][] | number[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}
