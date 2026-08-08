import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { autoGroupAssign, bracketSizeFor, groupLabel, seedOrder } from '@u15/ws-types';
import { buildBracket, orderBySeed } from './bracket.js';
import { buildLeague } from './league.js';

// 「予選リーグ → 決勝トーナメント」の試合グラフを組み立てる純関数。
//
// 公式ルール「エントリー数が規定数を超えて予選を行う場合には総当たり戦を実施することがある」
// に沿って、予選を N リーグの総当たりで行い、各リーグの上位 M 名が勝ち上がる形式。
//
// 試合グラフは1本にまとめる:
//   stage 0 … g-1     予選の各節 (全リーグが同じ stage を共有する)
//   stage g … g+b-1   決勝トーナメントの各回戦
//
// この並び順が「予選は決勝より必ず前の stage」を保証し、progress.resolveMatches が
// group-rank を単一パスで解ける根拠になっている。順番を崩さないこと。

/** 参加者を予選リーグへ振り分ける。返り値の index = リーグ番号、値 = 参加者 (選手番号順) */
export function assignGroups(
  participants: ParticipantDef[], groupCount: number,
): ParticipantDef[][] {
  const ordered = orderBySeed(participants);
  const auto    = autoGroupAssign(ordered.length, groupCount);
  const groups: ParticipantDef[][] = Array.from({ length: groupCount }, () => []);

  ordered.forEach((p, i) => {
    // 明示指定があればそれを使う。範囲外なら自動振り分けへ落とす
    const explicit = p.group;
    const g = explicit !== undefined && explicit >= 0 && explicit < groupCount
      ? explicit
      : auto[i] ?? 0;
    groups[g]!.push(p);
  });

  return groups;
}

export interface BuildGroupStageOptions {
  groupCount:       number;
  advancePerGroup:  number;
  doubleRoundRobin: boolean;
  thirdPlaceMatch:  boolean;
}

export function buildGroupStage(
  participants: ParticipantDef[],
  opts: BuildGroupStageOptions,
): TournamentMatch[] {
  const groups = assignGroups(participants, opts.groupCount);

  // ── 予選 ──
  const groupMatches: TournamentMatch[] = [];
  groups.forEach((members, group) => {
    const built = buildLeague(members, { doubleRoundRobin: opts.doubleRoundRobin });
    for (const m of built) {
      groupMatches.push({
        ...m,
        id:    `G${group + 1}-D${m.stage + 1}M${m.order + 1}`,
        label: `${groupLabel(group)}リーグ 第${m.stage + 1}節 第${m.order + 1}試合`,
        // 同じ stage にリーグの数だけ試合が並ぶので、order がリーグ間で衝突しないようずらす。
        // 衝突したままだと compareByPlayOrder が同値を返し、次に実施する試合が不定になる
        order: m.order * opts.groupCount + group,
        group,
      });
    }
  });

  const groupStages = groupMatches.reduce((max, m) => Math.max(max, m.stage + 1), 0);

  // ── 決勝トーナメントの1回戦 ──
  //
  // (順位昇順, リーグ番号昇順) をシード1..N とし、標準シード順で配置する。
  // 2リーグ×上位2なら シードは A1,B1,A2,B2 → seedOrder(4)=[1,4,2,3] → A1,B2,B1,A2 と並び、
  // 準決勝が A1-B2 / B1-A2 という定石のクロス配置になる。
  const seeds: MatchSlotRef[] = [];
  for (let rank = 1; rank <= opts.advancePerGroup; rank++) {
    groups.forEach((members, group) => {
      // その順位に届く人数がいないリーグの枠は、組み立て時点で不戦と分かる
      seeds.push(members.length < rank ? { kind: 'bye' } : { kind: 'group-rank', group, rank });
    });
  }

  const size  = bracketSizeFor(seeds.length);
  const first = seedOrder(size).map(no => seeds[no - 1] ?? { kind: 'bye' });

  const bracket = buildBracket([], {
    thirdPlaceMatch: opts.thirdPlaceMatch,
    firstRoundRefs:  first,
    stageOffset:     groupStages,
  });

  return [...groupMatches, ...bracket];
}
