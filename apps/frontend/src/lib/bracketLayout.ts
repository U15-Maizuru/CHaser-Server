import type { TournamentMatch } from '@u15/ws-types';

// トーナメント表の座標計算 (純関数)。
// カードは絶対配置の DOM、接続線は SVG の <path> で描くが、どちらもこの出力を座標源にする。

export interface BracketNode {
  matchId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BracketEdge {
  /** SVG の d 属性。子カードの右端 → 親カードの左端をカギ線で結ぶ */
  d: string;
  from: string;
  to: string;
}

export interface BracketLayout {
  nodes: BracketNode[];
  edges: BracketEdge[];
  width: number;
  height: number;
  /** 回戦ごとの見出し位置 */
  columns: { stage: number; x: number; label: string }[];
}

export interface BracketLayoutOptions {
  cardW?:  number;
  cardH?:  number;
  gapX?:   number;
  /** 同じ回戦のカード間の縦の隙間 */
  gapY?:   number;
  padding?: number;
  headerH?: number;
  /**
   * カードごとの実際の高さ。省略時は cardH 固定。
   *
   * 審判裁定の注記など、内容によって縦に伸びるカード (MatchCard.matchCardHeight) が
   * あるので、押し下げ・積み上げの計算はここで得た実際の高さを使う。固定の cardH で
   * 計算すると、伸びたカードの下に次のカード (3位決定戦など) が重なってしまう。
   */
  cardHeightOf?: (m: TournamentMatch) => number;
}

const DEFAULTS = { cardW: 208, cardH: 68, gapX: 56, gapY: 16, padding: 16, headerH: 26 };

/**
 * 試合グラフをトーナメント表の座標に落とす。
 *
 * 1回戦は上から順に等間隔で並べ、2回戦以降は「参照している子カード2つの中点」に置く。
 * これで bye や回戦数が変わっても線が破綻しない。
 * 3位決定戦のように決勝と同じ stage にあるカードは、その列の末尾へ積む。
 */
export function bracketLayout(
  matches: TournamentMatch[], opts: BracketLayoutOptions = {},
): BracketLayout {
  const { cardW, cardH, gapX, gapY, padding, headerH } = { ...DEFAULTS, ...opts };
  const heightOf = opts.cardHeightOf ?? (() => cardH);

  if (matches.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, columns: [] };
  }

  const stages = [...new Set(matches.map(m => m.stage))].sort((a, b) => a - b);
  const byStage = new Map<number, TournamentMatch[]>();
  for (const s of stages) {
    byStage.set(s, matches.filter(m => m.stage === s).sort((a, b) => a.order - b.order));
  }

  const pos = new Map<string, BracketNode>();
  const top = padding + headerH;

  stages.forEach((stage, col) => {
    const x = padding + col * (cardW + gapX);
    const list = byStage.get(stage)!;

    // 子カードを参照しない (先頭列の) カードは、前のカードの実際の高さぶんだけ
    // 積み上げて並べる。固定 cardH で数えると、伸びたカードの下で詰まって重なる
    let cursor = top;

    list.forEach(m => {
      const h = heightOf(m);
      // 参照している子カード (winner-of / loser-of) の中点に置く
      const childYs = [m.slotA, m.slotB]
        .map(r => (r.kind === 'winner-of' || r.kind === 'loser-of') ? pos.get(r.matchId) : undefined)
        .filter((n): n is BracketNode => !!n)
        .map(n => n.y + n.h / 2);

      let y: number;
      if (childYs.length > 0) {
        y = (Math.min(...childYs) + Math.max(...childYs)) / 2 - h / 2;
      } else {
        y = cursor;
        cursor += h + gapY;
      }

      pos.set(m.id, { matchId: m.id, x, y, w: cardW, h });
    });

    // 同じ列で重なったカード (3位決定戦など) を下へ押し下げる
    const placed = list.map(m => pos.get(m.id)!).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      const min = placed[i - 1]!.y + placed[i - 1]!.h + gapY;
      if (placed[i]!.y < min) placed[i]!.y = min;
    }
  });

  const nodes = matches.map(m => pos.get(m.id)!).filter(Boolean);

  const edges: BracketEdge[] = [];
  for (const m of matches) {
    const parent = pos.get(m.id);
    if (!parent) continue;
    for (const ref of [m.slotA, m.slotB]) {
      if (ref.kind !== 'winner-of' && ref.kind !== 'loser-of') continue;
      const child = pos.get(ref.matchId);
      if (!child) continue;

      const x1 = child.x + child.w;
      const y1 = child.y + child.h / 2;
      const x2 = parent.x;
      const y2 = parent.y + parent.h / 2;
      const mid = x1 + (x2 - x1) / 2;
      edges.push({
        d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
        from: ref.matchId,
        to: m.id,
      });
    }
  }

  const width  = padding * 2 + stages.length * cardW + (stages.length - 1) * gapX;
  const height = padding * 2 + headerH +
    Math.max(0, ...nodes.map(n => n.y + n.h)) - top + gapY;

  const columns = stages.map((stage, col) => ({
    stage,
    x: padding + col * (cardW + gapX),
    label: columnLabel(byStage.get(stage)!),
  }));

  return { nodes, edges, width, height, columns };
}

/** その列の見出し (「準決勝」など)。ラベルの「 第N試合」以降を落とす */
function columnLabel(list: TournamentMatch[]): string {
  const first = list[0];
  if (!first) return '';
  return first.label.split(' ')[0] ?? first.label;
}
