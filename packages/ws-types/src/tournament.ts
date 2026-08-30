// 大会運営 (トーナメント / リーグ) の共有型。
//
// 用語 (docs/developer-manual.md §0 の対応表に従う):
//   ゲーム (round) = 1回の対戦             … RoundResult
//   試合   (set)   = 先後入替の2ゲーム     … SetResult / TournamentMatch
//   トーナメント/リーグ = 試合の連なり     … TournamentDefinition
//
// TournamentMatch の `match` は公式用語の「試合」を指し、既存の `set` と同じ粒度。
// ブラケット上のノードとして自然な語なのでこちらを使う。
// 回戦・節に `round` を使うと RoundResult.round (ゲーム番号 0|1) と同名で別軸になるため、
// `stage` という別名にしている。

import type { RoundResult } from './protocol.js';
import type { SetResult } from './scoring.js';

// --- 大会の定義 (tournament.json) ---

export type TournamentFormat =
  | 'single-elimination'
  | 'league'
  | 'group-then-bracket'
  | 'bot-then-bracket';

/**
 * 予選 (リーグ / BOT対戦) を持ち、決勝進出者の確定を挟む形式か。
 *
 * **「予選がある」を意味する判定はすべてこれ。** `format === 'league'` の三項演算子で
 * 分岐を書くと、新しい形式が黙ってトーナメント側に落ちて事故になる。
 * 予選リーグ固有のもの (星取表・リーグ数・所属リーグ) は
 * `format === 'group-then-bracket'` で直に分ける。
 */
export function hasQualifying(format: TournamentFormat): boolean {
  return format === 'group-then-bracket' || format === 'bot-then-bracket';
}

/** BOT対戦予選 (全員が同じ運営BOT・同じマップと戦う) を持つ形式か */
export function hasBotStage(format: TournamentFormat): boolean {
  return format === 'bot-then-bracket';
}

/** 勝ち上がりのトーナメント表を持つ形式か */
export function hasBracket(format: TournamentFormat): boolean {
  return format === 'single-elimination' || hasQualifying(format);
}

/**
 * BOT対戦予選の運営BOT に割り当てた予約 participantId。
 *
 * **`TournamentDefinition.participants` には含めない。** エントリー数・順位表・決勝
 * トーナメントから自動的に外すためで、代わりに `resolveParticipants` が配信ペイロードの
 * `participants` にだけ合成して足す。試合の slot はこの id を普通の participant として
 * 指すので、arm・表示・CSV 書き出しは BOT を意識せずに動く。
 */
export const BOT_PARTICIPANT_ID = '__bot__';

/** 全形式に共通する対戦の条件 */
export interface MatchRules {
  /** 1試合を先後入替の2ゲームで行うか (公式ルールの既定。false なら1ゲームで決着する) */
  doubleMode: boolean;
}

/** どのマップで戦うか。解決順は bracketStages[stage] → catalogId → 毎回ランダム生成 */
export interface MapPlan {
  /** 大会全体で使う固定マップのライブラリ ID */
  catalogId:     string | null;
  /**
   * 勝ち上がりの回戦ごとのマップ。null は catalogId に従う。
   * 3位決定戦は決勝と同じ回戦なので決勝と同じマップになる。
   *
   * **index は決勝トーナメント相対。** 予選の節ぶんのゲタを当てるのは
   * TournamentStore.resolveStageMaps の仕事で、作成 UI は決勝T の回戦しか出さない。
   */
  bracketStages: (string | null)[];
}

/** 総当たりの条件。予選リーグと単独リーグで共有する */
export interface LeagueRules {
  /** 勝ち点 (公式ルールは 勝利3 / 引き分け1 / 敗北0) */
  points:           LeaguePoints;
  /** 2回総当たりにするか */
  doubleRoundRobin: boolean;
}

export interface LeaguePoints {
  win:  number;
  draw: number;
  loss: number;
}

export const DEFAULT_LEAGUE_POINTS: LeaguePoints = { win: 3, draw: 1, loss: 0 };

/** BOT対戦予選の条件。全参加者が同じ BOT と同じマップで1試合ずつ戦う */
export interface BotStageRules {
  /** 運営が用意する BOT のプログラム。null は「未提出」で、当日 BOT_PARTICIPANT_ID へ紐付ける */
  program:         ParticipantProgram;
  /** BOT の表示名。省略時は「運営BOT」 */
  name:            string | null;
  /**
   * 予選専用のマップ。null なら MapPlan.catalogId を使う。
   * **全参加者が同じ条件で測られる形式の根拠**なので、どちらかは必ず要る (definition.ts が検証する)。
   */
  map:             string | null;
  /**
   * 参加者が第1ゲームでどちら側に座るか (0 = 先攻 / 1 = 後攻)。
   *
   * 参加者ごとではなく**大会全体で1つ** — 全員が同一条件で戦うのがこの形式の要点。
   * 予選が2ゲーム制 (qualifyingDoubleMode) のときは先後が入れ替わるため意味を持たない。
   */
  participantSide: 0 | 1;
}

/**
 * 大会の進め方。**形式ごとに持つ設定そのものが違う**ので判別共用体にしてある。
 *
 * 平坦な1つの設定袋にすると「この項目はこの形式のときだけ意味がある」という約束が
 * コメントにしか無くなり、形式を増やすたびに読み手が全項目を照合する羽目になる。
 */
export type StageRules =
  | {
      format:          'single-elimination';
      map:             MapPlan;
      thirdPlaceMatch: boolean;
    }
  | {
      format: 'league';
      map:    MapPlan;
      league: LeagueRules;
    }
  | {
      format:          'group-then-bracket';
      map:             MapPlan;
      thirdPlaceMatch: boolean;
      league:          LeagueRules;
      /** 予選リーグの数 */
      groupCount:      number;
      /** 各リーグから決勝トーナメントへ上がる人数 (合計 groupCount × これ) */
      advancePerGroup: number;
      /**
       * 予選を先後入替の2ゲームで行うか。決勝トーナメントは MatchRules.doubleMode に従う。
       * 予選と決勝で負荷や所要時間の事情が違う (予選は数をこなす・決勝は1本ずつ丁寧に) ため、
       * 別々に選べるようにしてある。
       */
      qualifyingDoubleMode: boolean;
      /**
       * 複数の予選リーグをどう進行させるか。
       *
       * `parallel` (既定) は今までの挙動 — 全リーグが節ごとに横並びで進む
       * (全リーグの第1節 → 全リーグの第2節 → …)。`sequential` は1リーグずつ
       * 最後まで終わらせてから次のリーグへ進む。特定のリーグの参加者だけが
       * 先に試合をこなせてしまう偏りを避けたいときは既定の `parallel` を使う。
       */
      groupScheduleMode: 'parallel' | 'sequential';
    }
  | {
      format:          'bot-then-bracket';
      map:             MapPlan;
      thirdPlaceMatch: boolean;
      bot:             BotStageRules;
      /** 決勝トーナメントの出場人数 (予選が1グループなのでこれがそのまま総数) */
      advanceCount:    number;
      /** 予選 (BOT対戦) を先後入替の2ゲームで行うか。決勝トーナメントは MatchRules.doubleMode に従う */
      qualifyingDoubleMode: boolean;
    };

/** 3位決定戦を行うか。リーグは勝ち上がりが無いので常に false */
export function hasThirdPlaceMatch(stage: StageRules): boolean {
  return stage.format !== 'league' && stage.thirdPlaceMatch;
}

/** 総当たりの条件。持たない形式では null */
export function leagueRulesOf(stage: StageRules): LeagueRules | null {
  return stage.format === 'league' || stage.format === 'group-then-bracket' ? stage.league : null;
}

/** BOT対戦予選の条件。持たない形式では null */
export function botRulesOf(stage: StageRules): BotStageRules | null {
  return stage.format === 'bot-then-bracket' ? stage.bot : null;
}

/**
 * 予選1グループあたりの決勝トーナメント進出人数。予選を持たない形式では 0。
 *
 * BOT対戦予選は1グループなので、advanceCount がそのままこの値になる。
 */
export function advancePerGroupOf(stage: StageRules): number {
  if (stage.format === 'group-then-bracket') return stage.advancePerGroup;
  if (stage.format === 'bot-then-bracket')   return stage.advanceCount;
  return 0;
}

/** 参加プログラムの指定方法。null は「未提出」(当日 tournament_assign_program で紐付ける) */
export type ParticipantProgram =
  | { kind: 'file';    file: string; displayName?: string }
  | { kind: 'builtin'; builtin: 'cpu' }
  | null;

export interface ParticipantDef {
  id:      string;
  name:    string;
  /** 組み合わせ表の選手番号。小さいほど第1ゲームで先攻になる。省略時は記載順 */
  seed?:   number;
  /** group-then-bracket のみ: 所属する予選リーグ (0始まり)。省略時は autoGroupAssign で振り分ける */
  group?:  number;
  program: ParticipantProgram;
}

export interface TournamentDefinition {
  formatVersion: number;
  id:            string;
  name:          string;
  match:         MatchRules;
  stage:         StageRules;
  participants:  ParticipantDef[];
  /** 明示的な1回戦の並び。長さは2の冪、null は bye。省略時はシード順から自動生成 */
  bracket?:      { size: number; slots: (string | null)[] };
  /** 明示的な対戦カード。省略時は総当たりを自動生成 */
  schedule?:     { pairs: [string, string][] };
}

// --- 組み合わせの配置 (純関数) ---
//
// 試合グラフの組み立て本体は apps/backend/src/tournament/bracket.ts にあるが、
// 「1回戦をどう並べるか」の規則だけはここに置いて frontend と共有する。
// 大会データ作成 UI の組み合わせ編集が、サーバーが自動生成するのと寸分違わぬ並びを
// 初期値として見せる必要があるため (二重定義するとズレて必ず事故になる)。

/**
 * 標準シード順の位置並び。order(1)=[1], order(2n)=interleave(order(n), 2n+1-order(n))。
 * size=8 なら [1,8,4,5,2,7,3,6] — 第1シードと第2シードが決勝まで当たらない配置になる。
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, n + 1 - s);
    order = next;
  }
  return order;
}

/** カードの順だけを反転する。カードの中 (先攻・後攻) は動かさない */
function reverseCards<T>(slots: T[]): T[] {
  const out: T[] = [];
  for (let i = slots.length - 2; i >= 0; i -= 2) out.push(slots[i]!, slots[i + 1]!);
  return out;
}

/**
 * 1回戦の並びを、中央収束型のトーナメント表に描くとおりの順 (どのブロックも上から下) に直す。
 *
 * **向かい合うブロック同士は線対称ではなく点対称** (180°回転)。第1シードが左上なら
 * 第2シードは右上ではなく右下に来る。**これは最上位の左右だけでなく、その下の
 * サブブロック同士にも再帰的に効く** — 各ブロックの中でも、上のサブブロックは
 * 一番強いシードが上に、下のサブブロックは一番強いシードが下に来る。
 *
 * `seedOrder` が返すのは線対称の並びなので、各ブロックの下半分のカードの順を
 * 再帰的に反転する。反転はそのブロックの中の鏡像でしかないので、
 * **誰と誰が当たるかは一切変わらない** (カードの対 (0,1)(2,3)… は反転しても同じ
 * 組み合わせのまま入れ替わるだけ)。動くのは表の中での位置と試合番号だけ。
 *
 * これを通したあとの配列は「表の上から下」そのものなので、バランス取り
 * (`balanceBracketHalves`) はどのブロックでも「配列の前半 = 表示上の上」として
 * 同じ規則で書ける。
 */
export function pointSymmetricBracketOrder<T>(slots: T[]): T[] {
  const half = slots.length / 2;
  // 2枠 = 1カード。回転しても自分自身なので、ここで止める
  if (slots.length < 4 || !Number.isInteger(half)) return slots;
  const upper = pointSymmetricBracketOrder(slots.slice(0, half));
  const lower = pointSymmetricBracketOrder(slots.slice(half));
  return [...upper, ...reverseCards(lower)];
}

/**
 * 1回戦の並びのバランスを取る。**ブロックごとに再帰的に**、実参加者が少ないほうを
 * 後ろへ回す。`pointSymmetricBracketOrder` を通した並びでは配列の順 = 表の上から下
 * なので、「後ろ」は表の右山・同じ山の中なら下にあたる。
 *
 * 標準シード順は bye を上位シードの対面へ入れるため、bye の数によっては表の左半分だけが
 * 1人少なくなる (7人なら 左3/右4、3人なら 左1/右2)。表は左山から順に実施するので、
 * 空いているほうを先に消化する形になって見た目にも進行にも締まりがない。同じことが
 * 山の中の小ブロックでも起きるので、最上位だけでなく各階層で揃える。
 *
 * 入れ替えは**そのブロック内の鏡像**なので、誰と誰が当たるかは一切変わらない。
 * シード配置の性質 (第1シードと第2シードが決勝まで当たらない、bye は上位シードから得る) は
 * 完全に保たれ、上の階層から見た人数も変わらない — 動くのは表の中での位置と試合番号だけ。
 *
 * **運営が手で組んだ並び (`TournamentDefinition.bracket.slots`) には適用しないこと** —
 * 実行委員会が決めた組み合わせを勝手に鏡像にすることになる。
 */
export function balanceBracketHalves<T>(slots: T[], isEmpty: (slot: T) => boolean): T[] {
  const half = slots.length / 2;
  // 2枠 = 1カード。この中の入れ替えは先攻・後攻の話なのでここでは触らない
  if (slots.length < 4 || !Number.isInteger(half)) return slots;

  // 先に各ブロックの中を整える。中を鏡像にしても人数は変わらないので、
  // このブロックの左右判定は後から行っても結果は同じ
  const left  = balanceBracketHalves(slots.slice(0, half), isEmpty);
  const right = balanceBracketHalves(slots.slice(half), isEmpty);

  const filled = (list: T[]) => list.filter(s => !isEmpty(s)).length;
  return filled(left) < filled(right) ? [...right, ...left] : [...left, ...right];
}

/** 参加者数を収める最小の2の冪。これにより bye 同士のカードが構造的に発生しない */
export function bracketSizeFor(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return Math.max(size, 1);
}

/** 回戦の数 (= 決勝までの stage 数)。size=8 なら 3 (1回戦・準決勝・決勝) */
export function stageCountFor(participantCount: number): number {
  const size = bracketSizeFor(participantCount);
  return size < 2 ? 0 : Math.log2(size);
}

/**
 * 回戦の名前。後ろから数えて決勝・準決勝・準々決勝、それ以前は「N回戦」。
 *
 * 試合グラフの組み立て (backend/tournament/bracket.ts) と、大会データ作成 UI の
 * 「回戦ごとのマップ」欄が同じ名前を出す必要があるのでここに置く。
 */
export function stageLabel(stage: number, totalStages: number): string {
  const fromLast = totalStages - 1 - stage;
  if (fromLast === 0) return '決勝';
  if (fromLast === 1) return '準決勝';
  if (fromLast === 2) return '準々決勝';
  return `${stage + 1}回戦`;
}

// --- 予選リーグの振り分け (純関数) ---
//
// seedOrder と同じ理由でここに置く。大会データ作成 UI が「自動で振り分け直す」で見せる並びは、
// サーバーが tournament.json の group 省略時に作るのと寸分違わぬものでなければならない。

/** 予選リーグの名前。0 → 'A', 1 → 'B' … 26個を超えたら 'AA' のように桁を増やす */
export function groupLabel(group: number): string {
  let n = Math.max(0, Math.trunc(group));
  let s = '';
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) return s;
  }
}

/**
 * 選手番号順に蛇行 (snake) 配分する。返り値の index = 選手番号-1、値 = リーグ番号。
 *
 * 4人2リーグなら [A, B, B, A] — 端から順に折り返すことで、強い順に並んでいる名簿を
 * そのまま流し込んでも上位がどちらか一方のリーグへ偏らない。
 *
 * **人数が割り切れないときは前のリーグを多くする。** 蛇行の順番だけで決めると
 * 5人3リーグで [A,B,C,C,B] = 1人/2人/2人 のように後ろが多くなることがあるため、
 * 先に各リーグの定員 (前から順に1人ずつ多く配る) を決めておき、蛇行で当たった
 * リーグが定員に達していたら、まだ空きのある一番前のリーグへ回す。
 */
export function autoGroupAssign(count: number, groupCount: number): number[] {
  const g = Math.max(1, Math.trunc(groupCount));
  const n = Math.max(0, count);

  // 定員: 余りは前のリーグから1人ずつ
  const capacity = Array.from({ length: g }, (_, k) =>
    Math.floor(n / g) + (k < n % g ? 1 : 0));
  const filled = new Array<number>(g).fill(0);

  return Array.from({ length: n }, (_, i) => {
    const cycle = Math.floor(i / g);
    const pos   = i % g;
    const snake = cycle % 2 === 0 ? pos : g - 1 - pos;

    const target = filled[snake]! < capacity[snake]!
      ? snake
      : filled.findIndex((c, k) => c < capacity[k]!);
    filled[target]!++;
    return target;
  });
}

// --- 試合グラフ ---

export type MatchSlotRef =
  | { kind: 'participant'; participantId: string }
  | { kind: 'winner-of';   matchId: string }
  | { kind: 'loser-of';    matchId: string }   // 3位決定戦
  | { kind: 'group-rank';  group: number; rank: number }   // 予選リーグの N 位 (1始まり)
  | { kind: 'bye' };

/**
 * まだ相手が決まっていない枠の表示名 (「Aリーグ 1位」)。
 * 決まりようのある枠 (participant / winner-of など) は null を返す。
 *
 * BOT対戦予選は1グループしかないので「Aリーグ」と名乗る意味が無い。format を渡せば
 * 「予選 1位」になる (省略するとリーグ名を付ける)。
 */
export function slotPlaceholder(ref: MatchSlotRef, format?: TournamentFormat): string | null {
  if (ref.kind !== 'group-rank') return null;
  return format !== undefined && hasBotStage(format)
    ? `予選 ${ref.rank}位`
    : `${groupLabel(ref.group)}リーグ ${ref.rank}位`;
}

export type MatchStatus =
  | 'pending'           // 対戦相手がまだ確定していない
  | 'ready'             // 両者確定。arm できる
  | 'armed'             // スロットへ割り当て済み。運営が「ゲームスタート」を押すのを待っている
  | 'in_progress'       // 対戦中
  | 'awaiting_confirm'  // 全ゲーム終了。運営の確定待ち
  | 'done';             // 確定済み

/** 試合の決着理由。SetResult['decidedBy'] を包含し、運営裁定ぶんを足した別 union */
export type MatchDecidedBy = 'wins' | 'points' | 'walkover' | 'manual';

export interface TournamentMatchResult {
  /** 実施したゲーム (1 or 2)。既存のゲーム結果型をそのまま持つ */
  roundResults: RoundResult[];
  /** computeSetResult() の戻りを丸ごと保持する (改変しない) */
  set:          SetResult | null;
  decidedBy:    MatchDecidedBy;
  /** 勝者の side。両者棄権なら null */
  winnerSide:   0 | 1 | null;
  /** 手動決着の理由 (審判裁定 / 抽選 など) */
  note?:        string;
  /** 全ゲーム終了を検知した時刻 */
  capturedAt:   number;
  /** 運営が確定した時刻 */
  confirmedAt?: number;
}

export interface TournamentMatch {
  id:        string;   // 'R1M1' / 'SF1' / 'FINAL' / 'THIRD' / 'L-D1M2' / 'G1-D1M2'
  stage:     number;   // トーナメント: 回戦 (0始まり)  リーグ: 節 (0始まり)
  label:     string;   // '1回戦 第1試合' / '準決勝' / '3位決定戦' / '第2節 第1試合'
  order:     number;   // 同一 stage 内の表示順 (表の上から下)
  /**
   * 試合番号 (1始まり)。**表示順 (`order`) とは別物。**
   *
   * 決勝トーナメントでは「そのカードの**弱いほうの選手**が弱い順」に振る
   * (8人なら 第1試合=1位-8位、第2試合=2位-7位、…、第4試合=4位-5位)。
   * 実施はこの番号の昇順 = 最も弱い選手を含むカードから。3位決定戦が決勝より先に
   * なるのも、3位決定戦のほうが弱い選手を含むことから自動的に決まる。
   *
   * **ただし「大会開始時に両者が決まっているカード」が先。** 不戦で上がった者どうしの
   * カードと、下の回戦の勝者を待つカードが同じ段に混ざるとき (bye は1回戦にしか無いので
   * 実質2回戦だけ) は前者から番号を振る — そうしないと直前に戦った選手が連戦になる。
   * 番号の付け方は bracket.ts の `matchNumbers` に1箇所だけ置いてある。
   *
   * 省略時は `order + 1` (予選リーグなど、表を持たない形式)。
   */
  no?:       number;
  /**
   * 予選の試合だけが持つ予選グループ番号 (0始まり)。
   * 決勝トーナメントの試合と、予選を持たない形式の試合は undefined。
   *
   * 「その試合がどの順位表に効くか」「group-rank 参照がどの試合に依存するか」
   * 「同点を引き分けのまま確定してよいか」の3つがこの1つで決まる。
   *
   * **bot-then-bracket も group を持つ (常に 0)。** BOT対戦予選を「1グループの予選」として
   * 既存の予選機構 (group-rank / stage のゲタ / 巻き戻しの依存追跡) にそのまま乗せるため。
   */
  group?:    number;
  slotA:     MatchSlotRef;   // side 0 (第1ゲームの COOL = 先攻)
  slotB:     MatchSlotRef;   // side 1 (第1ゲームの HOT  = 後攻)
  resolvedA: string | null;  // 確定した participantId。bye/未確定なら null
  resolvedB: string | null;
  byeA:      boolean;
  byeB:      boolean;
  status:    MatchStatus;
  result?:   TournamentMatchResult;
  /** 同点再試合で運営が選び直したマップ。次の arm で loadMap する */
  rematchMapCatalogId?: string;
  /**
   * 同点によるやり直しで、まだ再試合が行われていない。
   *
   * discardResult が同点の結果を捨てたときだけ立ち、次の captureResult (対戦成立) か
   * clearFrom (別の巻き戻し) で消える。`status` は他の未実施の試合と同じ 'ready' に
   * 戻ってしまうため、これが無いと「同点で再試合になった」ことが表からもう分からない。
   */
  rematchPending?: boolean;
}

/**
 * 敗者同士の試合 (3位決定戦)。
 *
 * 勝者戦 (決勝) と同じ stage に置かれるが、参照するのは前の stage の敗者なので
 * 依存関係は無く、どちらを先に実施してもよい。実施順は compareByPlayOrder が決める
 * (通常は試合番号で決まり、`no` を持たない形式でだけこの述語が効く)。
 */
export function isConsolationMatch(m: TournamentMatch): boolean {
  return m.slotA.kind === 'loser-of' || m.slotB.kind === 'loser-of';
}

/**
 * **実施順の唯一の定義。** stage → 試合番号 (`no`) の昇順。
 *
 * `no` は「そのカードの弱いほうの選手が弱い順」に振ってある (`bracket.ts` の
 * `matchNumbers`)。**3位決定戦が決勝より先に実施される**のもここで決まる —
 * 3位決定戦のほうが弱い選手を含むので `no` が小さい (THIRD は 0)。
 *
 * **`order` を使わないこと。** それは「同一 stage 内の表示順」で、トーナメント表の
 * 縦の並び (決勝が上・3位決定戦が下) を決めるもの。実施順と表示順は別物。
 *
 * 試合一覧 (運営パネル)・結果CSV・次の試合の選定 (`nextReadyMatch`) は
 * すべてこれを通すこと。**別々に並べ替えを書くと必ずズレる。**
 *
 * `no` を持たない試合 (予選リーグなど、表を持たない形式) は従来どおり
 * 「敗者戦が先 → order の昇順」に落とす。
 */
export function compareByPlayOrder(a: TournamentMatch, b: TournamentMatch): number {
  if (a.stage !== b.stage) return a.stage - b.stage;
  if (a.no !== undefined && b.no !== undefined) return a.no - b.no;
  const ca = isConsolationMatch(a) ? 0 : 1;
  const cb = isConsolationMatch(b) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  return a.order - b.order;
}

// --- 配信ペイロード ---

export interface ResolvedParticipant {
  id:                string;
  name:              string;
  seed:              number;
  /** プログラムライブラリのエントリ ID。未提出なら null */
  programCatalogId:  string | null;
  /** 内蔵 CPU を使う参加者 */
  builtinCpu:        boolean;
  /** 表示用のプログラム名 */
  programName:       string | null;
  /**
   * 運営BOT (bot-then-bracket)。エントリーではないので、順位表・エントリー一覧からは外すこと。
   * 配信ペイロードの participants にだけ現れる。
   */
  isBot?:            boolean;
}

export interface StandingRow {
  participantId: string;
  played:        number;
  wins:          number;
  draws:         number;
  losses:        number;
  /** 勝ち点 (leaguePoints による) */
  points:        number;
  /** 全試合の合計ポイント (競技ルールの「ポイント」) */
  totalPoints:   number;
  /** totalPoints の内訳: アイテムポイント (獲得アイテム数×10) */
  itemPoints:    number;
  /** totalPoints の内訳: 一撃ボーナス */
  strikePoints:  number;
  /** totalPoints の内訳: 総取りボーナス */
  sweepPoints:   number;
  rank:          number;
  /** タイブレークを尽くしても並び、同順位になった */
  tied:          boolean;
}

/**
 * 観戦画面に何を出すか (予選のある形式のみ)。
 *
 * `'auto'` は進行に追従する。運営が明示的に選んだときだけ固定され、
 * **運営席の画面 (?mode=tournament) の表示とは連動しない** —
 * 観客には見せずに手元だけで先の表を確認したい場面があるため。
 */
export type TournamentDisplayView = 'auto' | 'groups' | 'bracket';

/**
 * オートプレイ (自動進行) の状態。
 *
 * 運営が押していた「この試合を準備」→「ゲームスタート」→「結果を確定」を
 * バックエンドが順に代行する。**画面が切り替わるたびに数秒ずつ間を置く** —
 * 無人の展示で観客が結果を目で追えるようにするための機能なので、
 * 間を詰めると意味が無くなる (待機時間は AUTO_PLAY_DELAYS_MS)。
 */
export interface TournamentAutoPlay {
  enabled: boolean;
  /** 全試合が終わったら進行状態を作り直して繰り返す (デモモード) */
  loop:    boolean;
  /**
   * 自動進行が止まった理由。動いている間は null。
   *
   * 完走したとき (loop でない) と、運営の判断が要るとき (勝ち上がりの同点など) の
   * 両方で入る。**自動では決められないことを黙って決めない**ための出口。
   */
  stoppedReason: string | null;
}

/** 予選グループ1つぶんの順位表。bot-then-bracket では全参加者が入った1つだけ */
export interface GroupStanding {
  group:          number;
  /** 'A' / 'B' … */
  label:          string;
  /**
   * このリーグの参加者 (エントリー順 = 選手番号順)。
   * 星取表の行・列はこの並びで固定する — 順位順に並べ替えると試合のたびに行が動く。
   */
  participantIds: string[];
  /** 順位順 */
  standings:      StandingRow[];
}

/**
 * 決勝トーナメントの1枠。「Aリーグ1位」に誰が入るか。
 *
 * 自動判定 (auto) は順位表の位置から必ず決定的に埋まるので、決勝が詰まることはない。
 * 同点で怪しいところには tied / ambiguous の印を立て、運営が manual で差し替えられる。
 */
export interface QualifierSlot {
  group:  number;
  /** 1始まり。順位表の「位置」であって StandingRow.rank (同着で飛ぶ) とは別物 */
  rank:   number;
  /** 順位表から機械的に決めた人。予選が終わっていなければ null */
  autoParticipantId:   string | null;
  /** 運営が差し替えた人。差し替えていなければ null */
  manualParticipantId: string | null;
  /** 実際にこの枠へ入る人 (manual ?? auto) */
  participantId:       string | null;
  /** 順位表でこの順位が同着 */
  tied:      boolean;
  /** 同着が「上がる / 上がらない」の境目をまたいでいる = 運営が決めるべき */
  ambiguous: boolean;
  /** 予選がまだ終わっていない */
  pending:   boolean;
  /** 参加者が足りずこの枠が不戦になる */
  bye:       boolean;
}

/**
 * 決勝進出者の最終決定確認リストの1行 (予選のある形式)。
 *
 * 順位表の上位 `advancePerGroup` 人に、**その最下位と同順位で並んだ人を全員足した**もの。
 * 運営はここから `excluded` を立てて人数を合わせる — 「自動判定を差し替える」(QualifierSlot)
 * より、「多めに出して削る」方が同点の処理として直感的なので、BOT対戦予選ではこちらを使う。
 */
export interface QualifierCandidate {
  participantId: string;
  /** 順位表の順位 (同着で飛ぶ) */
  rank:         number;
  totalPoints:  number;
  /** 同点がどこで割れた/割れなかったのかを運営がその場で読めるよう内訳も配る */
  strikePoints: number;
  itemPoints:   number;
  /** 運営が確認リストから削除した。取り消せるよう、行自体はリストに残る */
  excluded:     boolean;
  /** 通過ラインと並び、タイブレークでも決着しなかった = 運営が決めるべき */
  onBorder:     boolean;
}

export interface TournamentSummary {
  id:           string;
  name:         string;
  format:       TournamentFormat;
  participants: number;
  /** 確定済みの試合数 / 全試合数 */
  progress:     [number, number];
  /** 現在どの部屋で運営中か */
  boundRoomId:  string | null;
}

export interface TournamentStatePayload {
  tournamentId: string;
  name:         string;
  match:        MatchRules;
  stage:        StageRules;
  participants: ResolvedParticipant[];
  matches:      TournamentMatch[];
  /** league のときのみ。予選リーグの順位は groups[].standings 側に入る */
  standings:    StandingRow[] | null;
  /**
   * 予選のある形式のときのみ: 予選グループごとの順位表。
   * bot-then-bracket では要素1つ (全参加者が入った単一グループ)。
   */
  groups:       GroupStanding[] | null;
  /** 予選のある形式のときのみ: 決勝トーナメントの枠と、そこに入る人 */
  qualifiers:   QualifierSlot[] | null;
  /**
   * 予選のある形式のときのみ: 決勝進出者の最終決定確認リスト。
   * 予選が終わるまでは空配列 (順位が決まらないので候補を出しようがない)。
   */
  qualifierCandidates: QualifierCandidate[] | null;
  /**
   * 決勝進出者を運営が確定したか (予選のある形式のみ)。
   *
   * 予選が終わっても自動では決勝へ進まず、ここが true になるまで観戦画面は
   * 予選の最終結果を出し続ける。**予選が終わっていない間は必ず false** なので、
   * 予選の試合を取り消せば確定も自動で外れる。
   */
  qualifiersConfirmed: boolean;
  /** 観戦画面に出すもの (運営が指定。既定は進行に追従する 'auto') */
  displayView:  TournamentDisplayView;
  /** 自動進行 (オートプレイ / デモモード) の状態 */
  autoPlay:     TournamentAutoPlay;
  /**
   * 回戦ごとの実効マップ。定義の MapPlan.bracketStages に運営中の差し替えを重ねた結果で、
   * null は「MapPlan.catalogId に従う」。UI 側で解決順を再現しなくてよい。
   *
   * **index は予選と決勝を通した stage 番号。** MapPlan.bracketStages が決勝T相対なのと違う。
   */
  stageMaps:    (string | null)[];
  /**
   * 3位決定戦の実効マップ。3位決定戦を持たない大会では null。
   *
   * 決勝と同じ stage を共有するため stageMaps だけでは書き分けられない — 個別に
   * 差し替えていなければ、決勝と同じ (= 対応する stageMaps の値) になる。
   */
  thirdPlaceMapId: string | null;
  /**
   * stage ごとの表示名 (index = stage)。「予選 第1節」「準決勝」など。
   * 節数の算出を frontend に二重定義しないよう、backend が試合グラフから組み立てて配る。
   */
  stageLabels:  string[];
  armedMatchId: string | null;
  boundRoomId:  string;
  updatedAt:    number;
}

/**
 * 運営が当日その場で下した判断。
 *
 * **配布物である tournament.json ではなく state.json 側に持つ。** マップ・プログラムの
 * catalogId はこの PC のライブラリでしか通じず、進出者の差し替えは進行に紐づくため。
 */
export interface OperatorDecisions {
  /** 差し替えた回戦ごとのマップ (キーは予選込みの通し stage の10進表記) */
  stageMaps:           Record<string, string | null>;
  /**
   * 差し替えた試合ごとのマップ (キーは matchId)。3位決定戦は決勝と同じ stage を共有するため
   * stageMaps だけでは両者を書き分けられない — 個別に別マップを指定したいときはこちらに置く。
   * 未指定 (キーなし) は「同じ stage のマップに従う」。
   */
  matchMaps:           Record<string, string>;
  /** 差し替えた決勝進出者 (キーは `"<group>:<rank>"`)。自動判定より優先する */
  qualifiers:          Record<string, string | null>;
  /** 最終決定確認リストから削除した参加者。この人たちを除いた並びで進出者を決める */
  exclusions:          string[];
  /**
   * 「この決勝進出者で決勝を始める」と確定したか。
   *
   * 予選が終わっていない状態では意味を持たない (payload では常に false に倒す) ので、
   * 巻き戻しのたびにこのフラグを消して回る必要はない。
   */
  qualifiersConfirmed: boolean;
}

export const NO_OPERATOR_DECISIONS: OperatorDecisions = {
  stageMaps: {}, matchMaps: {}, qualifiers: {}, exclusions: [], qualifiersConfirmed: false,
};

/** 永続化される進行状態 (server/tournament/<id>/state.json) */
export interface TournamentState {
  tournamentId: string;
  matches:      TournamentMatch[];
  /** participantId → プログラムライブラリのエントリ */
  programs:     Record<string, { catalogId: string; sha256: string } | undefined>;
  decisions:    OperatorDecisions;
  updatedAt:    number;
}
