import { useEffect, useRef } from 'react';
import { Action, MapObject, VEIL_ALPHA_DEFAULT, VEIL_ALPHA_MIN, VEIL_ALPHA_MAX } from '@u15/ws-types';
import type { GameStateSnapshot, Point, ScanInfo } from '@u15/ws-types';
import { useTextures, type TextureKey } from '../hooks/useTextures';
import type { DecisiveEffect } from '../lib/decisiveEffect';
import {
  BOARD_COLOR, cellMapper, drawTexture,
  drawBlockFallback, drawFloorFallback, drawItemFallback, drawPlayerFallback,
} from '../lib/boardDraw';
import { drawDecisiveLayer, drawVeilLayer, scanAlpha } from '../lib/boardLayers';

const DEFAULT_CELL = 36;

const COLOR = BOARD_COLOR;

// 隣接1マス移動のウォーキングアニメーション用の設定。
// 固定の長さにすると turnDelay 設定や CPU/プロセス側の思考時間によっては次のターン更新より
// 長引いてしまうため、直前の game_state 受信間隔を実測してアニメーション時間を決める。
const SAFETY_FACTOR = 0.8; // 実測間隔に掛ける係数 (次のターン更新前に確実に完了させるための余裕)
const MIN_WALK_MS   = 60;
const MAX_WALK_MS   = 260;

const VEIL_WIPE_MS = 800; // ゲーム終了時にダーク幕が上から消えていくワイプ演出の所要時間

// 決着演出 (敗者の上にブロック / 周囲4マスの強調) のインパクト部分の長さ。
// これが終わったあとも、演出そのものは静止した状態で結果表示中ずっと残り続ける。
const DECISIVE_MS = 500;

// LOOK/SEARCH の探索範囲演出。歩行アニメ (MAX_WALK_MS=260) より長めに出す:
// 観戦者が「どこを調べたか」を認識できる必要があるため、ターン間隔いっぱいまで使う。
const MIN_SCAN_MS = 220;
const MAX_SCAN_MS = 900;
// 演出全体の何割を過ぎたらフェードアウトを始めるか
const SCAN_FADE_START = 0.65;
// 探索範囲の塗りの濃さ。マスの中身 (床・ブロック・アイテム・相手) が透けて見える程度に留め、
// 「どこを調べたか」はスイープの走りと枠線に担わせる。ダークモード中は幕を打ち抜いて中身を
// 見せること自体が演出の主目的なので、さらに薄くする。
const SCAN_FILL_BASE     = 0.18; // 範囲全体に常時かかるタイント
const SCAN_FILL_SWEEP    = 0.30; // スイープが通過する瞬間の上乗せ
const SCAN_FILL_DARK_MUL = 0.55; // ダークモード中の減衰

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

interface Props {
  snapshot: GameStateSnapshot;
  flip?:    boolean;
  theme?:   string;
  cellSize?: number;   // 外部からセルサイズを指定 (省略時は DEFAULT_CELL)
  darkMode?: boolean;  // true: 各プレイヤーの現在地周辺 (3x3) のみ明るく表示し、他は暗く覆う
  /** ダーク幕の濃さ (0-1)。会場のプロジェクタ/照明に合わせて設定から調整する */
  veilAlpha?: number;
  roundEnded?: boolean; // true: ゲームが終了した瞬間にダーク幕を上からワイプで解除する
  /** 決着演出 (全決着理由。勝者の 👑 と敗者の暗転を含む)。null なら何も描かない */
  decisive?: DecisiveEffect | null;
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

interface ScanFx {
  info:     ScanInfo;
  start:    number;
  duration: number;
}

interface DrawContext {
  field:     MapObject[][];
  size:      Point;
  textures:  Partial<Record<TextureKey, HTMLImageElement>>;
  darkMode:  boolean;
  veilAlpha: number;
  flip:      boolean;
  CELL:      number;
  W:         number;
  H:         number;
}

export function GameBoardCanvas({
  snapshot, flip = false, theme = 'Jewel', cellSize = DEFAULT_CELL,
  darkMode = false, veilAlpha = VEIL_ALPHA_DEFAULT, roundEnded = false, decisive = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textures  = useTextures(theme);
  const { field, size, teamPos } = snapshot;
  const CELL = cellSize;

  const W = size.x * CELL;
  const H = size.y * CELL;

  // 古い localStorage や外部からの指定で範囲外の値が来ても、幕が消える/真っ黒になる事故は避ける
  const veil = Number.isFinite(veilAlpha)
    ? Math.max(VEIL_ALPHA_MIN, Math.min(VEIL_ALPHA_MAX, veilAlpha))
    : VEIL_ALPHA_DEFAULT;

  // rAF ループや複数の effect から常に最新の描画用データを読めるようにしておく
  const drawCtxRef = useRef<DrawContext>({ field, size, textures, darkMode, veilAlpha: veil, flip, CELL, W, H });
  drawCtxRef.current = { field, size, textures, darkMode, veilAlpha: veil, flip, CELL, W, H };

  const prevTargetRef       = useRef<[Point, Point] | null>(null);
  const lastSnapshotTimeRef = useRef<number | null>(null);
  const renderPosRef        = useRef<[Point, Point]>([{ ...teamPos[0] }, { ...teamPos[1] }]);
  const animRef             = useRef<[WalkAnim | null, WalkAnim | null]>([null, null]);
  const rafRef              = useRef<number | null>(null);

  // ダーク幕のワイプ解除: ゲーム終了時に幕を上から徐々に消す演出用の状態
  const wipeRef            = useRef<{ start: number; duration: number } | null>(null);
  const veilLiftedRef      = useRef(false); // ワイプ完了後、次ゲーム開始まで幕を描かない
  const prevRoundEndedRef  = useRef(false);

  // ブロック設置アニメーション: 前回の field との差分で NOTHING→BLOCK を検知する
  const prevFieldRef      = useRef<MapObject[][] | null>(null);
  const prevTurnCountRef  = useRef<number | null>(null);
  const blockPopsRef      = useRef<BlockPop[]>([]);
  const blockAnimStatesRef = useRef<Map<string, { scale: number; alpha: number }>>(new Map());

  // アイテム取得アニメーション: 前回の field との差分で ITEM→非ITEM を検知する
  const itemFadesRef      = useRef<ItemFade[]>([]);
  const itemAnimStatesRef = useRef<Map<string, { scale: number; alpha: number }>>(new Map());

  // LOOK/SEARCH の探索範囲演出。snapshot.lastScan (サーバーが確定させたマス) をそのまま描く。
  // プレイヤーごとに最大1件だけ保持する (同じプレイヤーが連続で探索したときに重ならないように)。
  const scanFxRef = useRef<ScanFx[]>([]);

  // 決着演出。decisiveAnimRef は最初のインパクト (リング拡散・ブロックのポップイン) の
  // 進行状態だけを持ち、完了すると null に戻る。演出の内容そのものは decisiveRef が
  // 保持し続けるため、インパクトが終わったあとも静止した状態で残る。
  const decisiveRef     = useRef<DecisiveEffect | null>(decisive);
  decisiveRef.current   = decisive;
  const decisiveAnimRef = useRef<{ start: number; duration: number } | null>(null);

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

  // 期限切れの探索範囲演出を取り除く。まだ残っていれば true を返す (rAF ループ継続判定に使う)。
  // 進行度は描画時に start/duration から都度計算するため、ここでは間引くだけでよい。
  const updateScanFxStates = (now: number): boolean => {
    scanFxRef.current = scanFxRef.current.filter(fx => now - fx.start < fx.duration);
    return scanFxRef.current.length > 0;
  };

  const drawFrame = (positions: readonly [Point, Point], now: number = performance.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { field, size, textures, darkMode, veilAlpha, flip, CELL, W, H } = drawCtxRef.current;

    ctx.clearRect(0, 0, W, H);

    const { cx, cy } = cellMapper(size, CELL, flip);
    const drawImg = (key: TextureKey, x: number, y: number) =>
      drawTexture(ctx, textures, key, x, y, CELL);

    // レイヤー関数へ渡す共通の描画コンテキスト
    const layerBase = { ctx, cx, cy, CELL, size, positions, drawImg };

    // 1. Floor layer
    for (let r = 0; r < size.y; r++) {
      for (let c = 0; c < size.x; c++) {
        if (!drawImg('Floor', cx(c), cy(r))) drawFloorFallback(ctx, cx(c), cy(r), CELL);
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
            if (!drawImg('Block', cx(c), cy(r))) drawBlockFallback(ctx, cx(c), cy(r), CELL);
            ctx.restore();
          } else if (!drawImg('Block', cx(c), cy(r))) {
            drawBlockFallback(ctx, cx(c), cy(r), CELL);
          }
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', cx(c), cy(r))) drawItemFallback(ctx, cx(c), cy(r), CELL);
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
      if (!drawImg('Item', cx(x), cy(y))) drawItemFallback(ctx, cx(x), cy(y), CELL);
      ctx.restore();
    }

    // 3. Players (drawn on top)
    const playerKeys: TextureKey[] = ['Cool', 'Hot'];
    const playerColors             = [COLOR.cool, COLOR.hot];
    for (let t = 0; t < 2; t++) {
      const pos = positions[t];
      if (pos.x >= 0 && pos.y >= 0 && pos.x < size.x && pos.y < size.y) {
        if (!drawImg(playerKeys[t], cx(pos.x), cy(pos.y))) {
          drawPlayerFallback(ctx, cx(pos.x), cy(pos.y), playerColors[t], CELL);
        }
      }
    }

    // 3b. 決着演出 (詳細は lib/boardLayers.ts)
    const decisiveAnim  = decisiveAnimRef.current;
    const decisiveRatio = decisiveAnim
      ? Math.min(1, (now - decisiveAnim.start) / decisiveAnim.duration)
      : 1;
    drawDecisiveLayer(layerBase, decisiveRef.current, decisiveRatio);

    // 4. ダークモードの幕 (詳細は lib/boardLayers.ts)。探索したマスは幕を打ち抜く
    if (darkMode && !veilLiftedRef.current) {
      if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement('canvas');
      const wipe = wipeRef.current;
      drawVeilLayer(layerBase, {
        maskCanvas: maskCanvasRef.current,
        W, H, veilAlpha,
        wipeProgress: wipe ? Math.min(1, (now - wipe.start) / wipe.duration) : 0,
        scans: scanFxRef.current.map(fx => ({
          cells: fx.info.cells,
          alpha: scanAlpha((now - fx.start) / fx.duration, SCAN_FADE_START),
        })),
      });
    }

    // 5. LOOK/SEARCH の探索範囲。ダーク幕 (4) より後に描くことで、幕が出ていても
    // 「どのプレイヤーがどこを調べたか」の枠が常に鮮明に出る。中身が見えるかどうかは
    // 上のマスク打ち抜き側が担当し、こちらは枠とタイントだけを受け持つ。
    for (const fx of scanFxRef.current) {
      const ratio = Math.min(1, (now - fx.start) / fx.duration);
      const alpha = scanAlpha(ratio, SCAN_FADE_START);
      if (alpha <= 0) continue;

      const { cells, action } = fx.info;
      const color   = fx.info.team === 0 ? COLOR.cool : COLOR.hot;
      const eased   = easeOutQuad(ratio);
      const visible = cells.filter(c => c.x >= 0 && c.x < size.x && c.y >= 0 && c.y < size.y);
      if (visible.length === 0) continue;
      const lineW = Math.max(2.5, CELL * 0.12);

      // 角丸枠を1本描く。盤外にはみ出した分は canvas 端で切れるので境界チェックは不要。
      // 明るい床テクスチャの上でもプレイヤー色が沈まないよう、外側に暗いハローを先に敷く。
      const strokeBounds = (box: Point[], a: number, round: number) => {
        const xs = box.map(c => cx(c.x));
        const ys = box.map(c => cy(c.y));
        const bx = Math.min(...xs);
        const by = Math.min(...ys);
        const bw = Math.max(...xs) + CELL - bx;
        const bh = Math.max(...ys) + CELL - by;
        const path = new Path2D();
        path.roundRect(bx + lineW / 2, by + lineW / 2, bw - lineW, bh - lineW, round);

        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = lineW * 2;
        ctx.stroke(path);

        ctx.globalAlpha = a;
        ctx.strokeStyle = color;
        ctx.lineWidth   = lineW;
        ctx.stroke(path);
      };

      // LOOK / SEARCH とも自機から伸びるビーム。近いほど濃く、先端へ向かってスイープが走る。
      // cells は index 0 が自機に最も近い順で届く (盤面反転は cx/cy が吸収する)。
      // 「自機からの距離」の単位は LOOK が 3 マスずつの帯、SEARCH が 1 マスずつなので、
      // 帯番号でスイープさせて 3x3 の同じ帯が同時に光るようにする。
      const isLook    = action === Action.LOOK;
      const bandSize  = isLook ? 3 : 1;
      const bandCount = Math.ceil(cells.length / bandSize);
      const head      = eased * bandCount;
      // 幕が出ている間は、打ち抜いて見せたマスの中身を塗りつぶさないよう薄くする
      const fillMul   = darkMode && !veilLiftedRef.current ? SCAN_FILL_DARK_MUL : 1;

      ctx.save();
      ctx.fillStyle = color;
      cells.forEach((c, i) => {
        if (c.x < 0 || c.x >= size.x || c.y < 0 || c.y >= size.y) return;
        const band    = Math.floor(i / bandSize);
        const falloff = 1 - (band / bandCount) * 0.6;
        const sweep   = Math.max(0, 1 - Math.abs(band - head));
        ctx.globalAlpha = Math.min(1, alpha * fillMul * (SCAN_FILL_BASE * falloff + SCAN_FILL_SWEEP * sweep));
        ctx.fillRect(cx(c.x), cy(c.y), CELL, CELL);
      });

      // LOOK は 3x3 全体を1つの角丸枠で囲んで形が分かるようにする (盤外にはみ出した分は
      // canvas 端で切れる)。SEARCH は盤内のマスだけを細長い枠で囲む。
      strokeBounds(isLook ? cells : visible, alpha * 0.85, Math.max(3, CELL * (isLook ? 0.18 : 0.15)));
      ctx.restore();
    }
  };

  // アニメ対象 (歩行・ブロック出現・アイテム消滅・探索範囲・ダーク幕ワイプ・決着演出) が残っていれば
  // rAF ループを開始する。複数のトリガー (snapshot 受信、ゲーム終了、決着) から呼ばれるため、
  // 既に回っている場合は何もしない。
  const startLoopIfNeeded = () => {
    if (rafRef.current !== null) return;
    const isActive =
      !!animRef.current[0] || !!animRef.current[1] ||
      blockPopsRef.current.length > 0 || itemFadesRef.current.length > 0 ||
      scanFxRef.current.length > 0 ||
      wipeRef.current !== null || decisiveAnimRef.current !== null;
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
      const scanActive   = updateScanFxStates(now2);

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

      // 決着演出のインパクト部分。完了したら anim は畳むが、decisiveRef は残るので
      // この直後の drawFrame が静止した最終形を描き、そのまま盤面に残り続ける
      let decisiveActive = false;
      if (decisiveAnimRef.current) {
        const ratio = (now2 - decisiveAnimRef.current.start) / decisiveAnimRef.current.duration;
        if (ratio >= 1) {
          decisiveAnimRef.current = null;
        } else {
          decisiveActive = true;
        }
      }

      drawFrame(renderPosRef.current, now2);
      rafRef.current = (animating || blocksActive || itemsActive || scanActive || wipeActive || decisiveActive)
        ? requestAnimationFrame(tick)
        : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // snapshot (= 新しい game_state) を受信するたびに実行する。
  // 隣接1マス移動ならウォーキングアニメーションを開始し、それ以外 (初回配置・リセット・
  // ゲーム開始等のワープ) は即時配置する。アニメーション時間は直前の game_state 受信間隔の
  // 実測値を基準にする (turnDelay 設定や CPU/プロセス側の思考時間に関わらず、次のターン更新
  // より前に確実に歩行を完了させるため)。
  useEffect(() => {
    const now = performance.now();
    let duration     = MIN_WALK_MS;
    let scanDuration = MIN_SCAN_MS;
    if (lastSnapshotTimeRef.current !== null) {
      const interval = now - lastSnapshotTimeRef.current;
      duration     = Math.min(MAX_WALK_MS, Math.max(MIN_WALK_MS, interval * SAFETY_FACTOR));
      scanDuration = Math.min(MAX_SCAN_MS, Math.max(MIN_SCAN_MS, interval * SAFETY_FACTOR));
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

    // ブロック設置検知: turnCount が増加した (= 新しいゲームが始まってマップが
    // 総入れ替えされた) 場合や初回・サイズ変更時は、差分アニメーションの対象にはせず
    // 基準となるフィールドを更新するだけにする (MainWindow.tsx のゲーム切り替え検知と同じ考え方)
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
    // 探索範囲演出: LOOK/SEARCH が行われたターンだけ lastScan が載る。
    // ゲームの切り替え時 (isReset) は他のアニメ状態と同じく破棄する。
    if (isReset) {
      scanFxRef.current = [];
    } else if (snapshot.lastScan) {
      const info = snapshot.lastScan;
      scanFxRef.current = [
        ...scanFxRef.current.filter(fx => fx.info.team !== info.team),
        { info, start: now, duration: scanDuration },
      ];
    }

    prevFieldRef.current = field;
    prevTurnCountRef.current = snapshot.turnCount;

    updateBlockAnimStates(now);
    updateItemFadeStates(now);
    updateScanFxStates(now);
    drawFrame(renderPosRef.current, now);
    startLoopIfNeeded();
    // snapshot 全体の変化 (= 新しいターンの受信) だけをターン間隔の計測・アニメ判定のトリガーにしたい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // ゲーム終了 (roundEnded: false→true) の瞬間、表示中のダーク幕を上からワイプで解除する。
  // 次のゲームが始まる (roundEnded: true→false) と通常のダーク幕表示に戻す。
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

  // 決着した瞬間 (decisive: null→非null) にインパクト演出を開始する。演出が終わっても
  // decisive が残っている限り盤面には表示され続け、次のゲーム開始/リセットで decisive が
  // null に戻ると消える (= フッターの結果ピルとまったく同じライフサイクル)。
  useEffect(() => {
    decisiveAnimRef.current = decisive ? { start: performance.now(), duration: DECISIVE_MS } : null;
    // 探索範囲はダーク幕より後 (= 決着演出より後) に描くため、残しておくと決着演出に被る
    if (decisive) scanFxRef.current = [];
    drawFrame(renderPosRef.current);
    startLoopIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisive]);

  // ターン間隔の計測やアニメーション状態とは無関係な見た目の変化 (テーマ・盤面サイズ・反転・
  // ダークモード・幕の濃さ) は、現在の補間位置のまま即座に再描画する。幕の濃さは設定を
  // 操作しながら会場の見え方を確かめるため、ターンが進まなくても即反映される必要がある
  useEffect(() => {
    drawFrame(renderPosRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip, darkMode, veil, textures, CELL, W, H]);

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
