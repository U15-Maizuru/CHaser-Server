import type {
  MatchRules, ResolvedParticipant, StageRules, TournamentFormat, TournamentMatch,
  TournamentStatePayload,
} from './tournament.js';
import {
  advancePerGroupOf, compareByPlayOrder, hasBotStage, hasBracket, hasQualifying,
  qualifierOverCount,
} from './tournament.js';

// 試合グラフから「今どうなっているか」を読み取る述語。
//
// バックエンドの進行管理・自動進行と、運営パネルの「今やること」が同じ規則で動くよう、
// 判定はすべてここに置く。状態を持たず、試合の配列だけを見る。

/**
 * 不戦の枠か (片側でも不在で、対戦が行われない/行われなかった)。
 *
 * **これは「試合」ではない。** 人数の都合で表の形を保つためだけに存在する枠なので、
 * 運営パネルの試合一覧・完了カウント・試合番号のいずれからも外す。
 * トーナメント表でもカードごと隠している (`MatchInfoCard` / `PlayerCard`)。
 *
 * 一方**結果CSVには残す** — あちらは記録なので「誰が不戦勝で上がったか」は要る。
 */
export function isByeMatch(m: TournamentMatch): boolean {
  return m.byeA || m.byeB;
}

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
  return nextReadyMatches(matches, 1)[0] ?? null;
}

export interface NextReadyOptions {
  /** 別のレーンが実行中の試合。候補から外す */
  busyIds?: ReadonlySet<string>;
  /** そのレーンで実施してよい試合か。省略すると全て可 */
  canRun?:  (m: TournamentMatch) => boolean;
}

/**
 * 次に実施すべき試合を、実施順に最大 count 件。**並列レーンへ配るための一般化。**
 *
 * 並べ方は `nextReadyMatch` と同じ (回戦順 → 消化試合数の少ない人がいるカード →
 * 実施順)。実施順の定義は `compareByPlayOrder` の1箇所だけ、という決まりを保つため、
 * ここも並べ替えを自前で書かずにそれを通す。
 *
 * **「同じ参加者が2レーンに同時に出ない」ようなフィルタは掛けていない。** 対戦プログラムは
 * 試合ごとに spawn される (ProcessClient) ので同じ人のプログラムが同時に何個動いても
 * 構わないうえ、BOT対戦予選は**全試合に同じ BOT が出る**ので、そのフィルタを足すと
 * 並列数が常に1になって機能そのものが消える。良かれと思って足さないこと。
 */
export function nextReadyMatches(
  matches: TournamentMatch[], count: number, opts: NextReadyOptions = {},
): TournamentMatch[] {
  const busyIds  = opts.busyIds ?? new Set<string>();
  const played   = playedCountOf(matches);
  const playedOf = (id: string | null) => (id === null ? 0 : played.get(id) ?? 0);
  /** そのカードで最も消化試合数が少ない人の消化数 */
  const behind = (m: TournamentMatch) => Math.min(playedOf(m.resolvedA), playedOf(m.resolvedB));

  return [...matches]
    // 不戦は「試合」ではないので案内しない。開始前 (startedAt が null) の大会では
    // まだ確定していないぶんが 'ready' で残るため、状態ではなく枠の形で弾く
    .filter(m => m.status === 'ready' && !isByeMatch(m) && !busyIds.has(m.id))
    .filter(m => opts.canRun?.(m) ?? true)
    .sort((a, b) => {
      if (a.stage !== b.stage) return a.stage - b.stage;
      const ba = behind(a), bb = behind(b);
      if (ba !== bb) return ba - bb;
      return compareByPlayOrder(a, b);
    })
    .slice(0, Math.max(0, count));
}

/**
 * その試合を副レーン (主レーン以外) で実施してよいか。
 *
 * **BOT対戦予選の予選試合だけ。** 全参加者が同一BOT・同一マップと1試合ずつ戦う形式なので
 * 試合の間に依存が無く、実施順にも意味が無い — 並列にしても測っている条件が変わらない、
 * というのが並列実行を許す唯一の根拠。決勝トーナメントは勝ち上がりの依存を持ち、
 * 観客が見る主戦場でもあるので、必ず主レーンで1試合ずつ行う。
 *
 * 予選リーグ (`group-then-bracket`) を含めていないのは、同じ節の中なら参加者は重ならない
 * ものの、リーグ表の見せ方 (どの試合を強調するか) が未検討なため。足すならそちらも一緒に。
 */
export function canRunInSideLane(format: TournamentFormat, m: TournamentMatch): boolean {
  return hasBotStage(format) && m.group !== undefined;
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
 * 総当たり (勝ち点 → 合計ポイント → 直接対決でランキングする) 試合か。
 *
 * `league` は常に対象、`group-then-bracket` は予選の試合 (group を持つ) だけが対象。
 * `bot-then-bracket` の予選は対象外 — 合計ポイントそのもので順位を付ける別形式で、
 * 「全参加者が同じマップ」は `validateBotStage` が定義の時点で必須にしている。
 *
 * この述語が true の試合は `canRunInSideLane` が false になる (BOT対戦予選しか
 * 副レーンに流れない) ので、リーグ単位でマップを1回だけ決めて使い回す処理に競合の
 * 心配は無い。
 */
export function isLeaguePointsMatch(format: TournamentFormat, m: TournamentMatch): boolean {
  return format === 'league' || (format === 'group-then-bracket' && m.group !== undefined);
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
  /**
   * 予選が終わった。決勝進出者を確定する。
   *
   * `over` は BOT対戦予選の確認リストが定員を何人超えているか (それ以外の形式は常に0)。
   * 0より大きい間は運営に確定を押させない — 削る手段は「進行」タブの確認リスト
   * (`BotQualifierSection`) にしか無いので、ここで無条件に確定できると
   * 同点のボーダーを1人も削らずに決勝トーナメントへ進めてしまう。
   */
  | { kind: 'confirm-qualifiers'; over: number }
  /** 次の試合を準備する */
  | { kind: 'arm';                 match: TournamentMatch }
  /** 次の試合の出場者にプログラムが割り当たっていない */
  | { kind: 'assign-programs';     match: TournamentMatch; participants: ResolvedParticipant[] }
  /** 全試合が終わった */
  | { kind: 'finished' }
  /** 運営の操作待ち (巻き戻した直後など)。理由をそのまま画面に出す */
  | { kind: 'idle';                reason: string };

/**
 * いずれかのレーンが抱えている試合 id。
 *
 * `armedMatchId` は主レーンのぶんしか指さないので、「今どれが走っているか」を
 * 知りたいところはこちらを使う。並列実行していなければ 0〜1個。
 */
export function armedLaneMatchIds(state: TournamentStatePayload): Set<string> {
  return new Set(
    state.lanes.map(l => l.armedMatchId).filter((id): id is string => id !== null),
  );
}

export function nextOperatorAction(state: TournamentStatePayload): OperatorAction {
  const format = state.stage.format;
  // 並列実行中は主レーンだけを見ても足りない。準備済みの判定も、次の試合の候補から
  // 外すのも、全レーンぶんで見る (レーンが1本なら、主レーンだけを見るのと同じ結果になる)
  const armedIds = armedLaneMatchIds(state);

  // ① 確定待ちが最優先。ここを飛ばすと次の試合を準備してしまう
  const awaiting = state.matches.find(m => m.status === 'awaiting_confirm');
  if (awaiting) return { kind: 'confirm', match: awaiting };

  // ② 準備済みならその試合を始める
  const armed = state.matches.find(m => armedIds.has(m.id));
  if (armed) return { kind: 'start', match: armed };

  // ③ 予選が終わっていれば、決勝へ進む前に決勝進出者を確定する
  if (hasQualifying(format) && isGroupStageDone(state.matches) && !state.qualifiersConfirmed) {
    const over = hasBotStage(format)
      ? qualifierOverCount(state.qualifierCandidates ?? [], advancePerGroupOf(state.stage))
      : 0;
    return { kind: 'confirm-qualifiers', over };
  }

  // ④ 次の試合を準備する (他のレーンが走らせている試合は候補から外す)
  const next = nextReadyMatches(state.matches, 1, { busyIds: armedIds })[0];
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
