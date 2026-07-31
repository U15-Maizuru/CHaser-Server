import { useEffect, useRef } from 'react';
import { MapObject } from '@u15/ws-types';
import type { Point } from '@u15/ws-types';
import type { TextureKey } from '../hooks/useTextures';
import { BORDER_COLOR, RADIUS_SM } from '../styles/tokens';

interface Props {
  field:          MapObject[][];
  size:           Point;
  teamFirstPoint: [Point, Point];
  textures:       Partial<Record<TextureKey, HTMLImageElement>>;
  cellSize?:      number;
}

// マップ一覧・現在マップ要約カードで使う軽量プレビュー。
// テクスチャは呼び出し元で useTextures(theme) を一度だけ読み込み props で渡す
// (一覧の行数分 Image を再ロードしないため)。MapEditorDialog.draw() の縮小版。
export function MapThumbnail({ field, size, teamFirstPoint, textures, cellSize = 6 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = size.x * cellSize;
  const H = size.y * cellSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const drawImg = (key: TextureKey, x: number, y: number): boolean => {
      const img = textures[key];
      if (img) { ctx.drawImage(img, x, y, cellSize, cellSize); return true; }
      return false;
    };

    for (let r = 0; r < size.y; r++) {
      for (let c = 0; c < size.x; c++) {
        const x = c * cellSize, y = r * cellSize;
        if (!drawImg('Floor', x, y)) {
          ctx.fillStyle = '#d4cbb8';
          ctx.fillRect(x, y, cellSize, cellSize);
        }
        const cell = field[r]?.[c] ?? MapObject.NOTHING;
        if (cell === MapObject.BLOCK) {
          if (!drawImg('Block', x, y)) { ctx.fillStyle = '#3a3330'; ctx.fillRect(x, y, cellSize, cellSize); }
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', x, y)) { ctx.fillStyle = '#f5c842'; ctx.fillRect(x, y, cellSize, cellSize); }
        }
      }
    }
    for (const [i, color] of [[0, '#3a82c4'], [1, '#c43a3a']] as [number, string][]) {
      const p = teamFirstPoint[i];
      const x = p.x * cellSize, y = p.y * cellSize;
      const key: TextureKey = i === 0 ? 'Cool' : 'Hot';
      if (!drawImg(key, x, y)) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }, [field, size, teamFirstPoint, textures, cellSize, W, H]);

  return (
    <canvas
      ref={canvasRef}
      width={W} height={H}
      style={{ display: 'block', imageRendering: 'pixelated', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, flexShrink: 0 }}
    />
  );
}
