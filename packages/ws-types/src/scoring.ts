// 競技ルールの得点・勝敗判定のうち、バックエンドとフロントエンドの両方が必要とする純関数。
//
// 元は apps/frontend/src/lib/{roundSide,setResult}.ts にあったが、大会運営機能
// (apps/backend/src/tournament) がサーバー側で試合勝者を求める必要が出たため共有パッケージへ
// 移した。フロント側の元ファイルは re-export のシムとして残してある。
//
// 依存は ./protocol.js のみ。index.ts (このファイルを re-export する側) から import すると
// 循環参照になり、Winner のような実行時 enum の初期化順が壊れるので絶対にしないこと。

import { Reason, Winner } from './protocol.js';
import type { RoundResult } from './protocol.js';

// ── 競技ルールの係数 ───────────────────────────────────────────────────────
// 値の実体と説明は必ずここに置く。以前は実体がバックエンドの GameLogic.ts にあり、
// 説明だけが protocol.ts の RoundResult のコメントに数字ごと書かれていた。

/** アイテム1個あたりのポイント */
export const ITEM_POINT = 10;
/** アタック・閉じ込めで勝った側への「一撃」加点 */
export const STRIKE_WIN_BONUS = 50;
/** 衝突・自縛・通信エラーで負けた側への「一撃」減点 (×自分の獲得アイテム数) */
export const BLUNDER_PENALTY_PER_ITEM = 3;
/** 「総取り」ボーナス (×決着時点の残アイテム数) */
export const SWEEP_POINT_PER_ITEM = 6;

// ── 勝者・敗者の対応 ───────────────────────────────────────────────────────

/** team-index (0=COOL/1=HOT) が負けたときの勝者 */
export function winnerAgainst(teamIdx: 0 | 1): Winner {
  return teamIdx === 0 ? Winner.HOT : Winner.COOL;
}

/** 勝者が COOL/HOT のとき、敗者の team-index */
export function loserIdxOf(winner: Winner.COOL | Winner.HOT): 0 | 1 {
  return winner === Winner.COOL ? 1 : 0;
}

/** 反則負けの減点対象 (自縛・衝突・通信エラー。相手を追い詰めた側 (TRAPPED/ATTACK) は対象外) */
export function isBlunder(reason: Reason): boolean {
  return reason === Reason.CONFINED
      || reason === Reason.COLLISION
      || reason === Reason.FOULED;
}

/**
 * ゲーム別のボーナス内訳。競技ルールの「ポイント」より:
 *
 *   一撃ボーナス (ペナルティ)
 *     アタック・閉じ込め【勝】: STRIKE_WIN_BONUS を加点
 *     衝突・自縛【敗】       : 獲得したアイテム数 × BLUNDER_PENALTY_PER_ITEM を減点
 *                              (通信エラーも同扱い)
 *   総取り【勝】             : 残りのアイテム数 × SWEEP_POINT_PER_ITEM を加点
 *
 * reason===SCORE (ターン切れによるアイテム数判定) の場合はどちらも 0。
 * 勝者が定まらない決着 (引き分け等) でも 0。
 */
export function calculateBonusBreakdown(
  winner:     Winner,
  reason:     Reason,
  scores:     [number, number], // [cool, hot]
  leaveItems: number,
): { strikeBonus: [number, number]; sweepBonus: [number, number] } {
  const strikeBonus: [number, number] = [0, 0];
  const sweepBonus:  [number, number] = [0, 0];

  if (reason === Reason.SCORE) return { strikeBonus, sweepBonus };
  // 勝者が COOL/HOT に定まらない場合 (DRAW/CONTINUE/NONE) は加点対象が無い。
  // 勝者側への加点 (一撃・総取り) が入るため、ここで明示的に弾く
  if (winner !== Winner.COOL && winner !== Winner.HOT) return { strikeBonus, sweepBonus };

  const loserIdx  = loserIdxOf(winner);
  const winnerIdx = loserIdx === 0 ? 1 : 0;

  if (isBlunder(reason)) {
    // 自滅による決着: 敗者に減点。勝者は「一撃」の加点対象ではない
    strikeBonus[loserIdx] = -BLUNDER_PENALTY_PER_ITEM * scores[loserIdx];
  } else {
    // 相手を仕留めた決着 (アタック / 閉じ込め): 勝者に定額加点
    strikeBonus[winnerIdx] = STRIKE_WIN_BONUS;
  }
  sweepBonus[winnerIdx] = SWEEP_POINT_PER_ITEM * leaveItems;

  return { strikeBonus, sweepBonus };
}

// 2ゲーム制: 画面の物理的な左右 (side) とゲーム番号 (round) から、その画面側に表示すべき
// プレイヤー番号 (team-index, 0=COOL/1=HOT) を求める。第2ゲームは先攻/後攻が入れ替わるため、
// 同じ side でも round が変われば idx も入れ替わる。
export function idxForSide(side: 0 | 1, round: 0 | 1): 0 | 1 {
  return ((side + round) % 2) as 0 | 1;
}

// 「試合」= 対戦全体 (競技ルールの「試合」)。1ゲーム制なら1ゲーム、2ゲーム制なら
// 同じマップで先後を入れ替えた2ゲームがひとまとまりの試合になる。
//
// 集計の単位は team-index (COOL/HOT) ではなく画面側 (side) であることに注意。2ゲーム制では
// 1ゲームごとに先攻/後攻が入れ替わるため、同じプログラムを追いかけるには round ごとに
// idxForSide で team-index を引き直す必要がある。

/** 1ゲーム分の合計ポイント: アイテムポイント + 一撃ボーナス + 総取りボーナス */
export function roundPointsFor(rr: RoundResult, side: 0 | 1): number {
  const idx = idxForSide(side, rr.round);
  return rr.scores[idx] * ITEM_POINT + rr.strikeBonus[idx] + rr.sweepBonus[idx];
}

// 合計ポイントの3成分。同点の順位を内訳で割る必要がある場面 (BOT対戦予選の
// 「合計 → 一撃 → アイテム」) のために、side → team-index の引き直しを再実装せずに済ませる。

/** 1ゲーム分のアイテムポイント (獲得アイテム数 × ITEM_POINT) */
export function roundItemPointsFor(rr: RoundResult, side: 0 | 1): number {
  return rr.scores[idxForSide(side, rr.round)] * ITEM_POINT;
}

/** 1ゲーム分の一撃ボーナス (アタック/閉じ込めの +50、自滅の罰点) */
export function roundStrikeBonusFor(rr: RoundResult, side: 0 | 1): number {
  return rr.strikeBonus[idxForSide(side, rr.round)];
}

/** 1ゲーム分の総取りボーナス (残アイテム数×6) */
export function roundSweepBonusFor(rr: RoundResult, side: 0 | 1): number {
  return rr.sweepBonus[idxForSide(side, rr.round)];
}

/** そのゲームを画面側 (side) のプログラムが勝ったか */
export function roundWonBy(rr: RoundResult, side: 0 | 1): boolean {
  const idx = idxForSide(side, rr.round);
  return rr.winner === (idx === 0 ? Winner.COOL : Winner.HOT);
}

export interface SetResult {
  /** side 0 / side 1 それぞれの、完了した全ゲームの合計ポイント */
  totals: [number, number];
  /** side 0 / side 1 それぞれの勝利数 (引き分けはどちらにも加算しない) */
  wins: [number, number];
  /** 引き分けたゲーム数 */
  draws: number;
  /** 試合全体の勝者となる画面側。決まらなければ null */
  winnerSide: 0 | 1 | null;
  /** 勝者が何で決まったか (勝利数 / 合計ポイント)。決まらなければ null */
  decidedBy: 'wins' | 'points' | null;
}

/**
 * wins/draws を集計し、①勝利数→②合計ポイントの順で試合全体の勝者を決める。
 * totals が何のポイントか (舞鶴大会の合計ポイント / 交流大会の得点) は呼び出し側に委ねる —
 * koryuScoring.ts の computeKoryuBotSetResult/computeKoryuMatchSetResult も
 * これを呼ぶ (勝敗数の集計と①②の判定順は両ルールセットで共通のロジックのため)。
 *
 * 試合勝者を示す表示 (サイドパネルの総合欄の 🏆 など) が別々に計算して食い違わないよう、
 * 判定はこの関数に一本化する。
 */
export function decideSetResult(totals: [number, number], roundResults: RoundResult[]): SetResult {
  const wins: [number, number] = [0, 0];
  let draws = 0;

  for (const rr of roundResults) {
    if (rr.winner === Winner.DRAW) {
      draws++;
    } else if (roundWonBy(rr, 0)) {
      wins[0]++;
    } else if (roundWonBy(rr, 1)) {
      wins[1]++;
    }
  }

  let winnerSide: 0 | 1 | null = null;
  let decidedBy: 'wins' | 'points' | null = null;
  if (wins[0] !== wins[1]) {
    winnerSide = wins[0] > wins[1] ? 0 : 1;
    decidedBy  = 'wins';
  } else if (totals[0] !== totals[1]) {
    winnerSide = totals[0] > totals[1] ? 0 : 1;
    decidedBy  = 'points';
  }

  return { totals, wins, draws, winnerSide, decidedBy };
}

/** 完了したゲーム結果から、舞鶴大会ルールの試合全体の成績と勝者を求める (合計ポイントで判定)。 */
export function computeSetResult(roundResults: RoundResult[]): SetResult {
  const totals: [number, number] = [0, 0];
  for (const rr of roundResults) {
    totals[0] += roundPointsFor(rr, 0);
    totals[1] += roundPointsFor(rr, 1);
  }
  return decideSetResult(totals, roundResults);
}
