import type {
  MatchRules, ResolvedParticipant, StageRules, TournamentFormat, TournamentMatch,
  TournamentStatePayload,
} from './tournament.js';
import { compareByPlayOrder, hasBracket, hasQualifying } from './tournament.js';

// 試合グラフから「今どうなっているか」を読み取る述語。
//
// バックエンドの進行管理・自動進行と、運営パネルの「今やること」が同じ規則で動くよう、
// 判定はすべてここに置く。状態を持たず、試合の配列だけを見る。

/** 次に実施すべき試合 (ready のうち実施順が最も早いもの。3位決定戦は決勝より先) */
export function nextReadyMatch(matches: TournamentMatch[]): TournamentMatch | null {
  return [...matches].filter(m => m.status === 'ready').sort(compareByPlayOrder)[0] ?? null;
}

/**
 * 勝ち上がりの試合か (= 勝者不在のまま確定できない試合か)。
 *
 * 形式**と**試合の両方を見る:
 *   league             … 勝ち上がりが無いので常に false (引き分けはそのまま確定できる)
 *   single-elimination … 常に true
 *   予選のある形式      … 1つの大会に予選と決勝が同居するので、group の有無で分ける
 */
export function isKnockoutMatch(format: TournamentFormat, m: TournamentMatch): boolean {
  return hasBracket(format) && m.group === undefined;
}

/**
 * その試合を先後入替の2ゲームで行うか。
 *
 * 予選のある形式は予選・決勝で別々に選べる (StageRules.qualifyingDoubleMode)。
 * 対象が予選の試合かどうかは isKnockoutMatch と同じ基準 (group の有無) で判定する。
 */
export function doubleModeFor(
  def: { stage: StageRules; match: MatchRules }, m: TournamentMatch,
): boolean {
  const { stage } = def;
  if ((stage.format === 'group-then-bracket' || stage.format === 'bot-then-bracket')
      && !isKnockoutMatch(stage.format, m)) {
    return stage.qualifyingDoubleMode;
  }
  return def.match.doubleMode;
}

/** 予選の節の数 (= 決勝トーナメントの stage に当たるゲタ)。予選が無ければ 0 */
export function groupStageCount(matches: TournamentMatch[]): number {
  return matches.reduce((max, m) => (m.group === undefined ? max : Math.max(max, m.stage + 1)), 0);
}

/** 予選を全部消化したか。予選が無ければ false (「終わった」とは言えない) */
export function isGroupStageDone(matches: TournamentMatch[]): boolean {
  const group = matches.filter(m => m.group !== undefined);
  return group.length > 0 && group.every(m => m.status === 'done');
}

/**
 * 決勝進出者の確定待ちで、その試合をまだ準備できないか。
 *
 * 自動判定は順位表の位置から必ず枠を埋めるので、確認を挟まないと同点の枠を誰も見ないまま
 * 決勝が始まってしまう。バックエンドの armMatch もこの述語で弾く。
 */
export function blockedByQualifiers(
  format: TournamentFormat, match: TournamentMatch, qualifiersConfirmed: boolean,
): boolean {
  return hasQualifying(format) && isKnockoutMatch(format, match) && !qualifiersConfirmed;
}

// ── 運営が次に押すもの ────────────────────────────────────────────────────────

/**
 * 運営が今やること。状況に対して常に1つだけ定まる。
 *
 * 運営パネルはこれをそのまま1枚のカードに描く。自動進行 (autoPlay.ts) は
 * ServerManager の進行状況も見て代行するので入口が別だが、判定の土台は共有している。
 */
export type OperatorAction =
  /** 対戦が終わった。結果を確認して確定する */
  | { kind: 'confirm';             match: TournamentMatch }
  /** 割り当て済み。フッターの「ゲームスタート」を押す */
  | { kind: 'start';               match: TournamentMatch }
  /** 予選が終わった。決勝進出者を確定する */
  | { kind: 'confirm-qualifiers' }
  /** 次の試合を準備する */
  | { kind: 'arm';                 match: TournamentMatch }
  /** 次の試合の出場者にプログラムが割り当たっていない */
  | { kind: 'assign-programs';     match: TournamentMatch; participants: ResolvedParticipant[] }
  /** 全試合が終わった */
  | { kind: 'finished' }
  /** 運営の操作待ち (巻き戻した直後など)。理由をそのまま画面に出す */
  | { kind: 'idle';                reason: string };

export function nextOperatorAction(state: TournamentStatePayload): OperatorAction {
  const format = state.stage.format;

  // ① 確定待ちが最優先。ここを飛ばすと次の試合を準備してしまう
  const awaiting = state.matches.find(m => m.status === 'awaiting_confirm');
  if (awaiting) return { kind: 'confirm', match: awaiting };

  // ② 準備済みならその試合を始める
  const armed = state.matches.find(m => m.id === state.armedMatchId);
  if (armed) return { kind: 'start', match: armed };

  // ③ 予選が終わっていれば、決勝へ進む前に決勝進出者を確定する
  if (hasQualifying(format) && isGroupStageDone(state.matches) && !state.qualifiersConfirmed) {
    return { kind: 'confirm-qualifiers' };
  }

  // ④ 次の試合を準備する
  const next = nextReadyMatch(state.matches);
  if (next) {
    if (blockedByQualifiers(format, next, state.qualifiersConfirmed)) {
      return { kind: 'idle', reason: '決勝進出者を確定すると、決勝トーナメントの試合を準備できます' };
    }
    const missing = unassignedOf(state, next);
    if (missing.length > 0) return { kind: 'assign-programs', match: next, participants: missing };
    return { kind: 'arm', match: next };
  }

  // ⑤ 全試合が終わった
  if (state.matches.every(m => m.status === 'done')) return { kind: 'finished' };

  return { kind: 'idle', reason: '実施できる試合がありません' };
}

/** その試合の出場者のうち、まだプログラムが決まっていない人 */
export function unassignedOf(
  state: TournamentStatePayload, match: TournamentMatch,
): ResolvedParticipant[] {
  return [match.resolvedA, match.resolvedB]
    .map(id => state.participants.find(p => p.id === id))
    .filter((p): p is ResolvedParticipant =>
      p !== undefined && !p.builtinCpu && p.programCatalogId === null);
}

/** まだプログラムが決まっていない参加者 (運営BOT を含む) */
export function allUnassigned(state: TournamentStatePayload): ResolvedParticipant[] {
  return state.participants.filter(p => !p.builtinCpu && p.programCatalogId === null);
}

/**
 * 対戦画面が今出している試合が、予選 (BOT対戦、group を持つ) か決勝トーナメントかを表す。
 *
 * 交流大会ルールは予選と決勝で得点式が違う (koryuScoring.ts) ため、対戦画面
 * (PlayerSidePanel など) が得点の内訳をどちらの式で見せるかをこれで判定する。
 * armedMatchId から引けなければ (大会に紐付いていない単発対戦など) null。
 */
export function armedMatchOf(state: TournamentStatePayload): TournamentMatch | null {
  if (!state.armedMatchId) return null;
  return state.matches.find(m => m.id === state.armedMatchId) ?? null;
}
