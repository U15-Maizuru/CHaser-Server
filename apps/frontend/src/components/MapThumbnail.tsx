import { useEffect, useRef } from 'react';
import type { MapObject, Point } from '@u15/ws-types';
import type { TextureKey } from '../hooks/useTextures';
import { drawStaticBoard } from '../lib/boardDraw';
import { BORDER_COLOR, RADIUS_SM } from '../ui';

interface Props {
  field:          MapObject[][];
  size:           Point;
  teamFirstPoint: [Point, Point];
  textures:       Partial<Record<TextureKey, HTMLImageElement>>;
  cellSize?:      number;
  /** 盤面を180°反転して描く (2ゲーム制の第2ゲーム) */
  flip?:          boolean;
}

// マップ一覧・現在マップ要約カードで使う軽量プレビュー。
// テクスチャは呼び出し元で useTextures(theme) を一度だけ読み込み props で渡す
// (一覧の行数分 Image を再ロードしないため)。
export function MapThumbnail({ field, size, teamFirstPoint, textures, cellSize = 6, flip = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = size.x * cellSize;
  const H = size.y * cellSize;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawStaticBoard(ctx, { field, size, teamFirstPoint, textures, cell: cellSize, flip });
  }, [field, size, teamFirstPoint, textures, cellSize, flip, W, H]);

  return (
    <canvas
      ref={canvasRef}
      width={W} height={H}
      style={{ display: 'block', imageRendering: 'pixelated', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, flexShrink: 0 }}
    />
  );
}
