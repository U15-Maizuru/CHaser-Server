import type {
  MatchRules, ResolvedParticipant, StageRules, TournamentFormat, TournamentMatch,
  TournamentStatePayload,
} from './tournament.js';
import { compareByPlayOrder, hasBracket, hasQualifying } from './tournament.js';

// 試合グラフから「今どうなっているか」を読み取る述語。
//
// バックエンドの進行管理・自動進行と、運営パネルの「今やること」が同じ規則で動くよう、
// 判定はすべてここに置く。状態を持たず、試合の配列だけを見る。

/**
 * 各参加者が**実際に対戦した**試合数。不戦勝 (bye・運営裁定) は数えない。
 *
 * 「消化試合数の少ない人がいるカードを先に」の材料 (`nextReadyMatch`)。
 */
export function playedCountOf(matches: TournamentMatch[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.status !== 'done' || !m.result || m.result.decidedBy === 'walkover') continue;
    for (const id of [m.resolvedA, m.resolvedB]) {
      if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * 次に実施すべき試合。
 *
 * 1. **回戦順** — 表は下の段から
 * 2. **消化試合数の少ない人がいるカードを先に** — カードの2人のうち少ないほう (`min`) で比較
 * 3. **実施順 (`compareByPlayOrder`) — 試合番号の昇順**
 *
 * 3 は `compareByPlayOrder` に委ねる — 実施順の定義はそこ1箇所だけに置く。
 * 試合番号は「そのカードの**弱いほうの選手**が弱い順」なので、最も弱い選手を含む
 * カードから順に消化することになる (8人なら 1位-8位 → 2位-7位 → 3位-6位 → 4位-5位)。
 * 3位決定戦が決勝より先になるのも同じ規則から出る。
 *
 * **「大会開始時に両者が決まっているカードを先に」も番号の側に入っている** —
 * `nextReadyMatch` に鍵を足していないのはそのため。2 は `min` なので、勝ち上がり待ちの
 * カード (片方が 0 試合、もう片方が 1 試合) と開始時確定のカード (両方 0 試合) は
 * どちらも 0 で並び、決着は 3 に落ちる。
 *
 * 番号は表示位置 (`order`) とは別物なので、**進行は表の上から順とは限らない。**
 *
 * **2 を 3 に任せることはできない。** 番号は「シード上位が勝ち上がる」前提で振ってあり、
 * 実際の消化試合数の偏りとは別の軸。14人の準々決勝は上から 4人/3人/4人/3人 の
 * ブロックになるので、番号だけで決めると遅れている人を追い越す。
 *
 * 予選 (`group` を持つ試合) は `no` を持たないので、組んだ順のまま。
 *
 * **消化試合数の差を1以内に収める規則ではない** — bye がある限り差2は構造的に起きる
 * (差の上界 = 初期位置の差 + 1)。
 */
export function nextReadyMatch(matches: TournamentMatch[]): TournamentMatch | null {
  const played = playedCountOf(matches);
  const playedOf = (id: string | null) => (id === null ? 0 : played.get(id) ?? 0);
  /** そのカードで最も消化試合数が少ない人の消化数 */
  const behind = (m: TournamentMatch) => Math.min(playedOf(m.resolvedA), playedOf(m.resolvedB));

  return [...matches]
    .filter(m => m.status === 'ready')
    .sort((a, b) => {
      if (a.stage !== b.stage) return a.stage - b.stage;
      const ba = behind(a), bb = behind(b);
      if (ba !== bb) return ba - bb;
      return compareByPlayOrder(a, b);
    })[0] ?? null;
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
