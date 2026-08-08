import type { TournamentMatch } from '@u15/ws-types';
import { groupLabel, hasQualifying, isGroupStageDone } from '@u15/ws-types';
import {
  TournamentError, commit, ctxOf, decide, disarmIfCleared, nameOf,
  type Binding, type CommandEnv,
} from './binding.js';
import { reopenMatch as reopenInGraph } from './progress.js';
import { qualifierKey } from './qualifiers.js';
import { groupsOf, qualifiersOf, saveState } from './TournamentStore.js';

// 予選 → 決勝トーナメントの受け渡し。
//
// 予選が終わっても自動では決勝へ進ませない。観戦画面は確定するまで予選の最終結果を
// 出し続けるので、観客が順位と勝ち上がりを見る時間になり、同時に運営が同点の枠を
// 見直す機会にもなる。
//
// 同点の直し方は2通りあり、形式によって使い分ける:
//   setQualifier          … 枠 (リーグ・順位) ごとに誰を入れるか指定する — 予選リーグ
//   setQualifierExclusion … 多めに出した候補から削って人数を合わせる     — BOT対戦予選

/**
 * 決勝進出者を運営が差し替える。`participantId: null` で自動判定に戻す。
 *
 * 公式ルールの同点処理 (勝ち点 → 合計ポイント → 直接対決) でも並びが決まらないことは
 * 通常運用で起こる。自動判定は必ず枠を埋めるので決勝は始められるが、その中身を人が
 * 最終的に決め直せるようにするための操作。
 */
export function setQualifier(
  env: CommandEnv, b: Binding,
  group: number, rank: number, participantId: string | null, cascade = false,
): void {
  requireQualifying(b);

  const slots = qualifiersOf(b.loaded) ?? [];
  const slot  = slots.find(s => s.group === group && s.rank === rank);
  if (!slot) throw new TournamentError('その枠は存在しません');

  if (participantId !== null) {
    const groupIds = groupsOf(b.loaded.def)[group] ?? [];
    if (!groupIds.includes(participantId)) {
      throw new TournamentError(b.loaded.def.stage.format === 'bot-then-bracket'
        ? `${nameOf(b, participantId)} は予選の参加者ではありません`
        : `${nameOf(b, participantId)} は${groupLabel(group)}リーグの参加者ではありません`);
    }
    // 差し替えた「あと」の顔ぶれで重複を見る。自動判定は順位表の位置で埋まるので、
    // 手動で1人繰り上げると別の枠の自動値と衝突することがある
    const after = slots.map(s => (
      s.group === group && s.rank === rank ? participantId : s.participantId
    ));
    if (after.filter(id => id === participantId).length > 1) {
      throw new TournamentError(
        `${nameOf(b, participantId)} は既に別の枠に入っています。先にそちらを変更してください`,
      );
    }
  }

  // その枠を使う1回戦が動いていたら、結果と食い違うので先に巻き戻す必要がある
  const first = firstRoundMatchOf(b, group, rank);
  if (first) requireRewindable(b, [first], cascade);

  decide(b, d => {
    const qualifiers = { ...d.qualifiers };
    if (participantId === null) delete qualifiers[qualifierKey(group, rank)];
    else qualifiers[qualifierKey(group, rank)] = participantId;
    return { ...d, qualifiers };
  });

  // 差し替えで顔ぶれが変わる試合と、その下流の結果は捨てる。
  // 残すと「戦っていない相手に勝った」という記録ができてしまう
  commit(b, first
    ? reopenInGraph(b.loaded.state.matches, first.id, ctxOf(b))
    : b.loaded.state.matches);
  if (first) disarmIfCleared(b, first.id);
  env.publish(b.roomId);
}

/**
 * 最終決定確認リストから参加者を削除する / 取り消す。
 *
 * 削除された人は順位表から居なかったものとして扱われ、下の順位が繰り上がる。
 * 同ポイントでボーダーに並んだときに「多めに出して削る」ための操作で、枠ごとの
 * 差し替え (setQualifier) と違い**誰がどの枠に入るかは指定しない** — 順位の並びに任せる。
 */
export function setQualifierExclusion(
  env: CommandEnv, b: Binding, participantId: string, excluded: boolean, cascade = false,
): void {
  requireQualifying(b);
  if (!b.loaded.def.participants.some(p => p.id === participantId)) {
    throw new TournamentError('参加者が見つかりません');
  }

  const before = b.loaded.state.decisions.exclusions;
  if (before.includes(participantId) === excluded) return;
  const after = excluded
    ? [...before, participantId]
    : before.filter(id => id !== participantId);

  // 削除で顔ぶれが変わりうる決勝トーナメントの試合。1つでも動いていたら先に巻き戻す
  const affected = qualifierDependentMatches(b);
  requireRewindable(b, affected, cascade);

  decide(b, d => ({ ...d, exclusions: after }));

  // 顔ぶれが変わる試合と、その下流の結果は捨てる。
  // **巻き戻してから commit し、そのあとで armed を落とす** — disarmIfCleared は
  // b.loaded の下流を数えるので、順番を逆にすると巻き戻す前のグラフを見てしまう
  let matches = b.loaded.state.matches;
  for (const m of affected) matches = reopenInGraph(matches, m.id, ctxOf(b));
  commit(b, matches);
  for (const m of affected) disarmIfCleared(b, m.id);
  env.publish(b.roomId);
}

/** 決勝進出者を「この顔ぶれで始める」と確定する / 確定を取り消す */
export function confirmQualifiers(env: CommandEnv, b: Binding, confirmed: boolean): void {
  requireQualifying(b);
  if (confirmed && !isGroupStageDone(b.loaded.state.matches)) {
    throw new TournamentError('予選がまだ終わっていません');
  }
  // **同点のボーダーが残っていても通す。** 自動判定は必ず決定的に枠を埋めるので決勝は
  // 始められるし、ここで弾くとオートプレイ (順位表の並び順で自動確定する) が止まる。
  // 「人数を合わせてから押す」の誘導は運営パネル側の役目

  decide(b, d => ({ ...d, qualifiersConfirmed: confirmed }));
  saveState(b.loaded.state);
  env.publish(b.roomId);
}

function requireQualifying(b: Binding): void {
  if (!hasQualifying(b.loaded.def.stage.format)) {
    throw new TournamentError('この大会には予選がありません');
  }
}

/**
 * これらの試合を巻き戻してよいか確かめる。
 *
 * 準備中・対戦中は問答無用で断り、実施済みは cascade で明示的に了承させる。
 * 黙って消すと「戦った記録が理由も分からず消えた」になる。
 */
function requireRewindable(b: Binding, affected: TournamentMatch[], cascade: boolean): void {
  const running = affected.find(m =>
    m.status === 'armed' || m.status === 'in_progress' || m.status === 'awaiting_confirm');
  if (running) {
    throw new TournamentError(
      `「${running.label}」が準備中・対戦中です。先にリセットしてから変更してください`,
    );
  }
  const played = affected.find(m => m.status === 'done' && !(m.byeA || m.byeB));
  if (played && !cascade) {
    throw new TournamentError(
      `「${played.label}」は実施済みです。この変更でその結果も取り消されます。確認のうえ実行してください`,
    );
  }
}

/** 決勝進出者の並びが変われば顔ぶれが変わる試合 (= group-rank を参照する1回戦) */
function qualifierDependentMatches(b: Binding): TournamentMatch[] {
  return b.loaded.state.matches.filter(m =>
    [m.slotA, m.slotB].some(r => r.kind === 'group-rank'));
}

/** その枠 (リーグ・順位) を参照している1回戦の試合 */
function firstRoundMatchOf(b: Binding, group: number, rank: number): TournamentMatch | undefined {
  return b.loaded.state.matches.find(m =>
    [m.slotA, m.slotB].some(r =>
      r.kind === 'group-rank' && r.group === group && r.rank === rank));
}
