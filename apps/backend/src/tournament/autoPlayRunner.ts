import type { TournamentState } from '@u15/ws-types';
import { NO_OPERATOR_DECISIONS, isGroupStageDone } from '@u15/ws-types';
import { managerOf, type Binding, type CommandEnv } from './binding.js';
import {
  delayFor, nextAutoPlayAction, type AutoPlayAction, type AutoPlayDelaysMs,
} from './autoPlay.js';
import { armMatch, confirmResult } from './matchCommands.js';
import { confirmQualifiers } from './qualifierCommands.js';
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
  /** 自動進行を止める (理由は運営パネルにそのまま出る) */
  stop: (b: Binding, reason: string) => void;
}

/** 今の状態から次の一手を予約する。予約済み・自動進行が切なら何もしない */
export function scheduleNext(env: AutoPlayEnv, b: Binding): void {
  if (!b.autoPlay.enabled || b.autoTimer) return;

  const planned = plan(b);
  if (!planned) return;

  b.autoTimer = setTimeout(() => {
    b.autoTimer = null;
    const now = plan(b);
    if (!now) return;
    // 待っている間に状況が変わった → 今の一手を、その一手ぶん待ってから
    if (now.kind !== planned.kind) { scheduleNext(env, b); return; }
    void run(env, b, now);
  }, delayFor(planned.kind, env.delays));
}

export function clearTimer(b: Binding): void {
  if (b.autoTimer) {
    clearTimeout(b.autoTimer);
    b.autoTimer = null;
  }
}

function plan(b: Binding): AutoPlayAction | null {
  if (!b.autoPlay.enabled) return null;
  return nextAutoPlayAction({
    matches:             b.loaded.state.matches,
    armedMatchId:        b.armedMatchId,
    format:              b.loaded.def.stage.format,
    qualifiersConfirmed: qualifiersConfirmedOf(b.loaded),
    groupStageDone:      isGroupStageDone(b.loaded.state.matches),
    status:              b.lastStatus,
    loop:                b.autoPlay.loop,
  });
}

/**
 * 一手ぶんの操作を実行する。
 *
 * 失敗 (プログラム未登録など) は握りつぶさず、理由を添えて自動進行を止める —
 * 同じ操作を延々と再試行すると、運営が気づかないまま止まっているのと変わらない。
 */
async function run(env: AutoPlayEnv, b: Binding, action: AutoPlayAction): Promise<void> {
  if (!b.autoPlay.enabled) return;

  const manager = managerOf(env, b);
  if (!manager) return;

  try {
    switch (action.kind) {
      case 'arm':                await armMatch(env, b, action.matchId); break;
      // requestStart は対戦が終わるまで返らない。その間の進行は status イベントが動かす
      case 'start':              await manager.requestStart(); break;
      case 'next-round':         await manager.requestNextRound(); break;
      case 'confirm':            confirmResult(env, b, action.matchId); break;
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
  const state: TournamentState = {
    tournamentId: b.tournamentId,
    matches:      buildMatches(b.loaded.def),
    programs:     b.loaded.state.programs,
    decisions:    { ...NO_OPERATOR_DECISIONS, stageMaps: b.loaded.state.decisions.stageMaps },
    updatedAt:    Date.now(),
  };
  b.loaded = { ...b.loaded, state };
  saveState(state);
  b.armedMatchId = null;

  // 盤面と割り当てをセットアップへ戻す (bind 直後と同じ見た目にする)
  const manager = managerOf(env, b);
  await manager?.requestReset();
  const firstMap = mapForStage(b.loaded, 0);
  if (firstMap) manager?.loadMap(firstMap);

  env.publish(b.roomId);
}
