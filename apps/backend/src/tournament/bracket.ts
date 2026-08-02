import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { bracketSizeFor, seedOrder } from '@u15/ws-types';

// トーナメント (勝ち上がり) の試合グラフを組み立てる純関数。
// 結果の反映・slot の解決は progress.ts が行う。ここは構造だけを作る。
//
// 1回戦の並べ方 (seedOrder / bracketSizeFor) は大会データ作成 UI と共有するため
// @u15/ws-types にある。ここからも従来どおり import できるよう re-export しておく。

export { bracketSizeFor, seedOrder };

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

function stageLabel(stage: number, totalStages: number): string {
  const fromLast = totalStages - 1 - stage;
  if (fromLast === 0) return '決勝';
  if (fromLast === 1) return '準決勝';
  if (fromLast === 2) return '準々決勝';
  return `${stage + 1}回戦`;
}

/** その回戦に1試合しかなければ「決勝」のように回戦名だけにする */
function matchLabel(stage: number, order: number, count: number, totalStages: number): string {
  const base = stageLabel(stage, totalStages);
  return count === 1 ? base : `${base} 第${order + 1}試合`;
}

function matchId(stage: number, order: number, totalStages: number): string {
  const fromLast = totalStages - 1 - stage;
  if (fromLast === 0) return 'FINAL';
  if (fromLast === 1) return `SF${order + 1}`;
  if (fromLast === 2) return `QF${order + 1}`;
  return `R${stage + 1}M${order + 1}`;
}

function emptyMatch(
  id: string, stage: number, order: number, label: string,
  slotA: MatchSlotRef, slotB: MatchSlotRef,
): TournamentMatch {
  return {
    id, stage, order, label, slotA, slotB,
    resolvedA: null, resolvedB: null,
    byeA: false, byeB: false,
    status: 'pending',
  };
}

function slotRef(participantId: string | null): MatchSlotRef {
  return participantId === null ? { kind: 'bye' } : { kind: 'participant', participantId };
}

export interface BuildBracketOptions {
  thirdPlaceMatch: boolean;
  /** 明示的な1回戦の並び。長さは2の冪、null は bye */
  slots?: (string | null)[];
}

/**
 * 参加者からトーナメントの試合グラフを作る。
 *
 * slots を渡さない場合は seedOrder による標準シード配置。bye は必ず後半のシード位置に
 * 入るため、自動生成では「bye 同士のカード」は発生しない (明示 slots では起こりうるので
 * progress.ts 側で伝播できるようにしてある)。
 */
export function buildBracket(
  participants: ParticipantDef[],
  opts: BuildBracketOptions,
): TournamentMatch[] {
  const ordered = orderBySeed(participants);
  if (ordered.length === 0) return [];

  let firstRound: (string | null)[];
  if (opts.slots && opts.slots.length > 0) {
    firstRound = [...opts.slots];
    // 長さを2の冪に切り上げ (足りない分は bye)
    const size = bracketSizeFor(firstRound.length);
    while (firstRound.length < size) firstRound.push(null);
  } else {
    const size  = bracketSizeFor(ordered.length);
    const order = seedOrder(size);
    firstRound  = order.map(seedNo => ordered[seedNo - 1]?.id ?? null);
  }

  const size = firstRound.length;
  if (size < 2) {
    // 参加者1人。試合は成立しないので空のグラフを返す
    return [];
  }

  const totalStages = Math.log2(size);
  const matches: TournamentMatch[] = [];

  // 1回戦
  const firstIds: string[] = [];
  const firstCount = size / 2;
  for (let i = 0; i < firstCount; i++) {
    const id = matchId(0, i, totalStages);
    firstIds.push(id);
    matches.push(emptyMatch(
      id, 0, i, matchLabel(0, i, firstCount, totalStages),
      slotRef(firstRound[i * 2] ?? null),
      slotRef(firstRound[i * 2 + 1] ?? null),
    ));
  }

  // 2回戦以降
  let prevIds = firstIds;
  for (let stage = 1; stage < totalStages; stage++) {
    const ids: string[] = [];
    const count = prevIds.length / 2;
    for (let i = 0; i < count; i++) {
      const id = matchId(stage, i, totalStages);
      ids.push(id);
      matches.push(emptyMatch(
        id, stage, i, matchLabel(stage, i, count, totalStages),
        { kind: 'winner-of', matchId: prevIds[i * 2]! },
        { kind: 'winner-of', matchId: prevIds[i * 2 + 1]! },
      ));
    }
    prevIds = ids;
  }

  // 3位決定戦: 準決勝2つの敗者。準決勝が存在する (4人以上) ときだけ
  if (opts.thirdPlaceMatch && totalStages >= 2) {
    const semis = matches.filter(m => m.stage === totalStages - 2);
    if (semis.length === 2) {
      matches.push(emptyMatch(
        'THIRD', totalStages - 1, 1, '3位決定戦',
        { kind: 'loser-of', matchId: semis[0]!.id },
        { kind: 'loser-of', matchId: semis[1]!.id },
      ));
    }
  }

  return matches;
}
