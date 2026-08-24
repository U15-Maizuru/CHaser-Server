import type { GameStateSnapshot, RoundResult, ServerStatusPayload } from '@u15/ws-types';
import { idxForSide, ITEM_POINT, roundPointsFor, roundWonBy, Winner } from '@u15/ws-types';
import {
  koryuLiveRoundScore, koryuRoundScore, MAIZURU_SCORING, type ScoringContext,
} from './koryuDisplay';

// 2ゲーム制のサイドパネルに出す1ゲーム分の明細。純粋な組み立てなのでここでテストできる。

export type RoundRowStatus = 'finished' | 'live' | 'pending';
export type RoundOutcome   = 'WIN' | 'LOSE' | 'DRAW';

export function roundOutcome(rr: RoundResult, side: 0 | 1): RoundOutcome {
  if (rr.winner === Winner.DRAW) return 'DRAW';
  return roundWonBy(rr, side) ? 'WIN' : 'LOSE';
}

export interface RoundRowData {
  round:       0 | 1;
  idx:         0 | 1;
  label:       'COOL' | 'HOT';
  status:      RoundRowStatus;
  items:       number;
  strikeBonus: number;
  sweepBonus:  number;
  outcome:     RoundOutcome | null;
  /** アイテム + 一撃 + 総取り。2ゲーム分を足すと総合の合計ポイントになる */
  subtotal:    number;
}

// 画面側 (side) ×ゲーム番号 (round) から、確定済み/進行中/未対戦のいずれかを判定してスコア行を組み立てる。
// 第1ゲーム終了直後は phase='finished' のまま currentRound だけ 1 に進むため、対応する
// roundResults が無い限りは (currentRound===round であっても) 進行中とはみなさない —
// これにより第1ゲームの古いスナップショットを第2ゲームの行に誤表示することを防いでいる。
export function computeRoundRow(
  side: 0 | 1,
  round: 0 | 1,
  roundResults: RoundResult[],
  serverStatus: ServerStatusPayload | null,
  snapshot: GameStateSnapshot | null,
  ctx: ScoringContext = MAIZURU_SCORING,
): RoundRowData {
  const idx   = idxForSide(side, round);
  const label = idx === 0 ? 'COOL' : 'HOT';
  const rr    = roundResults.find(r => r.round === round);
  const isKoryu = ctx.ruleSet === 'koryu';

  if (rr) {
    const items       = rr.scores[idx];
    const strikeBonus = rr.strikeBonus[idx];
    const sweepBonus  = rr.sweepBonus[idx];
    return {
      round, idx, label, status: 'finished',
      items, strikeBonus, sweepBonus,
      outcome: roundOutcome(rr, side),
      subtotal: isKoryu ? koryuRoundScore(rr, side, ctx) : roundPointsFor(rr, side),
    };
  }

  const isLive = serverStatus?.currentRound === round && serverStatus?.phase === 'playing';
  if (isLive) {
    const items = snapshot?.teamScore[idx] ?? 0;
    // 進行中は決着理由も残りターン数もまだ確定していないので、それらに依存する分は見せられない
    return {
      round, idx, label, status: 'live', items, strikeBonus: 0, sweepBonus: 0, outcome: null,
      subtotal: isKoryu ? koryuLiveRoundScore(items, ctx) : items * ITEM_POINT,
    };
  }

  return { round, idx, label, status: 'pending', items: 0, strikeBonus: 0, sweepBonus: 0, outcome: null, subtotal: 0 };
}
