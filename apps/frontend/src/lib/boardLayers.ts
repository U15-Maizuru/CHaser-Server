import type { Point, ScanInfo } from '@u15/ws-types';
import type { TextureKey } from '../hooks/useTextures';
import type { DecisiveEffect } from './decisiveEffect';
import { BOARD_COLOR, drawBlockFallback } from './boardDraw';

// 盤面 canvas のレイヤーのうち、自己完結していて外から状態を渡せるもの。
// GameBoardCanvas の drawFrame は元々 330 行の一本道で、床・オブジェクト・プレイヤー・
// 決着演出・ダーク幕・探索範囲がすべて同じ関数の中にあった。ここへ出したのは
// 「盤面の上に重ねる」2つのレイヤーで、どちらも入力が明示的なので単体で読める。

const COLOR = BOARD_COLOR;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * 探索範囲演出の不透明度。出現時に素早く立ち上がり、後半でフェードアウトする。
 * ダーク幕の打ち抜き (drawVeilLayer) と枠の描画で同じ値を使う必要があるためここに置く。
 */
export function scanAlpha(ratio: number, fadeStart: number): number {
  if (ratio >= 1) return 0;
  const appear = Math.min(1, Math.max(0, ratio) / 0.15);
  const fade   = ratio > fadeStart ? 1 - (ratio - fadeStart) / (1 - fadeStart) : 1;
  return Math.max(0, appear * fade);
}

/** レイヤー共通の描画コンテキスト */
export interface LayerBase {
  ctx:  CanvasRenderingContext2D;
  cx:   (col: number) => number;
  cy:   (row: number) => number;
  CELL: number;
  size: Point;
  positions: readonly [Point, Point];
  /** テクスチャがあれば描いて true、無ければ false */
  drawImg: (key: TextureKey, x: number, y: number) => boolean;
}

/**
 * 決着演出。どの決着理由でも勝者に 👑 が付き敗者は暗転するので、盤面を見れば
 * 必ず勝敗が分かる。敗者側のバッジと形 (下敷き/囲まれ) と色 (攻撃側プレイヤー色=相手のせい /
 * 警告色=自滅) は、その上で「なぜ負けたか」を静止画でも読み取れるようにするためのもの。
 *
 * ratio は最初のインパクト (リング拡散・ブロックのポップイン) の進行度 0..1。
 * 1 に達したあとも演出は静止した状態で残り続ける。
 */
export function drawDecisiveLayer(
  base: LayerBase, decisiveNow: DecisiveEffect | null, ratio: number,
): void {
  const { ctx, cx, cy, CELL, size, positions, drawImg } = base;
  if (decisiveNow) {
    const eased = easeOutQuad(ratio);
    const lineW = Math.max(2, CELL * 0.09);

    // アクセント色の枠を1マス分描く (セル内側に収まるよう線幅の半分だけ内寄せする)
    const strokeCell = (col: number, row: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth   = lineW;
      ctx.beginPath();
      ctx.roundRect(
        cx(col) + lineW / 2, cy(row) + lineW / 2,
        CELL - lineW, CELL - lineW,
        Math.max(3, CELL * 0.15),
      );
      ctx.stroke();
    };

    // 敗者を先に描いてから勝者を描く。順序を逆にすると敗者の暗転が勝者のグローに
    // 掛かってしまい、勝者側が沈んで見えてしまう
    const ordered = [...decisiveNow.marks].sort(
      (a, b) => (a.role === 'winner' ? 1 : 0) - (b.role === 'winner' ? 1 : 0),
    );

    for (const mark of ordered) {
      const pos     = positions[mark.team];
      const centerX = cx(pos.x) + CELL / 2;
      const centerY = cy(pos.y) + CELL / 2;
      // 'opponent' = そのプレイヤーの相手の色 (= 敗者から見た攻撃側の色)
      const accent =
        mark.accent === 'opponent' ? (mark.team === 0 ? COLOR.hot : COLOR.cool) :
        mark.accent === 'warn'     ? COLOR.warn :
        mark.accent === 'gold'     ? COLOR.gold : null;

      ctx.save();

      if (mark.shape === 'crush') {
        // 敗者の上にブロックを重ねて「下敷き」を表現する。小さめ (0.72倍) に描くことで
        // キャラクターが四辺から覗き、「キャラの上にブロックが乗っている」関係が読み取れる
        const scale = 0.72 * (0.55 + 0.45 * eased); // 落ちてきて収まるポップイン
        ctx.save();
        ctx.globalAlpha = eased;
        ctx.translate(centerX, centerY);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);
        if (!drawImg('Block', cx(pos.x), cy(pos.y))) drawBlockFallback(ctx, cx(pos.x), cy(pos.y), CELL);
        ctx.restore();
      } else if (mark.shape === 'surround') {
        // 閉じ込め・自縛: 敗者の上下左右のブロックを強調する。歩行補間の途中でも
        // 隣接マスはセル境界に合わせる必要があるため、整数マスに丸めて使う
        const bx = Math.round(pos.x);
        const by = Math.round(pos.y);
        const neighbors = [[bx, by - 1], [bx, by + 1], [bx - 1, by], [bx + 1, by]];
        ctx.globalAlpha = eased;
        for (const [nx, ny] of neighbors) {
          // 盤外 (壁で塞がれている辺) は描くセルが無いのでスキップする
          if (nx < 0 || ny < 0 || nx >= size.x || ny >= size.y) continue;
          // 枠が下に隠れないよう、ブロックを描き直してからその上に枠を重ねる
          if (!drawImg('Block', cx(nx), cy(ny))) drawBlockFallback(ctx, cx(nx), cy(ny), CELL);
          if (accent) strokeCell(nx, ny, accent);
        }
        ctx.globalAlpha = 1;
      }

      // 敗北の暗転。キャラ自身のマスだけを覆う (閉じ込めの周囲4マスは暗転させない)
      if (mark.dim) {
        ctx.globalAlpha = 0.45 * eased;
        ctx.fillStyle   = '#000000';
        ctx.fillRect(cx(pos.x), cy(pos.y), CELL, CELL);
        ctx.globalAlpha = 1;
      }

      // 勝者のグロー: 敗者側の「線のリング」に対して「面の光」で描き分ける。
      // gold と warn は色相が近いため、色だけに頼らず形と明暗でも区別できるようにしている
      if (mark.role !== 'loser' && accent) {
        const r = CELL * 0.9 * eased;
        if (r > 0) {
          const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, r);
          grad.addColorStop(0,    `${accent}cc`);
          grad.addColorStop(0.45, `${accent}66`);
          grad.addColorStop(1,    `${accent}00`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // キャラのマスを囲むリング ('surround' は既に周囲4マスへ描いたので二重に描かない)
      if (accent && mark.shape !== 'surround') {
        ctx.globalAlpha = eased;
        strokeCell(pos.x, pos.y, accent);
        ctx.globalAlpha = 1;
      }

      // インパクトのリング: アクセント色の輪が外へ拡がりながら消える (演出中のみ)
      if (ratio < 1 && accent) {
        ctx.globalAlpha = 1 - eased;
        ctx.strokeStyle = accent;
        ctx.lineWidth   = lineW;
        ctx.beginPath();
        ctx.arc(centerX, centerY, CELL * (0.5 + 0.6 * eased), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // バッジ: マス中央に置く。勝敗と敗因を色とは独立にもう一度示すことで、
      // 色が見づらい環境でも区別できるようにする。暗いブロックの上にも明るい床の上にも
      // 乗るため、縁取りを付けて両方で読めるようにする
      if (mark.badge) {
        ctx.globalAlpha  = eased;
        ctx.font         = `${Math.max(10, Math.floor(CELL * 0.5))}px sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth    = Math.max(2, CELL * 0.06);
        ctx.strokeStyle  = 'rgba(0,0,0,0.65)';
        ctx.lineJoin     = 'round';
        ctx.strokeText(mark.badge, centerX, centerY);
        // 絵文字が白黒グリフにフォールバックした場合でも見えるよう fillStyle を明示する
        ctx.fillStyle = '#ffffff';
        ctx.fillText(mark.badge, centerX, centerY);
      }

      ctx.restore();
    }
  }
}

export interface VeilOptions {
  maskCanvas: HTMLCanvasElement;
  W: number;
  H: number;
  veilAlpha: number;
  /** 幕の上端がどこまで下がったか 0..1 (ワイプ解除の進行度。0 なら全面を覆う) */
  wipeProgress: number;
  /** 幕を打ち抜く探索範囲。alpha は演出のフェードに合わせた不透明度 */
  scans: readonly { cells: ScanInfo['cells']; alpha: number }[];
}

/**
 * ダークモードの幕。
 *
 * 幕は別レイヤー (オフスクリーン canvas) 上で塗りつぶし→切り抜きを完結させ、その結果だけを
 * メイン canvas に重ね描きする。切り抜き (destination-out) の対象をメイン canvas から分離
 * することで、既に描画済みのマップ (床・ブロック・プレイヤー) には触れずに、視界の穴に
 * 地図がそのまま透けて見える見た目を実現している。
 */
export function drawVeilLayer(base: LayerBase, opts: VeilOptions): void {
  const { ctx, cx, cy, CELL, size, positions } = base;
  const { maskCanvas, W, H, veilAlpha, wipeProgress, scans } = opts;

  if (maskCanvas.width !== W || maskCanvas.height !== H) {
    maskCanvas.width  = W;
    maskCanvas.height = H;
  }
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  maskCtx.clearRect(0, 0, W, H);
  maskCtx.fillStyle = `rgba(0,0,0,${veilAlpha})`;
  // ワイプ進行中は幕の上端を下へ動かし、上から徐々に消えていくように見せる
  const coverTop = H * wipeProgress;
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

  // 探索したマスも幕を打ち抜いて中身を見せる。演出のフェードに合わせて
  // globalAlpha を落とすことで、演出の終了とともに穴が閉じていく。
  for (const fx of scans) {
    if (fx.alpha <= 0) continue;
    maskCtx.globalAlpha = fx.alpha;
    for (const c of fx.cells) {
      if (c.x < 0 || c.x >= size.x || c.y < 0 || c.y >= size.y) continue;
      maskCtx.beginPath();
      maskCtx.roundRect(cx(c.x), cy(c.y), CELL, CELL, Math.max(2, CELL * 0.12));
      maskCtx.fill();
    }
  }
  maskCtx.restore();

  ctx.drawImage(maskCanvas, 0, 0);
}
