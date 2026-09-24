import type { TournamentBracketView, TournamentMatch } from '@u15/ws-types';
import { splitBranches, type BracketSide } from './centeredBracketLayout';
import { finalMatchOf } from './tournamentResult';

// 回戦数の多いトーナメントで、観客に見せる表を絞る。各型の意味は `TournamentBracketView`
// (ws-types) の説明を参照。16人枠 (4回戦) 以上は1回戦だけで8試合以上あり、表全体を
// 1画面に収めると文字が小さくなるので、'auto' はこの回戦数以上で絞る。

const FOCUS_MIN_ROUNDS = 4;

/** 絞った結果。side は、元の表 (全体) でその山があった側 */
export interface FocusedBracket {
  matches: TournamentMatch[];
  /** 片側の山だけに絞ったときだけ入る。描くときは同じ側に置くと、全体の表と左右が一致する */
  side:    BracketSide | null;
}

/**
 * 運営が選んだ型に従って、表示する試合を絞る。
 *
 * - 'left' / 'right': その側の山と決勝だけ。**3位決定戦は含めない** (相手の山を隠すので
 *   片側しか埋まらず、「その試合から決勝まで」を見せる目的にも要らない)
 * - 'quarter': 準々決勝 (決勝の2つ前の回戦) から決勝まで。3位決定戦も残る
 * - 'auto': targetId (対戦待ちの試合) に合わせる。`autoFocus` を参照
 *
 * **型が成り立たないとき (山が2つ無いなど) は絞らず全体を返す。**
 * 表が空になるより、全体が出るほうが観客には無害。
 */
export function focusBracketBlock(
  matches: TournamentMatch[], targetId: string | null, view: TournamentBracketView = 'auto',
): FocusedBracket {
  const whole: FocusedBracket = { matches, side: null };
  const final = finalMatchOf(matches);
  if (!final || view === 'whole') return whole;

  switch (view) {
    case 'left':
    case 'right': {
      const { left, right } = splitBranches(final, new Map(matches.map(m => [m.id, m])));
      // 山が片方しか無い (2人だけの表など) と左右が決まらない
      if (left.length === 0 || right.length === 0) return whole;
      return { matches: [...(view === 'left' ? left : right), final], side: view };
    }
    case 'quarter': {
      const quarterStage = final.stage - 2;
      return { matches: matches.filter(m => m.stage >= quarterStage), side: null };
    }
    case 'auto':
      return autoFocus(matches, final, targetId);
  }
}

/**
 * 進行に合わせた絞り込み ('auto')。具体的な型を選んで `focusBracketBlock` に委ねる。
 *
 * - 1回戦の試合が基準: その試合を含む側の山 ('left' / 'right')。1回戦の試合は、勝ち上がる先の
 *   山にしか関係しない
 * - 準々決勝以降の試合が基準: 'quarter'
 * - それ以外 (基準が無い・見つからない・4回戦未満・5回戦以上の2回戦など): 全体
 */
function autoFocus(
  matches: TournamentMatch[], final: TournamentMatch, targetId: string | null,
): FocusedBracket {
  const whole: FocusedBracket = { matches, side: null };
  const target = targetId ? matches.find(m => m.id === targetId) : undefined;
  const firstStage = Math.min(...matches.map(m => m.stage));
  if (!target || final.stage - firstStage + 1 < FOCUS_MIN_ROUNDS) return whole;

  if (target.stage >= final.stage - 2) return focusBracketBlock(matches, null, 'quarter');
  if (target.stage !== firstStage)     return whole;

  const { left, right } = splitBranches(final, new Map(matches.map(m => [m.id, m])));
  if (left.some(m => m.id === target.id))  return focusBracketBlock(matches, null, 'left');
  if (right.some(m => m.id === target.id)) return focusBracketBlock(matches, null, 'right');
  return whole;
}
