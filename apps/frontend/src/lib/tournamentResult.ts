import type { TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import { idxForSide, isConsolationMatch } from '@u15/ws-types';

// 大会が終わったときの表彰台を求める純関数。
//
// 表彰に要るデータは TournamentStatePayload に全て入っている (matches と standings) ので、
// バックエンドに順位を計算させず、配信済みの状態だけから導く。

/** 表彰台の1行。同着なら names が複数になる */
export interface PodiumRow {
  rank:  1 | 2 | 3;
  label: string;
  names: string[];
}

const RANK_LABEL: Record<1 | 2 | 3, string> = {
  1: '優勝',
  2: '準優勝',
  3: '第3位',
};

const RANK_MEDAL: Record<1 | 2 | 3, string> = {
  1: '🏆',
  2: '🥈',
  3: '🥉',
};

export function medalOf(rank: 1 | 2 | 3): string {
  return RANK_MEDAL[rank];
}

/**
 * 全ての試合が確定したか。
 *
 * 試合が1つも無い大会 (参加者1人など) は「終了」とは呼べないので false。
 * 最後のゲームが終わっただけの時点ではその試合が awaiting_confirm なので、まだ false —
 * 運営が「確定」を押した瞬間に true になる。
 */
export function isTournamentComplete(state: TournamentStatePayload | null): boolean {
  if (!state || state.matches.length === 0) return false;
  return state.matches.every(m => m.status === 'done');
}

/**
 * 直近に確定した試合。まだ1つも確定していなければ null。
 *
 * 試合と試合の間、観客に「今どの試合が終わったのか」を示すために使う。時刻 (confirmedAt) で
 * 選ぶので、観戦窓を後から開き直しても同じ試合が指せる。
 *
 * **不戦勝 (bye) は除く** — 対戦していないのに「終わった試合」として光ってしまうため。
 * 運営が裁定した不戦勝 (bye でない walkover) は運営の操作なので残す。
 */
export function lastConfirmedMatch(state: TournamentStatePayload | null): TournamentMatch | null {
  if (!state) return null;
  return state.matches.reduce<TournamentMatch | null>((best, m) => {
    if (m.status !== 'done' || !m.result?.confirmedAt) return best;
    if (m.byeA || m.byeB) return best;
    if (!best) return m;
    return m.result.confirmedAt > best.result!.confirmedAt! ? m : best;
  }, null);
}

/** 確定した試合の勝者名。決着なし (両者棄権) なら null */
export function winnerNameOf(state: TournamentStatePayload, m: TournamentMatch): string | null {
  const side = m.result?.winnerSide ?? null;
  if (side === null) return null;
  const id = side === 0 ? m.resolvedA : m.resolvedB;
  return id ? state.participants.find(p => p.id === id)?.name ?? null : null;
}

/**
 * 表彰台。該当者がいない段は行ごと省くので、勝者不在なら空配列になる。
 *
 * トーナメント … 決勝の勝者・敗者と、3位決定戦の勝者 (無い大会では3位を出さない)
 * リーグ       … 順位表の上位3位。同着は連名で、飛んだ順位 (1位同着なら2位) は出さない
 */
export function podiumOf(state: TournamentStatePayload): PodiumRow[] {
  return state.stage.format === 'league' ? leaguePodium(state) : eliminationPodium(state);
}

function eliminationPodium(state: TournamentStatePayload): PodiumRow[] {
  const nameOf = nameLookup(state);
  const rows: PodiumRow[] = [];

  const final = finalMatchOf(state.matches);
  if (final) {
    const winner = participantOfSide(final, final.result?.winnerSide ?? null);
    const loser  = participantOfSide(final, otherSide(final.result?.winnerSide ?? null));
    pushRow(rows, 1, nameOf(winner));
    pushRow(rows, 2, nameOf(loser));
  }

  // 3位決定戦は決勝と同じ stage に置かれている (isConsolationMatch で見分ける)
  const third = state.matches.find(m => isConsolationMatch(m) && m.stage === (final?.stage ?? -1));
  if (third) {
    pushRow(rows, 3, nameOf(participantOfSide(third, third.result?.winnerSide ?? null)));
  }

  return rows;
}

function leaguePodium(state: TournamentStatePayload): PodiumRow[] {
  const nameOf   = nameLookup(state);
  const standings = state.standings ?? [];
  const rows: PodiumRow[] = [];

  for (const rank of [1, 2, 3] as const) {
    // computeStandings の rank は同着のぶんだけ飛ぶ (1,1,3) ので、
    // 存在しない順位は行ごと落ちる
    const names = standings
      .filter(s => s.rank === rank)
      .map(s => nameOf(s.participantId))
      .filter((n): n is string => n !== null);
    if (names.length > 0) rows.push({ rank, label: RANK_LABEL[rank], names });
  }

  return rows;
}

/** 決勝 = 3位決定戦でない試合のうち最も後の回戦のもの */
function finalMatchOf(matches: TournamentMatch[]): TournamentMatch | null {
  return [...matches]
    .filter(m => !isConsolationMatch(m))
    .sort((a, b) => b.stage - a.stage || a.order - b.order)[0] ?? null;
}

function otherSide(side: 0 | 1 | null): 0 | 1 | null {
  return side === null ? null : side === 0 ? 1 : 0;
}

/** その side の participantId。確定していない・不戦なら null */
function participantOfSide(m: TournamentMatch, side: 0 | 1 | null): string | null {
  if (m.status !== 'done' || side === null) return null;
  return side === 0 ? m.resolvedA : m.resolvedB;
}

function nameLookup(state: TournamentStatePayload): (id: string | null) => string | null {
  return id => (id ? state.participants.find(p => p.id === id)?.name ?? null : null);
}

/**
 * いま対戦中 (armedMatchId) の試合の参加者登録名。index は team-index (COOL=0/HOT=1)。
 *
 * resolvedA/resolvedB は第1ゲーム (round 0) の COOL/HOT。2ゲーム制の第2ゲームは
 * swapSlotConfigs で中身が入れ替わるため、idxForSide (packages/ws-types/scoring.ts) と
 * 同じ規則で round ごとに team-index を引き直す。
 *
 * 名前が引けない (armed でない/未確定) 場合や、armedMatchId が指す試合が既に `done` の
 * 場合は null を返す。後者は、armMatch がスロットのリセット (server_status) を
 * tournament_state の armedMatchId 更新より先に配信するため、次の試合を準備中の一瞬
 * armedMatchId が直前に確定した試合を指したままになる隙間を吸収するため。
 * 呼び出し側はいずれの null もプログラムの自己申告名へのフォールバックとして扱う。
 */
export function armedMatchNames(
  state: TournamentStatePayload | null | undefined, round: 0 | 1 = 0,
): [string, string] | null {
  if (!state) return null;
  const match = state.matches.find(m => m.id === state.armedMatchId);
  if (!match || match.status === 'done') return null;
  const nameOf = nameLookup(state);
  const bySlot: [string | null, string | null] = [match.resolvedA, match.resolvedB];
  const cool = nameOf(bySlot[idxForSide(0, round)]);
  const hot  = nameOf(bySlot[idxForSide(1, round)]);
  return cool !== null && hot !== null ? [cool, hot] : null;
}

function pushRow(rows: PodiumRow[], rank: 1 | 2 | 3, name: string | null): void {
  if (name !== null) rows.push({ rank, label: RANK_LABEL[rank], names: [name] });
}
