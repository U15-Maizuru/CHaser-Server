import type { TournamentState } from '@u15/ws-types';
import { NO_OPERATOR_DECISIONS, isGroupStageDone } from '@u15/ws-types';
import { managerOf, resolveFor, type Binding, type CommandEnv, type Lane } from './binding.js';
import {
  delayFor, nextAutoPlayAction, type AutoPlayAction, type AutoPlayDelaysMs,
} from './autoPlay.js';
import { armMatch, confirmResult } from './matchCommands.js';
import { confirmQualifiers } from './qualifierCommands.js';
import { shuffledSeedOrder, withSeedOrder } from './seedShuffle.js';
import {
  buildMatches, mapForStage, qualifiersConfirmedOf, saveState,
} from './TournamentStore.js';

// 自動進行 (オートプレイ / デモモード) の予約と実行。
//
// 「次の一手」の判断は純関数 (autoPlay.ts) に閉じ、ここは予約と実行だけを持つ。
//
// 予約は常に高々1つ。**予約したときと発火したときの2回、同じ純関数を通す** —
// 待っている数秒の間に運営が手で操作しているかもしれないので、予約した内容を
// そのまま実行してはいけない。食い違っていたら、今の状態に合う一手を
// 改めて (その一手ぶんの待機時間で) 予約し直す。

export interface AutoPlayEnv extends CommandEnv {
  delays: AutoPlayDelaysMs;
  /** 同点の抽選とデモモードの組み合わせシャッフルに使う乱数 ([0, 1)) */
  random: () => number;
  /** 自動進行を止める (理由は運営パネルにそのまま出る) */
  stop: (b: Binding, reason: string) => void;
}

/**
 * 今の状態から次の一手を予約する。**レーンごとに独立して予約する** — 並列実行中は
 * それぞれのレーンが自分の対戦を自分のペースで進めるため。
 */
export function scheduleNext(env: AutoPlayEnv, b: Binding): void {
  for (const lane of b.lanes) scheduleLane(env, b, lane);
}

/** 予約済み・自動進行が切なら何もしない */
function scheduleLane(env: AutoPlayEnv, b: Binding, lane: Lane): void {
  if (!b.autoPlay.enabled || lane.autoTimer) return;

  const planned = plan(b, lane);
  if (!planned) return;

  lane.autoTimer = setTimeout(() => {
    lane.autoTimer = null;
    const now = plan(b, lane);
    if (!now) return;
    // 待っている間に状況が変わった → 今の一手を、その一手ぶん待ってから
    if (now.kind !== planned.kind) { scheduleLane(env, b, lane); return; }
    void run(env, b, lane, now);
  }, delayFor(planned.kind, env.delays));
}

export function clearTimer(b: Binding): void {
  for (const lane of b.lanes) {
    if (lane.autoTimer) {
      clearTimeout(lane.autoTimer);
      lane.autoTimer = null;
    }
  }
}

function plan(b: Binding, lane: Lane): AutoPlayAction | null {
  if (!b.autoPlay.enabled) return null;
  return nextAutoPlayAction({
    matches:             b.loaded.state.matches,
    armedMatchId:        lane.armedMatchId,
    otherArmedIds:       b.lanes
      .filter(l => l !== lane)
      .map(l => l.armedMatchId)
      .filter((id): id is string => id !== null),
    primary:             lane.primary,
    format:              b.loaded.def.stage.format,
    qualifiersConfirmed: qualifiersConfirmedOf(b.loaded),
    groupStageDone:      isGroupStageDone(b.loaded.state.matches),
    status:              lane.lastStatus,
    loop:                b.autoPlay.loop,
    announce:            b.autoPlay.announce,
    tieBreak:            b.autoPlay.tieBreak,
  });
}

/**
 * 一手ぶんの操作を実行する。
 *
 * 失敗 (プログラム未登録など) は握りつぶさず、理由を添えて自動進行を止める —
 * 同じ操作を延々と再試行すると、運営が気づかないまま止まっているのと変わらない。
 */
async function run(
  env: AutoPlayEnv, b: Binding, lane: Lane, action: AutoPlayAction,
): Promise<void> {
  if (!b.autoPlay.enabled) return;

  const manager = managerOf(env, lane.roomId);
  if (!manager) return;

  try {
    switch (action.kind) {
      case 'arm':                await armMatch(env, b, lane, action.matchId); break;
      // 文面は運営が入れたものをそのまま使う (自動進行では出す/出さないだけを選ぶ)。
      // armMatch が visible を false に戻すので、次の試合でまた出る
      case 'announce':           manager.setAnnouncement({ visible: true }); break;
      // requestStart は対戦が終わるまで返らない。その間の進行は status イベントが動かす
      case 'start':              await manager.requestStart(); break;
      case 'next-round':         await manager.requestNextRound(); break;
      case 'confirm':            confirmResult(env, b, action.matchId); break;
      // 勝者は運営の手動指定と同じ経路 (decidedBy: 'manual') で入れ、理由を note に残す。
      // 表のカードに note が出るので、観客にも「抽選で決まった」ことが分かる
      case 'confirm-by-lot':
        confirmResult(env, b, action.matchId, env.random() < 0.5 ? 0 : 1, '同点のため抽選で決定');
        break;
      case 'confirm-qualifiers': confirmQualifiers(env, b, true); break;
      case 'restart':            await restart(env, b); break;
      case 'finish':             env.stop(b, '全ての試合が終了しました'); return;
      case 'pause':              env.stop(b, action.reason); return;
    }
  } catch (e) {
    env.stop(b, (e as Error).message);
    return;
  }
  // 操作の中で publish していれば予約済み。していない経路のための保険
  scheduleNext(env, b);
}

/**
 * デモモード: 進行状態を作り直して最初からやり直す。
 *
 * `resetTournamentState` を使わないのは、あちらが state.json を読み直すため
 * (運営中はこちらがメモリに握っているので食い違う)。回戦ごとのマップの差し替えは
 * 進行ではなく運営の設定なので残し、結果に紐づくもの (決勝進出者の指名・確定) は捨てる。
 */
async function restart(env: AutoPlayEnv, b: Binding): Promise<void> {
  // 組み合わせが手動でなければ、選手番号を振り直して組み合わせを変える。手動なら並びを保つ。
  // **先に def を差し替えること** — buildMatches も resolveFor も b.loaded.def を読む
  const reseeded  = shuffledSeedOrder(b.loaded.def, env.random);
  const seedOrder = reseeded ?? b.loaded.state.seedOrder ?? null;
  if (reseeded) b.loaded = { ...b.loaded, def: withSeedOrder(b.loaded.def, reseeded) };

  const state: TournamentState = {
    tournamentId: b.tournamentId,
    // 運営中の作り直しなので「開始済み」のまま。buildMatches は未開始の graph を返すので、
    // 解き直して bye を不戦勝に戻す (未確定のままだとデモが最後まで進まない)
    startedAt:    Date.now(),
    matches:      resolveFor(b, buildMatches(b.loaded.def)),
    seedOrder,
    programs:     b.loaded.state.programs,
    decisions:    {
      ...NO_OPERATOR_DECISIONS,
      stageMaps: b.loaded.state.decisions.stageMaps,
      matchMaps: b.loaded.state.decisions.matchMaps,
    },
    updatedAt:    Date.now(),
  };
  b.loaded = { ...b.loaded, state };
  saveState(state);
  for (const lane of b.lanes) lane.armedMatchId = null;

  // 盤面と割り当てをセットアップへ戻す (bind 直後と同じ見た目にする)。
  // 副レーンも戻さないと、前回の対戦の盤面が分割画面に残り続ける
  const firstMap = mapForStage(b.loaded, 0);
  for (const lane of b.lanes) {
    const manager = managerOf(env, lane.roomId);
    await manager?.requestReset();
    if (firstMap) manager?.loadMap(firstMap);
  }

  env.publish(b.roomId);
}
