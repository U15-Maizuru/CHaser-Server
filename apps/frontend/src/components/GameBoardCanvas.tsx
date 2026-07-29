import { useEffect, useRef } from 'react';
import { MapObject } from '@u15/ws-types';
import type { GameStateSnapshot, Point } from '@u15/ws-types';
import { useTextures, type TextureKey } from '../hooks/useTextures';

const DEFAULT_CELL = 36;

const COLOR = {
  floor:   '#d4cbb8',
  block:   '#3a3330',
  item:    '#f5c842',
  cool:    '#3a82c4',
  hot:     '#c43a3a',
  outline: '#ffffff22',
} as const;

// 隣接1マス移動のウォーキングアニメーション用の設定。
// 固定の長さにすると turnDelay 設定や CPU/プロセス側の思考時間によっては次のターン更新より
// 長引いてしまうため、直前の game_state 受信間隔を実測してアニメーション時間を決める。
const SAFETY_FACTOR = 0.8; // 実測間隔に掛ける係数 (次のターン更新前に確実に完了させるための余裕)
const MIN_WALK_MS   = 60;
const MAX_WALK_MS   = 260;

const VEIL_WIPE_MS = 800; // ラウンド終了時にダーク幕が上から消えていくワイプ演出の所要時間

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

interface Props {
  snapshot: GameStateSnapshot;
  flip?:    boolean;
  theme?:   string;
  cellSize?: number;   // 外部からセルサイズを指定 (省略時は DEFAULT_CELL)
  darkMode?: boolean;  // true: 各チームの現在地周辺 (3x3) のみ明るく表示し、他は暗く覆う
  roundEnded?: boolean; // true: ラウンドが終了した瞬間にダーク幕を上からワイプで解除する
}

interface WalkAnim {
  from:     Point;
  to:       Point;
  start:    number;
  duration: number;
}

interface BlockPop {
  x:        number;
  y:        number;
  start:    number;
  duration: number;
}

interface ItemFade {
  x:        number;
  y:        number;
  start:    number;
  duration: number;
}

interface DrawContext {
  field:    MapObject[][];
  size:     Point;
  textures: Partial<Record<TextureKey, HTMLImageElement>>;
  darkMode: boolean;
  flip:     boolean;
  CELL:     number;
  W:        number;
  H:        number;
}

export function GameBoardCanvas({ snapshot, flip = false, theme = 'Jewel', cellSize = DEFAULT_CELL, darkMode = false, roundEnded = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textures  = useTextures(theme);
  const { field, size, teamPos } = snapshot;
  const CELL = cellSize;

  const W = size.x * CELL;
  const H = size.y * CELL;

  // rAF ループや複数の effect から常に最新の描画用データを読めるようにしておく
  const drawCtxRef = useRef<DrawContext>({ field, size, textures, darkMode, flip, CELL, W, H });
  drawCtxRef.current = { field, size, textures, darkMode, flip, CELL, W, H };

  const prevTargetRef       = useRef<[Point, Point] | null>(null);
  const lastSnapshotTimeRef = useRef<number | null>(null);
  const renderPosRef        = useRef<[Point, Point]>([{ ...teamPos[0] }, { ...teamPos[1] }]);
  const animRef             = useRef<[WalkAnim | null, WalkAnim | null]>([null, null]);
  const rafRef              = useRef<number | null>(null);

  // ダーク幕のワイプ解除: ラウンド終了時に幕を上から徐々に消す演出用の状態
  const wipeRef            = useRef<{ start: number; duration: number } | null>(null);
  const veilLiftedRef      = useRef(false); // ワイプ完了後、次ラウンド開始まで幕を描かない
  const prevRoundEndedRef  = useRef(false);

  // ブロック設置アニメーション: 前回の field との差分で NOTHING→BLOCK を検知する
  const prevFieldRef      = useRef<MapObject[][] | null>(null);
  const prevTurnCountRef  = useRef<number | null>(null);
  const blockPopsRef      = useRef<BlockPop[]>([]);
  const blockAnimStatesRef = useRef<Map<string, { scale: number; alpha: number }>>(new Map());

  // アイテム取得アニメーション: 前回の field との差分で ITEM→非ITEM を検知する
  const itemFadesRef      = useRef<ItemFade[]>([]);
  const itemAnimStatesRef = useRef<Map<string, { scale: number; alpha: number }>>(new Map());

  // blockPopsRef を走査してスケール/アルファを再計算し、完了したものは取り除く。
  // まだアニメ中のマスが残っていれば true を返す (rAF ループ継続判定に使う)。
  const updateBlockAnimStates = (now: number): boolean => {
    const states = new Map<string, { scale: number; alpha: number }>();
    blockPopsRef.current = blockPopsRef.current.filter((pop) => {
      const ratio = (now - pop.start) / pop.duration;
      if (ratio >= 1) return false;
      const eased = easeOutQuad(Math.max(0, ratio));
      states.set(`${pop.x},${pop.y}`, { scale: 0.35 + 0.65 * eased, alpha: eased });
      return true;
    });
    blockAnimStatesRef.current = states;
    return blockPopsRef.current.length > 0;
  };

  // itemFadesRef を走査してスケール/アルファを再計算し、完了したものは取り除く。
  // ブロックのポップインとは逆に、縮みながら消えていく (scale: 1→0.6, alpha: 1→0)。
  const updateItemFadeStates = (now: number): boolean => {
    const states = new Map<string, { scale: number; alpha: number }>();
    itemFadesRef.current = itemFadesRef.current.filter((fade) => {
      const ratio = (now - fade.start) / fade.duration;
      if (ratio >= 1) return false;
      const eased = easeOutQuad(Math.max(0, ratio));
      states.set(`${fade.x},${fade.y}`, { scale: 1 - 0.4 * eased, alpha: 1 - eased });
      return true;
    });
    itemAnimStatesRef.current = states;
    return itemFadesRef.current.length > 0;
  };

  const drawFrame = (positions: readonly [Point, Point], now: number = performance.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { field, size, textures, darkMode, flip, CELL, W, H } = drawCtxRef.current;

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
          const pop = blockAnimStatesRef.current.get(`${c},${r}`);
          if (pop) {
            const centerX = cx(c) + CELL / 2;
            const centerY = cy(r) + CELL / 2;
            ctx.save();
            ctx.globalAlpha = pop.alpha;
            ctx.translate(centerX, centerY);
            ctx.scale(pop.scale, pop.scale);
            ctx.translate(-centerX, -centerY);
            if (!drawImg('Block', cx(c), cy(r))) drawBlock(ctx, cx(c), cy(r), CELL);
            ctx.restore();
          } else if (!drawImg('Block', cx(c), cy(r))) {
            drawBlock(ctx, cx(c), cy(r), CELL);
          }
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', cx(c), cy(r))) drawItem(ctx, cx(c), cy(r), CELL);
        }
      }
    }

    // 2b. アイテム取得フェードアウト (既に field 上は消えているが、まだアニメ中のマス)
    for (const [key, state] of itemAnimStatesRef.current) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const centerX = cx(x) + CELL / 2;
      const centerY = cy(y) + CELL / 2;
      ctx.save();
      ctx.globalAlpha = state.alpha;
      ctx.translate(centerX, centerY);
      ctx.scale(state.scale, state.scale);
      ctx.translate(-centerX, -centerY);
      if (!drawImg('Item', cx(x), cy(y))) drawItem(ctx, cx(x), cy(y), CELL);
      ctx.restore();
    }

    // 3. Players (drawn on top)
    const playerKeys: TextureKey[] = ['Cool', 'Hot'];
    const playerColors             = [COLOR.cool, COLOR.hot];
    for (let t = 0; t < 2; t++) {
      const pos = positions[t];
      if (pos.x >= 0 && pos.y >= 0 && pos.x < size.x && pos.y < size.y) {
        if (!drawImg(playerKeys[t], cx(pos.x), cy(pos.y))) {
          drawPlayer(ctx, cx(pos.x), cy(pos.y), playerColors[t], CELL);
        }
      }
    }

    // 4. ダークモード: 幕は別レイヤー (オフスクリーン canvas) 上で塗りつぶし→切り抜きを完結させ、
    // その結果だけをメイン canvas に重ね描きする。切り抜き (destination-out) の対象をメイン
    // canvas から分離することで、既に描画済みのマップ (床・ブロック・プレイヤー) には触れずに
    // 視界の穴に地図がそのまま透けて見える見た目を実現している。
    if (darkMode && !veilLiftedRef.current) {
      let maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) {
        maskCanvas = document.createElement('canvas');
        maskCanvasRef.current = maskCanvas;
      }
      if (maskCanvas.width !== W || maskCanvas.height !== H) {
        maskCanvas.width = W;
        maskCanvas.height = H;
      }
      const maskCtx = maskCanvas.getContext('2d');
      if (maskCtx) {
        maskCtx.clearRect(0, 0, W, H);
        maskCtx.fillStyle = 'rgba(0,0,0,0.72)';
        // ワイプ進行中は幕の上端を下へ動かし、上から徐々に消えていくように見せる
        const wipe = wipeRef.current;
        const coverTop = wipe ? H * Math.min(1, (now - wipe.start) / wipe.duration) : 0;
        maskCtx.fillRect(0, coverTop, W, H - coverTop);

        maskCtx.save();
        maskCtx.globalCompositeOperation = 'destination-out';
        const visSize = CELL * 3;   // 3x3 セル相当の視界サイズ
        const radius  = Math.min(CELL * 1.2, visSize / 2);
        for (const pos of positions) {
          const centerX = cx(pos.x) + CELL / 2;
          const centerY = cy(pos.y) + CELL / 2;
          maskCtx.beginPath();
          maskCtx.roundRect(centerX - visSize / 2, centerY - visSize / 2, visSize, visSize, radius);
          maskCtx.fill();
        }
        maskCtx.restore();

        ctx.drawImage(maskCanvas, 0, 0);
      }
    }
  };

  // アニメ対象 (歩行・ブロック出現・アイテム消滅・ダーク幕ワイプ) が残っていれば rAF ループを開始する。
  // 複数のトリガー (snapshot 受信、ラウンド終了) から呼ばれるため、既に回っている場合は何もしない。
  const startLoopIfNeeded = () => {
    if (rafRef.current !== null) return;
    const isActive =
      !!animRef.current[0] || !!animRef.current[1] ||
      blockPopsRef.current.length > 0 || itemFadesRef.current.length > 0 ||
      wipeRef.current !== null;
    if (!isActive) return;

    const tick = () => {
      const now2 = performance.now();
      let animating = false;
      for (let t = 0; t < 2; t++) {
        const anim = animRef.current[t];
        if (!anim) continue;
        const ratio = Math.min(1, (now2 - anim.start) / anim.duration);
        const eased = easeOutQuad(ratio);
        renderPosRef.current[t] = {
          x: anim.from.x + (anim.to.x - anim.from.x) * eased,
          y: anim.from.y + (anim.to.y - anim.from.y) * eased,
        };
        if (ratio >= 1) {
          animRef.current[t] = null;
        } else {
          animating = true;
        }
      }
      const blocksActive = updateBlockAnimStates(now2);
      const itemsActive  = updateItemFadeStates(now2);

      let wipeActive = false;
      if (wipeRef.current) {
        const ratio = (now2 - wipeRef.current.start) / wipeRef.current.duration;
        if (ratio >= 1) {
          wipeRef.current = null;
          veilLiftedRef.current = true;
        } else {
          wipeActive = true;
        }
      }

      drawFrame(renderPosRef.current, now2);
      rafRef.current = (animating || blocksActive || itemsActive || wipeActive) ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // snapshot (= 新しい game_state) を受信するたびに実行する。
  // 隣接1マス移動ならウォーキングアニメーションを開始し、それ以外 (初回配置・リセット・
  // ラウンド開始等のワープ) は即時配置する。アニメーション時間は直前の game_state 受信間隔の
  // 実測値を基準にする (turnDelay 設定や CPU/プロセス側の思考時間に関わらず、次のターン更新
  // より前に確実に歩行を完了させるため)。
  useEffect(() => {
    const now = performance.now();
    let duration = MIN_WALK_MS;
    if (lastSnapshotTimeRef.current !== null) {
      const interval = now - lastSnapshotTimeRef.current;
      duration = Math.min(MAX_WALK_MS, Math.max(MIN_WALK_MS, interval * SAFETY_FACTOR));
    }
    lastSnapshotTimeRef.current = now;

    const prevTargets = prevTargetRef.current;
    const newTargets: [Point, Point] = [teamPos[0], teamPos[1]];

    for (let t = 0; t < 2; t++) {
      const to = newTargets[t];
      if (!prevTargets) {
        renderPosRef.current[t] = { x: to.x, y: to.y };
        animRef.current[t] = null;
        continue;
      }
      const from = prevTargets[t];
      const dist = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      if (dist === 1) {
        animRef.current[t] = { from: { ...renderPosRef.current[t] }, to: { x: to.x, y: to.y }, start: now, duration };
      } else if (dist > 1) {
        renderPosRef.current[t] = { x: to.x, y: to.y };
        animRef.current[t] = null;
      }
      // dist === 0: 移動なし、何もしない
    }
    prevTargetRef.current = newTargets;

    // ブロック設置検知: turnCount が増加した (= 新しい試合/ラウンドが始まってマップが
    // 総入れ替えされた) 場合や初回・サイズ変更時は、差分アニメーションの対象にはせず
    // 基準となるフィールドを更新するだけにする (MainWindow.tsx のラウンド切り替え検知と同じ考え方)
    const prevField = prevFieldRef.current;
    const isReset =
      prevField === null ||
      prevField.length !== field.length ||
      (prevTurnCountRef.current !== null && snapshot.turnCount > prevTurnCountRef.current);

    if (!isReset) {
      for (let r = 0; r < size.y; r++) {
        for (let c = 0; c < size.x; c++) {
          const before = prevField[r]?.[c] ?? MapObject.NOTHING;
          const after  = field[r]?.[c] ?? MapObject.NOTHING;
          if (before === MapObject.NOTHING && after === MapObject.BLOCK) {
            blockPopsRef.current.push({ x: c, y: r, start: now, duration });
          } else if (before === MapObject.ITEM && after !== MapObject.ITEM) {
            itemFadesRef.current.push({ x: c, y: r, start: now, duration });
          }
        }
      }
    }
    prevFieldRef.current = field;
    prevTurnCountRef.current = snapshot.turnCount;

    updateBlockAnimStates(now);
    updateItemFadeStates(now);
    drawFrame(renderPosRef.current, now);
    startLoopIfNeeded();
    // snapshot 全体の変化 (= 新しいターンの受信) だけをターン間隔の計測・アニメ判定のトリガーにしたい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // ラウンド終了 (roundEnded: false→true) の瞬間、表示中のダーク幕を上からワイプで解除する。
  // 次のラウンドが始まる (roundEnded: true→false) と通常のダーク幕表示に戻す。
  useEffect(() => {
    const wasEnded = prevRoundEndedRef.current;
    prevRoundEndedRef.current = roundEnded;

    if (roundEnded && !wasEnded) {
      if (drawCtxRef.current.darkMode && !veilLiftedRef.current) {
        wipeRef.current = { start: performance.now(), duration: VEIL_WIPE_MS };
        drawFrame(renderPosRef.current);
        startLoopIfNeeded();
      }
    } else if (!roundEnded && wasEnded) {
      wipeRef.current = null;
      veilLiftedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundEnded]);

  // ターン間隔の計測やアニメーション状態とは無関係な見た目の変化 (テーマ・盤面サイズ・反転・
  // ダークモード) は、現在の補間位置のまま即座に再描画する
  useEffect(() => {
    drawFrame(renderPosRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip, darkMode, textures, CELL, W, H]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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
