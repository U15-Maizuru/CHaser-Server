import type { MatchSlotRef, TournamentMatch } from '@u15/ws-types';
import { finalMatchOf } from './tournamentResult';

// 中央収束型トーナメント表の座標計算 (純関数)。
//
// 1人 (1側) = 1カードとして描く。決勝の slotA が指す試合の子孫と slotB が指す試合の子孫は、
// buildBracket (apps/backend) が二分木として組む時点で完全に独立しているので、決勝から
// 逆向きに winner-of/loser-of の参照を辿るだけで2つの山に分けられる (詳細は各関数のコメント)。
// どちらを左山にするかは試合番号 (order) の小さいほうで決める — 先に実施する山が
// 常に左に来るようにするため。
//
// 左山は左→右 (1回戦が一番外側)、右山は右→左 (同じく1回戦が一番外側) に並べ、
// 決勝はその中央の列に置く。3位決定戦は決勝と同じ stage を持つので、同じ中央列に積む。
// カードは絶対配置の DOM、接続線は SVG の <path> で描くが、どちらもこの出力を座標源にする。
//
// 1試合につき3枚: 対戦者2人ぶんのプレイヤーカード (side0/side1) と、その間に挟む
// 「対戦カード」(試合ラベル・状態バッジ・裁定注記) — プレイヤーカードは名前と得点だけに
// 保つため、試合そのものの情報はここへ分けて持たせる。

export interface BracketCardNode {
  matchId: string;
  side: 0 | 1;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 対戦カード (試合ラベル・状態バッジ) の位置。対になる2枚のプレイヤーカードの間に置く */
export interface BracketMatchNode {
  matchId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * この線が表す状態。BracketView の描画 (強調 / 通常 / 非表示) の元になる。
 *
 * - 'decided': 子の試合が実際の対戦で決着し、勝者がこの線の先へ進んだ (強調表示の対象)
 * - 'hidden':  子の試合が不戦 (片側 or 両側とも不在) — カードごと表に出さないので線も隠す
 * - 'pending': 子の試合がまだ決着していない (通常表示)
 *
 * 'loser-of' (3位決定戦への線) は、対戦で負けた側の移動であって「勝ち上がり」ではない
 * ので、子の試合が決着していても 'decided' にはしない。
 *
 * 線の両端は「対の中点」ではなく、実際に進む側の具体的なプレイヤーカードを結ぶ
 * (決着していれば winner-of は勝者のカード、loser-of は敗者のカードから出す。
 * まだ決着していなければ、どちらが来るか分からないので対の中点から出す)。
 * 親側は決着に関わらず、この参照が入る側 (slotA/slotB) のカードへ必ず繋ぐ。
 */
export type BracketEdgeKind = 'decided' | 'hidden' | 'pending';

export interface BracketEdge {
  /** SVG の d 属性。カギ線で結ぶ (向きは山の左右で変わる) */
  d: string;
  from: string;
  to: string;
  kind: BracketEdgeKind;
}

export interface BracketColumn {
  x: number;
  label: string;
}

export interface CenteredBracketLayout {
  nodes: BracketCardNode[];
  matchNodes: BracketMatchNode[];
  edges: BracketEdge[];
  columns: BracketColumn[];
  width: number;
  height: number;
}

export interface CenteredBracketLayoutOptions {
  cardW?: number;
  /** プレイヤーカード (名前・得点だけ) 1枚の高さ。side0/side1 とも常に同じ */
  cardH?: number;
  gapX?: number;
  /** 同じ列のカード間の縦の隙間 */
  gapY?: number;
  padding?: number;
  headerH?: number;
  /**
   * 対戦カード (試合ラベル・状態バッジ・裁定注記) の高さ。省略時は matchInfoH 固定。
   *
   * 裁定の注記が付く試合は1行ぶん伸びるので、押し下げ・積み上げの計算はここで得た
   * 実際の高さを使う。固定値で計算すると、伸びたカードの下に次のカード
   * (3位決定戦など) が重なってしまう。
   */
  matchInfoHeightOf?: (m: TournamentMatch) => number;
  /** matchInfoHeightOf を省略したときの対戦カードの高さ */
  matchInfoH?: number;
}

const DEFAULTS = {
  cardW: 208, cardH: 34, gapX: 56, gapY: 14, padding: 16, headerH: 22, matchInfoH: 24,
};

interface PairPos { matchId: string; x: number; y: number; w: number; h: number; }

export function centeredBracketLayout(
  matches: TournamentMatch[], opts: CenteredBracketLayoutOptions = {},
): CenteredBracketLayout {
  const { cardW, cardH, gapX, gapY, padding, headerH, matchInfoH } = { ...DEFAULTS, ...opts };
  const infoH = opts.matchInfoHeightOf ?? (() => matchInfoH);
  const pairH = (m: TournamentMatch) => cardH + infoH(m) + cardH;

  if (matches.length === 0) {
    return { nodes: [], matchNodes: [], edges: [], columns: [], width: 0, height: 0 };
  }

  const byId = new Map(matches.map(m => [m.id, m]));
  const final = finalMatchOf(matches);
  if (!final) {
    return { nodes: [], matchNodes: [], edges: [], columns: [], width: 0, height: 0 };
  }

  // 決勝の slotA/slotB から逆向きに辿って、2つの山に属する試合をそれぞれ集める
  const branchA = collectAncestors(final.slotA, byId);
  const branchB = collectAncestors(final.slotB, byId);
  // どちらを左山にするかは**表示位置 (order) で決める。slotA/slotB をそのまま使わないこと** —
  // 1ゲーム制では bracket.ts の sideCoin が決勝の slotA/slotB を大会 id 由来のコイントスで
  // 入れ替えるので、そのまま左右に割り当てると大会のおよそ半分で表が丸ごと左右反転する。
  // order は buildBracket が表の上から順に振るので、直接の子 (準決勝相当) の order が
  // 小さいほうを左に置けば、その山の試合はすべて反対側より上に来る。
  // (実施順は order ではなく試合番号 `no` で決まる。compareByPlayOrder を参照)
  const flipped = (branchB[0]?.order ?? 0) < (branchA[0]?.order ?? 0);
  const leftMatches  = flipped ? branchB : branchA;
  const rightMatches = flipped ? branchA : branchB;
  const leftIds  = new Set(leftMatches.map(m => m.id));
  const rightIds = new Set(rightMatches.map(m => m.id));
  // 決勝そのものと、どちらの山にも属さない試合 (3位決定戦) を中央列にまとめる
  const centerMatches = [
    final,
    ...matches.filter(m => m.id !== final.id && !leftIds.has(m.id) && !rightIds.has(m.id)),
  ].sort((a, b) => a.order - b.order);

  const leftStages  = [...new Set(leftMatches.map(m => m.stage))].sort((a, b) => a - b);
  const rightStages = [...new Set(rightMatches.map(m => m.stage))].sort((a, b) => a - b);

  const top = padding + headerH;
  const pos = new Map<string, PairPos>();
  const columns: BracketColumn[] = [];

  // 左山: 1回戦 (col=0) を一番左にして、決勝へ向かうほど右へ
  leftStages.forEach((stage, col) => {
    const x = padding + col * (cardW + gapX);
    const list = byStageWithin(matches, leftIds, stage);
    layoutColumn(list, x, cardW, top, gapY, pairH, pos);
    columns.push({ x, label: columnLabel(list) });
  });

  const finalColX = padding + leftStages.length * (cardW + gapX);

  // 右山: 1回戦 (rightStages の先頭) を一番右にして、決勝へ向かうほど左へ (中央へ寄る)
  const numRight = rightStages.length;
  rightStages.forEach((stage, col) => {
    const x = finalColX + (numRight - col) * (cardW + gapX);
    const list = byStageWithin(matches, rightIds, stage);
    layoutColumn(list, x, cardW, top, gapY, pairH, pos);
    columns.push({ x, label: columnLabel(list) });
  });

  // 中央列: 決勝 (+ 3位決定戦)。参照先 (準決勝相当) は左右の山で既に配置済みなので、
  // 「参照している子カード2つの中点」に自然に置ける
  layoutColumn(centerMatches, finalColX, cardW, top, gapY, pairH, pos);
  columns.push({ x: finalColX, label: columnLabel([final]) });

  const nodes: BracketCardNode[] = [];
  const matchNodes: BracketMatchNode[] = [];
  for (const m of matches) {
    const p = pos.get(m.id);
    if (!p) continue;
    const mh = infoH(m);
    nodes.push({ matchId: m.id, side: 0, x: p.x, y: p.y, w: p.w, h: cardH });
    matchNodes.push({ matchId: m.id, x: p.x, y: p.y + cardH, w: p.w, h: mh });
    nodes.push({ matchId: m.id, side: 1, x: p.x, y: p.y + cardH + mh, w: p.w, h: cardH });
  }

  const edges: BracketEdge[] = [];
  for (const m of matches) {
    const parent = pos.get(m.id);
    if (!parent) continue;
    ([m.slotA, m.slotB] as const).forEach((ref, parentSideIdx) => {
      if (ref.kind !== 'winner-of' && ref.kind !== 'loser-of') return;
      const child = pos.get(ref.matchId);
      const childMatch = byId.get(ref.matchId);
      if (!child || !childMatch) return;

      const parentSide = parentSideIdx as 0 | 1;

      // 左山は子が親より左、右山は子が親より右にある。カギ線はどちら向きでも同じ式で描ける
      const childLeftOfParent = child.x < parent.x;
      const x1 = childLeftOfParent ? child.x + child.w : child.x;
      const x2 = childLeftOfParent ? parent.x : parent.x + parent.w;

      // 決着していれば、実際にこの線を進む側 (winner-of なら勝者、loser-of なら敗者) の
      // カードから出す。まだ決着していなければ、どちらが来るか分からないので対の中点から
      const winnerSide = childMatch.result?.winnerSide ?? null;
      const advancingSide: 0 | 1 | null =
        winnerSide === null ? null :
        ref.kind === 'winner-of' ? winnerSide : (1 - winnerSide) as 0 | 1;
      const y1 = advancingSide !== null
        ? sideCenterY(child, cardH, infoH(childMatch), advancingSide)
        : child.y + child.h / 2;
      // 親側は決着に関わらず、この参照が入る側 (slotA/slotB) のカードへ必ず繋ぐ
      const y2 = sideCenterY(parent, cardH, infoH(m), parentSide);

      const mid = x1 + (x2 - x1) / 2;

      const childBye = childMatch.byeA || childMatch.byeB;
      const decided = childMatch.status === 'done' && winnerSide != null;
      const kind: BracketEdgeKind =
        childBye ? 'hidden' :
        (decided && ref.kind === 'winner-of') ? 'decided' :
        'pending';

      edges.push({
        d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
        from: ref.matchId,
        to: m.id,
        kind,
      });
    });
  }

  const width  = padding + Math.max(0, ...nodes.map(n => n.x + n.w));
  const height = padding + Math.max(0, ...nodes.map(n => n.y + n.h));

  return { nodes, matchNodes, edges, columns, width, height };
}

/** 対 (side0/side1) の中で、指定した side のプレイヤーカード自身の縦中心 */
function sideCenterY(p: PairPos, cardH: number, matchH: number, side: 0 | 1): number {
  return side === 0 ? p.y + cardH / 2 : p.y + cardH + matchH + cardH / 2;
}

/**
 * ref が winner-of/loser-of なら、参照先の試合と、その試合が (同様に) 参照する
 * 試合を再帰的にすべて集める。参照先が無くなる (participant/bye/group-rank) か、
 * 試合が見つからないところで止まる。
 */
function collectAncestors(
  ref: MatchSlotRef, byId: Map<string, TournamentMatch>,
): TournamentMatch[] {
  if (ref.kind !== 'winner-of' && ref.kind !== 'loser-of') return [];
  const m = byId.get(ref.matchId);
  if (!m) return [];
  return [m, ...collectAncestors(m.slotA, byId), ...collectAncestors(m.slotB, byId)];
}

function byStageWithin(
  matches: TournamentMatch[], ids: Set<string>, stage: number,
): TournamentMatch[] {
  return matches
    .filter(m => ids.has(m.id) && m.stage === stage)
    .sort((a, b) => a.order - b.order);
}

/** 1列ぶんの配置。「参照している子カード2つの中点」に置き、参照が無ければ上から積む */
function layoutColumn(
  list: TournamentMatch[], x: number, w: number, top: number, gapY: number,
  pairHeightOf: (m: TournamentMatch) => number, pos: Map<string, PairPos>,
): void {
  let cursor = top;

  list.forEach(m => {
    const h = pairHeightOf(m);
    const childYs = [m.slotA, m.slotB]
      .map(r => (r.kind === 'winner-of' || r.kind === 'loser-of') ? pos.get(r.matchId) : undefined)
      .filter((n): n is PairPos => !!n)
      .map(n => n.y + n.h / 2);

    let y: number;
    if (childYs.length > 0) {
      y = (Math.min(...childYs) + Math.max(...childYs)) / 2 - h / 2;
    } else {
      y = cursor;
      cursor += h + gapY;
    }

    pos.set(m.id, { matchId: m.id, x, y, w, h });
  });

  // 同じ列で重なったカード (3位決定戦など) を下へ押し下げる
  const placed = list.map(m => pos.get(m.id)!).sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) {
    const min = placed[i - 1]!.y + placed[i - 1]!.h + gapY;
    if (placed[i]!.y < min) placed[i]!.y = min;
  }
}

/** その列の見出し (「準決勝」など)。ラベルの「 第N試合」以降を落とす */
function columnLabel(list: TournamentMatch[]): string {
  const first = list[0];
  if (!first) return '';
  return first.label.split(' ')[0] ?? first.label;
}
