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
//
// 見た目のサイズ (CSS px) は cellSize のままだが、内部の描画解像度はその RESOLUTION 倍で持つ。
// この canvas は待機画面 (SetupWaiting) や手動プレビューで FitArea (CSS transform: scale) に
// よってさらに拡大表示されるため、cellSize そのままの解像度だと拡大後にぼやける/ブロック状に
// なる。バックエンドの解像度だけを上げて表示サイズは変えない (いわゆる高DPI canvas の手法) ことで、
// FitArea 側で拡大されても粗く見えないようにする。
const RESOLUTION = 4;

export function MapThumbnail({ field, size, teamFirstPoint, textures, cellSize = 6, flip = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = size.x * cellSize;
  const H = size.y * cellSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    // canvas.width/height の代入 (JSX 側) で変換行列はリセットされるが、サイズが変わらず
    // effect だけ再実行されるケースもあるため、蓄積を避けて毎回明示的に単位行列から掛け直す
    ctx.setTransform(RESOLUTION, 0, 0, RESOLUTION, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawStaticBoard(ctx, { field, size, teamFirstPoint, textures, cell: cellSize, flip });
  }, [field, size, teamFirstPoint, textures, cellSize, flip, W, H]);

  return (
    <canvas
      ref={canvasRef}
      width={W * RESOLUTION} height={H * RESOLUTION}
      style={{
        display: 'block', width: W, height: H,
        border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, flexShrink: 0,
      }}
    />
  );
}
