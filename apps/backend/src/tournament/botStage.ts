import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { BOT_PARTICIPANT_ID, bracketSizeFor, seedOrder } from '@u15/ws-types';
import { buildBracket, orderBySeed } from './bracket.js';

// 「BOT対戦予選 → 決勝トーナメント」の試合グラフを組み立てる純関数。
//
// 運営が用意した1つの BOT を基準器として、全参加者が**同一 BOT・同一マップ**と1試合ずつ戦い、
// 獲得ポイントで順位を付ける。予選の試合数が参加者数と等しくなるので、エントリーが多くても
// 予選が回る (総当たりは nC2 で爆発する)。
//
// 試合グラフは groupStage.ts と同じ形で1本にまとめる:
//   stage 0     予選 (全参加者ぶんの BOT 戦。group は常に 0)
//   stage 1..   決勝トーナメントの各回戦
//
// **予選を「1グループの予選」として組む**のが要点。こうすると group-rank による1回戦の参照、
// 巻き戻しの依存追跡 (progress.downstreamOf)、決勝進出者の確定ゲートが、予選リーグ形式のために
// 作った機構のまま動く。BOT 専用の分岐を進行側に増やさないための設計。

/** BOT対戦予選の全試合が属する予選グループ番号。1グループしか無いので固定 */
export const BOT_GROUP = 0;

export interface BuildBotStageOptions {
  /** 決勝トーナメントへ上がる人数 */
  advanceCount:    number;
  /** 参加者が第1ゲームでどちら側に座るか (0 = 先攻 / 1 = 後攻) */
  participantSide: 0 | 1;
  thirdPlaceMatch: boolean;
  /**
   * 決勝トーナメントの先攻/後攻をランダム化する種。buildBracket へそのまま転送する。
   * **予選 (BOT対戦) には適用しない** — 全参加者が同一条件で測られるのがこの形式の根拠
   */
  bracketSideSeed?: string;
}

export function buildBotStage(
  participants: ParticipantDef[],
  opts: BuildBotStageOptions,
): TournamentMatch[] {
  const ordered = orderBySeed(participants);
  if (ordered.length === 0) return [];

  const bot: MatchSlotRef = { kind: 'participant', participantId: BOT_PARTICIPANT_ID };

  // ── 予選 ──
  //
  // slotA = side 0 = 第1ゲームの COOL = 先攻 という既存の不変条件に乗せる。
  // participantSide はどの参加者にも同じ値が当たる — 全員が同一条件で測られるのが
  // この形式の根拠なので、参加者ごとに変える余地は持たせない。
  const qualifying: TournamentMatch[] = ordered.map((p, i) => {
    const self: MatchSlotRef = { kind: 'participant', participantId: p.id };
    const [slotA, slotB] = opts.participantSide === 0 ? [self, bot] : [bot, self];
    return {
      id:    `B-M${i + 1}`,
      stage: 0,
      order: i,
      label: `BOT対戦予選 第${i + 1}試合`,
      group: BOT_GROUP,
      slotA, slotB,
      resolvedA: null, resolvedB: null,
      byeA: false, byeB: false,
      status: 'pending',
    };
  });

  // ── 決勝トーナメントの1回戦 ──
  //
  // 予選1位..N位をシード1..N として標準シード順に配置する (1位と2位が決勝まで当たらない)。
  const seeds: MatchSlotRef[] = Array.from({ length: opts.advanceCount }, (_, i) => (
    // その順位に届く人数がいなければ、組み立て時点で不戦と分かる
    ordered.length < i + 1
      ? { kind: 'bye' as const }
      : { kind: 'group-rank' as const, group: BOT_GROUP, rank: i + 1 }
  ));

  const size  = bracketSizeFor(seeds.length);
  const first = seedOrder(size).map(no => seeds[no - 1] ?? { kind: 'bye' as const });

  const bracket = buildBracket([], {
    thirdPlaceMatch: opts.thirdPlaceMatch,
    firstRoundRefs:  first,
    // 予選は stage 0 の1段だけ
    stageOffset:     1,
    sideSeed:        opts.bracketSideSeed,
  });

  return [...qualifying, ...bracket];
}
