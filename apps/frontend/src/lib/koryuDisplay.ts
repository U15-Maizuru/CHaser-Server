import type {
  RoundResult, RuleSet, SetResult, SoloScoringMode, TournamentStatePayload,
} from '@u15/ws-types';
import {
  armedMatchOf, BOT_ITEM_MULTIPLIER, computeKoryuBotSetResult, computeKoryuMatchSetResult,
  computeSetResult, koryuBotRoundScore, koryuMatchRoundItems, roundPointsFor,
} from '@u15/ws-types';

// 対戦画面 (PlayerSidePanel など) が得点の内訳をどちらの式で見せるかの判定。
//
// 交流大会ルールは予選 (BOT対戦) と決勝トーナメントで得点式が違う (koryuScoring.ts) ため、
// 大会に紐付いている試合が予選か決勝かを armedMatchId から読み取っておく必要がある。
// 大会に紐付いていない単発対戦 (トーナメント外) は armedMatchId が無いので、代わりに
// 「設定」で選んだ表示モード (DisplayPrefs.scoreDisplayMode) から直接組み立てる。

export interface ScoringContext {
  ruleSet:      RuleSet;
  isQualifying: boolean;
}

export const MAIZURU_SCORING: ScoringContext = { ruleSet: 'maizuru', isQualifying: false };

/** 単発対戦の表示モードをそのまま ScoringContext に変換する (大会に紐付くときは使わない) */
export function scoringContextForMode(mode: SoloScoringMode): ScoringContext {
  return { ruleSet: mode === 'maizuru' ? 'maizuru' : 'koryu', isQualifying: mode === 'koryu-bot' };
}

export function scoringContextOf(
  tournamentState: TournamentStatePayload | null | undefined,
  soloMode: SoloScoringMode = 'maizuru',
): ScoringContext {
  if (!tournamentState) return scoringContextForMode(soloMode);
  const match = armedMatchOf(tournamentState);
  return { ruleSet: tournamentState.ruleSet, isQualifying: match?.group !== undefined };
}

/** 交流大会ルールでの1ゲーム分の得点。予選は items×3±残りターン数、決勝は獲得アイテム数 */
export function koryuRoundScore(rr: RoundResult, side: 0 | 1, ctx: ScoringContext): number {
  return ctx.isQualifying ? koryuBotRoundScore(rr, side) : koryuMatchRoundItems(rr, side);
}

/** 1ゲーム分の表示用得点。ルールセットに応じて舞鶴大会/交流大会の式を出し分ける */
export function roundDisplayScore(rr: RoundResult, side: 0 | 1, ctx: ScoringContext): number {
  return ctx.ruleSet === 'koryu' ? koryuRoundScore(rr, side, ctx) : roundPointsFor(rr, side);
}

/**
 * 交流大会ルールでの進行中 (決着前) の得点。予選 (BOT対戦) はアイテム数×3の部分だけなら
 * 決着前でも確定しているので掛けて見せる (残りターン数の加減算は決着後)。決勝トーナメントは
 * 反則調整の有無自体が決着理由に依存するため、素のアイテム数のまま見せる。
 */
export function koryuLiveRoundScore(items: number, ctx: ScoringContext): number {
  return ctx.isQualifying ? items * BOT_ITEM_MULTIPLIER : items;
}

/** 試合 (2ゲーム) の勝敗判定。ルールセット・予選/決勝に応じて式を出し分ける */
export function setResultFor(roundResults: RoundResult[], ctx: ScoringContext): SetResult {
  if (ctx.ruleSet !== 'koryu') return computeSetResult(roundResults);
  return ctx.isQualifying
    ? computeKoryuBotSetResult(roundResults)
    : computeKoryuMatchSetResult(roundResults);
}
