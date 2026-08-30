import { createHash } from 'node:crypto';
import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import {
  balanceBracketHalves, bracketSizeFor, pointSymmetricBracketOrder, seedOrder, stageLabel,
} from '@u15/ws-types';

// トーナメント (勝ち上がり) の試合グラフを組み立てる純関数。
// 結果の反映・slot の解決は progress.ts が行う。ここは構造だけを作る。
//
// 1回戦の並べ方 (seedOrder / bracketSizeFor) と回戦名 (stageLabel) は、大会データ作成 UI が
// 同じ並びを初期値として見せる必要があるので @u15/ws-types にある。

/**
 * 参加者を「選手番号」順に並べる。
 *
 * 競技ルールの「組み合わせ表で割り当てられた選手番号」に相当し、返り値の index 0 が第1シード。
 * seed 指定者が先 (昇順)、未指定者は記載順で後ろに続く。seed が飛び番でも (1,5 など)
 * 順序関係だけを使うので破綻しない。
 */
export function orderBySeed(participants: ParticipantDef[]): ParticipantDef[] {
  return participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sa = a.p.seed ?? Number.POSITIVE_INFINITY;
      const sb = b.p.seed ?? Number.POSITIVE_INFINITY;
      return sa !== sb ? sa - sb : a.i - b.i;
    })
    .map(x => x.p);
}

// ── 想定出場者と試合番号 ──────────────────────────────────────────────────

/** シードが分からない枠 (bye)。比較上は最も下位に置く */
const NO_SEED = Number.POSITIVE_INFINITY;

/**
 * 予選の順位を選手番号に見立てるときの桁。`(順位, リーグ番号)` の辞書順を1つの数にする。
 * groupStage が決勝トーナメントのシードを (順位昇順, リーグ番号昇順) で並べるのと同じ順序。
 */
const GROUP_RANK_SPAN = 1000;

/** 「どの対戦でもシード上位が勝ち上がる」と仮定したときの、その枠に入る選手の選手番号 */
type ChalkPair = readonly [best: number, worst: number];

/** そのカードは不戦か (片側でも欠けていれば対戦は行われない) */
function isWalkover(c: ChalkPair): boolean {
  return c[1] === NO_SEED;
}

/**
 * 1つの段の1カードぶんの材料。**配列の index = 表示位置 (`order`)。**
 *
 * 試合番号と id はここから `buildStage` が決めるので、段を組む側は
 * 「誰と誰が当たるか」だけを用意すればよい。
 */
interface StageCard {
  /** 想定出場者 (どの対戦でもシード上位が勝ち上がる前提) */
  chalk:   ChalkPair;
  /** 大会開始時点で両者が決まっているか (試合番号の第1キー) */
  staffed: boolean;
  slots:   readonly [MatchSlotRef, MatchSlotRef];
}

/**
 * その段の「表示位置 → 試合番号 (1始まり)」。
 *
 * **実際に対戦するカードだけに 1..k を振る。** 不戦のカードは番号を消費しない —
 * 5人なら実戦は 4位-5位 の1試合だけなので、それが第1試合になる
 * (不戦にも番号を振ると「第4試合」しか行われない、という表示になってしまう)。
 * 不戦のカードは末尾の番号を受け取るが、ラベルには出さない (呼ぶ側で落とす)。
 *
 * 対戦するカードの並べ方は、この順:
 *
 * 1. **大会開始時に両者が決まっているカードが先** (`StageCard.staffed`)。
 *    勝ち上がりを待つカードは後。
 * 2. **カードの弱いほうの選手が弱い順**
 *    (8人なら 第1試合=1位-8位、第2試合=2位-7位、…、第4試合=4位-5位)。
 * 3. 同じなら表示位置の順で安定させる。
 *
 * 実施はこの番号の昇順なので、**最も弱い選手を含むカードから**順に消化することになる。
 *
 * 1 が要るのは、不戦で上がった選手だけで埋まるカードと、下の回戦の勝者を待つカードが
 * 同じ段に混ざるとき (**実質2回戦だけ**)。9人なら2回戦は
 * 「1位-(8位/9位の勝者)」「4位-5位」「2位-7位」「3位-6位」で、2 だけで決めると
 * 8位-9位を戦った直後の選手が連戦になり、他の6人は待たされる。両者が決まっている
 * 3枚を先に消化すれば、勝ち上がった選手に1試合ぶんの間が空く。
 *
 * その代わり**番号は表の位置と対応しなくなる** — 2 だけなら再帰的点対称の番号付けに
 * なる (16人で bye が無ければ表の上から 1 8 5 4 3 6 7 2) が、1 が効く段ではその形が崩れる。
 * bye が無ければどの段も 1 が一様なので、従来どおりの並びのまま。
 *
 * 「強いほう (最上位シード) が弱い順」ではないことに注意 — 両者は同じ回戦の中では
 * 一致するが、決勝と3位決定戦のように出場者の強さの幅が違う組では食い違う。
 * 弱いほうで見ると 3位決定戦 が決勝より先になり、実施順の決まりと自然に一致する。
 *
 * **表示位置の順に振らないこと** — それだと線対称の番号付けになり、実施順が番号と
 * 噛み合わなくなる。
 */
function matchNumbers(cards: readonly StageCard[]): number[] {
  const indexed = cards.map((c, pos) => ({
    pos, best: c.chalk[0], worst: c.chalk[1], bye: isWalkover(c.chalk), staffed: c.staffed,
  }));
  const ordered = [
    // 対戦するカード: 両者が決まっているものが先、その中は弱いほうの選手が弱い順
    ...indexed.filter(x => !x.bye).sort((a, b) =>
      (Number(b.staffed) - Number(a.staffed)) || (b.worst - a.worst) || (a.pos - b.pos)),
    // 不戦のカードは番号を消費しないよう末尾へ回す (勝ち上がる人の上位順)
    ...indexed.filter(x => x.bye).sort((a, b) => (a.best - b.best) || (a.pos - b.pos)),
  ];
  const nums = new Array<number>(cards.length);
  ordered.forEach((x, i) => { nums[x.pos] = i + 1; });
  return nums;
}

/** その枠に入る選手の選手番号 (小さいほど上位)。bye と未知は最も下位として扱う */
function seedOfRef(ref: MatchSlotRef, seedOf: ReadonlyMap<string, number>): number {
  switch (ref.kind) {
    case 'participant': return seedOf.get(ref.participantId) ?? NO_SEED;
    case 'group-rank':  return ref.rank * GROUP_RANK_SPAN + ref.group;
    default:            return NO_SEED;   // bye / winner-of / loser-of はここでは扱わない
  }
}

const pairOf = (a: number, b: number): ChalkPair => (a <= b ? [a, b] : [b, a]);

// ── 先攻・後攻と表示位置 ──────────────────────────────────────────────────

/** 片側だけが不在の枠 (= 不戦勝で上がる人がいる枠)。両側とも不在の枠は含まない */
function isOneSidedBye(m: TournamentMatch): boolean {
  return (m.slotA.kind === 'bye') !== (m.slotB.kind === 'bye');
}

/**
 * 不戦の枠は、不戦勝で上がる選手を必ず先攻 (slotA) に置く。
 *
 * **対戦は行われないのでどちらでもよいが、固定しておいたほうが読みやすい。**
 * 1ゲーム制の `sideCoin` に任せると大会ごとにばらつき、組み合わせ表・結果CSVでの
 * 見え方が揃わない。**`maybeSwapSides` のあとに上書きすること。**
 */
function assignWalkoverSides(matches: TournamentMatch[]): void {
  for (const m of matches) {
    if (!isOneSidedBye(m) || m.slotA.kind !== 'bye') continue;
    const player = m.slotB;
    m.slotA = player;
    m.slotB = { kind: 'bye' };
  }
}

/**
 * 1回戦を不戦で通過した選手が、**次の回戦で**先攻・後攻どちらに座るかを決める。
 *
 * **不戦で上がった選手は必ず先攻 (slotA)。** 不戦で上がった選手同士が当たるカード
 * (= 大会開始時点で両者が決まっているカード) では、上位シードが先攻・下位シードが後攻。
 * シード順に処理して、先に来た上位シードが先攻を取り、もう一方は残った後攻で確定する。
 *
 * これで**対戦相手が最初から決まっているカードは、どの回戦でも上位シードが先攻**に揃う
 * (1回戦は `seedOrder` の並びがそのまま上位シード = slotA になっている)。
 *
 * **1ゲーム制には適用しない** (`finishSides` が `sideSeed` の有無で分ける)。
 * 2ゲーム制は第2ゲームで先後が入れ替わるため、ここで決まるのは
 * 「1ゲーム目にどちらが先攻か」。
 */
function assignSidesAfterWalkover(
  matches: TournamentMatch[], seedOfMatch: ReadonlyMap<string, number>,
): void {
  const byes = matches
    .filter(isOneSidedBye)
    .sort((a, b) =>
      (seedOfMatch.get(a.id) ?? NO_SEED) - (seedOfMatch.get(b.id) ?? NO_SEED));

  const fixed = new Set<string>();
  for (const bye of byes) {
    const isRefTo = (ref: MatchSlotRef) => ref.kind === 'winner-of' && ref.matchId === bye.id;
    const parent  = matches.find(m => isRefTo(m.slotA) || isRefTo(m.slotB));
    // 上位シードが先に先攻を取る。埋まっていれば残った後攻で確定
    if (!parent || fixed.has(parent.id)) continue;
    fixed.add(parent.id);

    if (!isRefTo(parent.slotA)) {
      const a = parent.slotA;
      parent.slotA = parent.slotB;
      parent.slotB = a;
    }
  }
}

/**
 * 表示位置 (`order`) を先攻・後攻に合わせ直す。
 *
 * **上位のカードから見て、先攻側 (slotA) の子カードを上に、後攻側 (slotB) の子カードを
 * 下に置く。** こうしないと接続線が交差する — 下のカードの勝者が親の上の行 (先攻) へ
 * 入り、上のカードの勝者が下の行へ入る、という絵になる。
 *
 * **2ゲーム制でだけ呼ぶ (`finishSides`)。** 1ゲーム制は試合ごとに `sideCoin` で
 * 先攻・後攻を決める仕様なので、表の位置とは無関係に扱う (位置を追従させると、大会ごとに
 * コイントス任せで表の並びが変わり、点対称の配置もブロックのバランスも崩れる)。
 *
 * 2ゲーム制で slot が入れ替わっているのは `assignSidesAfterWalkover` が触った親
 * (= 2回戦のカード) だけなので、入れ替わる子の片方は必ず不戦のカード (表では非表示)。
 * **実戦のカード同士が入れ替わることは無く、実戦のカードの相対順序は保たれる**
 * (不戦のカードと席を交換して絶対位置が1段ずれることはある)。そのぶん
 * `balanceBracketHalves` / `pointSymmetricBracketOrder` の並びを崩すことはある。
 *
 * 3位決定戦は `loser-of` 参照なので辿られず、`order` は元のまま残る。
 */
function alignDisplayToSides(matches: TournamentMatch[], final: TournamentMatch): void {
  const byId = new Map(matches.map(m => [m.id, m]));
  const walk = (m: TournamentMatch, order: number): void => {
    m.order = order;
    for (const [ref, next] of [[m.slotA, order * 2], [m.slotB, order * 2 + 1]] as const) {
      if (ref.kind !== 'winner-of') continue;
      const child = byId.get(ref.matchId);
      if (child) walk(child, next);
    }
  };
  walk(final, 0);
}

/**
 * 先攻・後攻と表示位置を最後に整える。**`maybeSwapSides` のあとに呼ぶこと** —
 * 順序が逆だとコイントスに潰される。
 *
 * **1ゲーム制 (`sideSeed` あり) は不戦の枠を先攻に固定するところで止める。**
 * そちらは「試合ごとに `sideCoin` でランダムに決める」仕様のままなので、
 * シード順の割り当ても、表の位置を側に合わせることもしない。
 */
function finishSides(
  matches: TournamentMatch[], finalMatch: TournamentMatch,
  bestSeedOf: ReadonlyMap<string, number>, sideSeed: string | undefined,
): void {
  assignWalkoverSides(matches);
  if (sideSeed !== undefined) return;
  assignSidesAfterWalkover(matches, bestSeedOf);
  alignDisplayToSides(matches, finalMatch);
}

// ── 試合の器 ──────────────────────────────────────────────────────────────

/**
 * その回戦に1試合しかなければ「決勝」のように回戦名だけにする。
 * **不戦のカードも回戦名だけ** — 番号を持たないので「第N試合」を名乗らせない。
 */
function matchLabel(
  stage: number, order: number, count: number, totalStages: number, walkover = false,
): string {
  const base = stageLabel(stage, totalStages);
  return count === 1 || walkover ? base : `${base} 第${order + 1}試合`;
}

function matchId(stage: number, order: number, totalStages: number): string {
  const fromLast = totalStages - 1 - stage;
  if (fromLast === 0) return 'FINAL';
  if (fromLast === 1) return `SF${order + 1}`;
  if (fromLast === 2) return `QF${order + 1}`;
  return `R${stage + 1}M${order + 1}`;
}

function emptyMatch(
  id: string, stage: number, order: number, label: string, no: number,
  slotA: MatchSlotRef, slotB: MatchSlotRef,
): TournamentMatch {
  return {
    id, stage, order, label, no, slotA, slotB,
    resolvedA: null, resolvedB: null,
    byeA: false, byeB: false,
    status: 'pending',
  };
}

function slotRef(participantId: string | null): MatchSlotRef {
  return participantId === null ? { kind: 'bye' } : { kind: 'participant', participantId };
}

/**
 * 文字列から決定的に真偽値を1つ決める (1ゲーム制の決勝トーナメントで先攻・後攻を
 * 「ランダムに見えるが再現性のある」形で割り当てるため)。
 *
 * **`Math.random()` を使わないこと。** `buildBracket` は `TournamentStore.buildMatches` から
 * 何度も呼ばれ (`stateMatchesDefinition` が再スキャン/再起動のたびに再構築して突き合わせる)、
 * 真の乱数だと呼ぶたびに結果が変わって「定義が変わった」と誤判定され、進行状態が消える。
 */
export function sideCoin(seed: string): boolean {
  return (createHash('sha256').update(seed).digest()[0]! & 1) === 1;
}

/** sideSeed が指定されていれば、その試合の id を鍵にしたコイントスで slotA/slotB を入れ替える */
function maybeSwapSides(
  sideSeed: string | undefined, id: string, a: MatchSlotRef, b: MatchSlotRef,
): [MatchSlotRef, MatchSlotRef] {
  return sideSeed !== undefined && sideCoin(`${sideSeed}:${id}`) ? [b, a] : [a, b];
}

// ── 段の組み立て ──────────────────────────────────────────────────────────

/** 段をまたいで変わらない組み立ての条件 */
interface BracketShape {
  totalStages: number;
  /** stage 番号に足すゲタ (予選のうしろに置くとき)。**id と label は相対のまま** */
  offset:      number;
  sideSeed:    string | undefined;
}

/**
 * 1つの段のカードを組み立てる。**返り値は表示位置の順** (index = `order`)。
 *
 * 試合番号 (`no`) と id はこの段の中だけで決まるので、「表示位置は組んだ順・
 * 番号は弱いほうの選手が弱い順」という別軸の2つをここに閉じ込められる。
 */
function buildStage(
  cards: StageCard[], stage: number, shape: BracketShape,
): TournamentMatch[] {
  const nums = matchNumbers(cards);
  return cards.map((card, order) => {
    const num = nums[order]!;
    const id  = matchId(stage, num - 1, shape.totalStages);
    return emptyMatch(
      id, stage + shape.offset, order,
      matchLabel(stage, num - 1, cards.length, shape.totalStages, isWalkover(card.chalk)), num,
      ...maybeSwapSides(shape.sideSeed, id, card.slots[0], card.slots[1]),
    );
  });
}

/** 1回戦のカード。枠は参加者か bye なので、どのカードも最初から両者が決まっている */
function firstRoundCards(
  slots: MatchSlotRef[], seedOf: ReadonlyMap<string, number>,
): StageCard[] {
  return Array.from({ length: slots.length / 2 }, (_, i) => {
    const [a, b] = [slots[i * 2]!, slots[i * 2 + 1]!];
    return {
      chalk:   pairOf(seedOfRef(a, seedOf), seedOfRef(b, seedOf)),
      staffed: true,
      slots:   [a, b] as const,
    };
  });
}

/** 次の段のカード。勝ち上がるのは上位側なので、子の best 同士が当たる */
function nextStageCards(prev: StageCard[], prevMatches: TournamentMatch[]): StageCard[] {
  return Array.from({ length: prev.length / 2 }, (_, i) => {
    const [up, down] = [prev[i * 2]!, prev[i * 2 + 1]!];
    return {
      chalk:   pairOf(up.chalk[0], down.chalk[0]),
      // 子が両方とも不戦なら、このカードは大会開始時点で両者が決まっている
      staffed: isWalkover(up.chalk) && isWalkover(down.chalk),
      slots:   [
        { kind: 'winner-of', matchId: prevMatches[i * 2]!.id },
        { kind: 'winner-of', matchId: prevMatches[i * 2 + 1]!.id },
      ] as const,
    };
  });
}

/**
 * 3位決定戦。準決勝が存在する (4人以上) ときだけ作り、無ければ null。
 *
 * 出場者は準決勝の敗者 = 決勝より弱いので、**弱いほうから消化する規則に従って
 * 決勝 (第1試合) より先に来るよう、大きい番号ではなく 0 を振る。**
 * 表示位置 (`order`) は 1 = 決勝の下 — 実施順と表示順は別物。
 */
function thirdPlaceMatchOf(
  matches: TournamentMatch[], shape: BracketShape,
): TournamentMatch | null {
  if (shape.totalStages < 2) return null;
  // m.stage はゲタ込みなので、比較する側もゲタを足す
  const semis = matches.filter(m => m.stage === shape.totalStages - 2 + shape.offset);
  if (semis.length !== 2) return null;
  return emptyMatch(
    'THIRD', shape.totalStages - 1 + shape.offset, 1, '3位決定戦', 0,
    ...maybeSwapSides(
      shape.sideSeed, 'THIRD',
      { kind: 'loser-of', matchId: semis[0]!.id },
      { kind: 'loser-of', matchId: semis[1]!.id },
    ),
  );
}

export interface BuildBracketOptions {
  thirdPlaceMatch: boolean;
  /** 明示的な1回戦の並び。長さは2の冪、null は bye */
  slots?: (string | null)[];
  /**
   * 1回戦の中身を参照で直接指定する (予選リーグの順位から勝ち上がる場合)。
   * これを渡すと participants は使わない — 決勝トーナメントの出場者は組み立て時点では未定だから。
   */
  firstRoundRefs?: MatchSlotRef[];
  /**
   * stage 番号に足すゲタ (予選のうしろに置くとき)。
   *
   * **id と label は決勝トーナメント内の相対 stage のまま**にすること —
   * ゲタを混ぜると matchId が 'SF1' ではなく 'R3M1' になってしまう。
   */
  stageOffset?: number;
  /**
   * 指定すると、各試合の slotA/slotB を `sideCoin` で決定的にシャッフルする
   * (1ゲーム制の決勝トーナメント用)。省略時は今まで通り slotA が常に若い方の参照になる。
   * 大会ごとに割り当てを変えたいので、呼び出し側は `def.id` などを渡すこと。
   */
  sideSeed?: string;
}

// ── 1回戦の並べ方 ─────────────────────────────────────────────────────────

/** 長さを2の冪に切り上げる (足りない枠は bye)。以降は枠の欠けを気にしなくてよい */
function padToBracketSize(refs: MatchSlotRef[]): MatchSlotRef[] {
  const out  = [...refs];
  const size = bracketSizeFor(out.length);
  while (out.length < size) out.push({ kind: 'bye' });
  return out;
}

/**
 * 1回戦の枠を並べる。長さは必ず2の冪。
 *
 * 自動生成した並びは表に描くとおりの順 (点対称) に直してから、ブロックごとに
 * バランスを取る。**この2つの順序を入れ替えると、右山だけ「下が多い」並びになる。**
 *
 * **運営が手で組んだ並び (`opts.slots`) だけは通さない** — 実行委員会が決めた
 * 組み合わせを勝手に鏡像にすることになる。
 */
function arrangeFirstRound(
  ordered: ParticipantDef[], opts: BuildBracketOptions,
): MatchSlotRef[] {
  const arrange = (refs: MatchSlotRef[]) =>
    balanceBracketHalves(pointSymmetricBracketOrder(refs), ref => ref.kind === 'bye');

  if (opts.firstRoundRefs && opts.firstRoundRefs.length > 0) {
    return arrange(padToBracketSize([...opts.firstRoundRefs]));
  }
  if (opts.slots && opts.slots.length > 0) {
    return padToBracketSize(opts.slots.map(slotRef));
  }
  const order = seedOrder(bracketSizeFor(ordered.length));
  return arrange(order.map(seedNo => slotRef(ordered[seedNo - 1]?.id ?? null)));
}

/**
 * 参加者からトーナメントの試合グラフを作る。
 *
 * 1回戦の並べ方は `arrangeFirstRound`、段ごとの組み立ては `buildStage` にある。
 * bye は必ず後半のシード位置に入るため、自動生成では「bye 同士のカード」は発生しない
 * (明示 slots では起こりうるので progress.ts 側で伝播できるようにしてある)。
 *
 * 最後に先攻・後攻と表示位置を整える (`assignWalkoverSides` /
 * `assignSidesAfterWalkover` / `alignDisplayToSides`)。
 */
export function buildBracket(
  participants: ParticipantDef[],
  opts: BuildBracketOptions,
): TournamentMatch[] {
  const ordered = orderBySeed(participants);
  // 1回戦を参照で渡された場合は participants が空でも組み立てる
  // (決勝トーナメントの出場者は予選が終わるまで決まらない)
  if (ordered.length === 0 && !opts.firstRoundRefs) return [];

  const firstRound = arrangeFirstRound(ordered, opts);
  // 参加者1人。試合は成立しないので空のグラフを返す
  if (firstRound.length < 2) return [];

  const shape: BracketShape = {
    totalStages: Math.log2(firstRound.length),
    offset:      opts.stageOffset ?? 0,
    sideSeed:    opts.sideSeed,
  };
  // 選手番号の引き当て。組み合わせ表の選手番号 = orderBySeed の並び順
  const seedOf = new Map(ordered.map((p, i) => [p.id, i + 1]));

  const matches: TournamentMatch[] = [];
  /** 試合 id → 想定出場者の上位側の選手番号。不戦の先攻・後攻を決めるのに使う */
  const bestSeedOf = new Map<string, number>();

  let cards = firstRoundCards(firstRound, seedOf);
  let built: TournamentMatch[] = [];
  for (let stage = 0; stage < shape.totalStages; stage++) {
    if (stage > 0) cards = nextStageCards(cards, built);
    built = buildStage(cards, stage, shape);
    built.forEach((m, i) => bestSeedOf.set(m.id, cards[i]!.chalk[0]));
    matches.push(...built);
  }
  // ループを抜けた時点の built = 最後の段 = 決勝 (カード1枚)
  const finalMatch = built[0]!;

  if (opts.thirdPlaceMatch) {
    const third = thirdPlaceMatchOf(matches, shape);
    if (third) matches.push(third);
  }

  finishSides(matches, finalMatch, bestSeedOf, shape.sideSeed);
  return matches;
}
