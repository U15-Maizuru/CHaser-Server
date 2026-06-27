import { useEffect, useRef, useState } from 'react';
import { MapObject } from '../types/ws-types';
import type { GameStateSnapshot, Point } from '../types/ws-types';

const CELL = 36; // px per cell

// フォールバック用パレット (テクスチャ未ロード時)
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
      img.onload  = () => {
        loaded[key] = img;
        remaining--;
        if (remaining === 0) setTextures({ ...loaded });
      };
      img.onerror = () => { remaining--; };
    }
    setTextures({});
  }, [theme]);

  return textures;
}

interface Props {
  snapshot: GameStateSnapshot;
  flip?:    boolean;
  theme?:   string;
}

export function GameBoardCanvas({ snapshot, flip = false, theme = 'Jewel' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textures  = useTextures(theme);
  const { field, size, teamPos } = snapshot;

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
          if (!drawImg('Block', cx(c), cy(r))) drawBlock(ctx, cx(c), cy(r));
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', cx(c), cy(r))) drawItem(ctx, cx(c), cy(r));
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
          drawPlayer(ctx, cx(pos.x), cy(pos.y), playerColors[t]);
        }
      }
    }
  }, [snapshot, flip, W, H, size.x, size.y, field, teamPos, textures]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}

// ── Fallback drawing ──────────────────────────────────────────────────────────

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const pad = 4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 6);
  ctx.fill();
  ctx.fillStyle = '#ffffff55';
  ctx.fillRect(x + pad + 2, y + pad + 2, (CELL - pad * 2) / 2, 4);
}

function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = COLOR.block;
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = '#ffffff18';
  ctx.fillRect(x, y, CELL, 3);
  ctx.fillRect(x, y, 3, CELL);
}

function drawItem(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const cx2 = x + CELL / 2, cy2 = y + CELL / 2, r = CELL / 2 - 6;
  ctx.fillStyle = COLOR.item;
  ctx.beginPath();
  ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffffaa';
  ctx.beginPath();
  ctx.arc(cx2 - r * 0.3, cy2 - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}
