import { useEffect, useRef, useState } from 'react';
import { MapObject } from '@u15/ws-types';
import type { GameStateSnapshot, Point } from '@u15/ws-types';

const DEFAULT_CELL = 36;

const COLOR = {
  floor:   '#d4cbb8',
  block:   '#3a3330',
  item:    '#f5c842',
  cool:    '#3a82c4',
  hot:     '#c43a3a',
  outline: '#ffffff22',
} as const;

type TextureKey = 'Floor' | 'Block' | 'Item' | 'Cool' | 'Hot';
const TEXTURE_KEYS: TextureKey[] = ['Floor', 'Block', 'Item', 'Cool', 'Hot'];

function useTextures(theme: string): Partial<Record<TextureKey, HTMLImageElement>> {
  const [textures, setTextures] = useState<Partial<Record<TextureKey, HTMLImageElement>>>({});
  useEffect(() => {
    const loaded: Partial<Record<TextureKey, HTMLImageElement>> = {};
    let remaining = TEXTURE_KEYS.length;
    for (const key of TEXTURE_KEYS) {
      const img = new Image();
      img.src = new URL(`../assets/Image/${theme}/${key}.png`, import.meta.url).href;
      img.onload  = () => { loaded[key] = img; if (--remaining === 0) setTextures({ ...loaded }); };
      img.onerror = () => { --remaining; };
    }
    setTextures({});
  }, [theme]);
  return textures;
}

interface Props {
  snapshot: GameStateSnapshot;
  flip?:    boolean;
  theme?:   string;
  cellSize?: number;   // 外部からセルサイズを指定 (省略時は DEFAULT_CELL)
}

export function GameBoardCanvas({ snapshot, flip = false, theme = 'Jewel', cellSize = DEFAULT_CELL }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textures  = useTextures(theme);
  const { field, size, teamPos } = snapshot;
  const CELL = cellSize;

  const W = size.x * CELL;
  const H = size.y * CELL;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    const cx = (col: number) => (flip ? size.x - col - 1 : col) * CELL;
    const cy = (row: number) => (flip ? size.y - row - 1 : row) * CELL;

    const drawImg = (key: TextureKey, x: number, y: number) => {
      const img = textures[key];
      if (img) ctx.drawImage(img, x, y, CELL, CELL);
      return !!img;
    };

    // 1. Floor layer
    for (let r = 0; r < size.y; r++) {
      for (let c = 0; c < size.x; c++) {
        if (!drawImg('Floor', cx(c), cy(r))) {
          ctx.fillStyle = COLOR.floor;
          ctx.fillRect(cx(c), cy(r), CELL, CELL);
          ctx.strokeStyle = COLOR.outline;
          ctx.strokeRect(cx(c) + 0.5, cy(r) + 0.5, CELL - 1, CELL - 1);
        }
      }
    }

    // 2. Map objects
    for (let r = 0; r < size.y; r++) {
      for (let c = 0; c < size.x; c++) {
        const cell = field[r]?.[c] ?? MapObject.NOTHING;
        if (cell === MapObject.BLOCK) {
          if (!drawImg('Block', cx(c), cy(r))) drawBlock(ctx, cx(c), cy(r), CELL);
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', cx(c), cy(r))) drawItem(ctx, cx(c), cy(r), CELL);
        }
      }
    }

    // 3. Players (drawn on top)
    const playerKeys: TextureKey[] = ['Cool', 'Hot'];
    const playerColors             = [COLOR.cool, COLOR.hot];
    for (let t = 0; t < 2; t++) {
      const pos: Point = teamPos[t];
      if (pos.x >= 0 && pos.y >= 0 && pos.x < size.x && pos.y < size.y) {
        if (!drawImg(playerKeys[t], cx(pos.x), cy(pos.y))) {
          drawPlayer(ctx, cx(pos.x), cy(pos.y), playerColors[t], CELL);
        }
      }
    }
  }, [snapshot, flip, W, H, size.x, size.y, field, teamPos, textures, CELL]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, cell: number) {
  const pad = Math.max(2, Math.floor(cell * 0.11));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, Math.max(3, cell * 0.15));
  ctx.fill();
  ctx.fillStyle = '#ffffff55';
  ctx.fillRect(x + pad + 2, y + pad + 2, (cell - pad * 2) / 2, Math.max(2, cell * 0.1));
}

function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  ctx.fillStyle = COLOR.block;
  ctx.fillRect(x, y, cell, cell);
  ctx.fillStyle = '#ffffff18';
  ctx.fillRect(x, y, cell, Math.max(2, cell * 0.08));
  ctx.fillRect(x, y, Math.max(2, cell * 0.08), cell);
}

function drawItem(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const cx2 = x + cell / 2, cy2 = y + cell / 2, r = cell / 2 - Math.max(3, cell * 0.15);
  ctx.fillStyle = COLOR.item;
  ctx.beginPath();
  ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffffaa';
  ctx.beginPath();
  ctx.arc(cx2 - r * 0.3, cy2 - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
