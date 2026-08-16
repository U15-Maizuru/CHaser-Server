import type { ServerStatusPayload, TournamentMatchResult } from '@u15/ws-types';
import { computeSetResult, doubleModeFor } from '@u15/ws-types';
import { commit, ctxOf, managerOf, updateMatch, type Binding, type CommandEnv } from './binding.js';
import { captureResult } from './progress.js';

// ServerManager の 'status' を大会の進行へ写す。
//
// ServerManager は大会を知らないので、対戦の始まり・終わり・中断はここで読み替える。
// 逆向き (大会 → 対戦) は matchCommands の armMatch が担う。

export function applyServerStatus(env: CommandEnv, b: Binding, st: ServerStatusPayload): void {
  // デモ・リピートが別のコントロール窓から有効化されても打ち消す (自己修復)。
  // 有効なままだと自動進行が勝手に次の対戦を始めて、大会の進行と食い違う
  const manager = managerOf(env, b);
  if (manager && (st.demoMode || st.repeatMode)) {
    if (st.demoMode)   manager.setDemoMode(false);
    if (st.repeatMode) manager.setRepeatMode(false);
    return; // setXxxMode が再度 status を発火するのでここでは進めない
  }

  const armedId = b.armedMatchId;
  if (!armedId) return;
  const match = b.loaded.state.matches.find(m => m.id === armedId);
  if (!match) return;

  const expected = doubleModeFor(b.loaded.def, match) ? 2 : 1;

  if (match.status === 'armed' && st.phase === 'playing') {
    updateMatch(b, armedId, m => ({ ...m, status: 'in_progress' }));
    env.publish(b.roomId);
    return;
  }

  if (match.status !== 'in_progress') return;

  if (st.phase === 'finished' && st.roundResults.length >= expected) {
    // 全ゲーム終了。結果を取り込んで運営の確定を待つ
    // (この時点で state.json に保存するので、以降にリセットされても結果は失われない)
    commit(b, captureResult(
      b.loaded.state.matches, armedId, matchResultOf(st.roundResults.slice(0, expected)), ctxOf(b),
    ));
    env.publish(b.roomId);
    return;
  }

  if (st.phase === 'setup' && st.roundResults.length === 0) {
    // 運営が中断・リセットした → カードは未実施へ戻す
    updateMatch(b, armedId, m => ({ ...m, status: 'ready' }));
    b.armedMatchId = null;
    env.publish(b.roomId);
  }
}

/** 完了したゲーム結果から、試合の結果レコードを組み立てる */
function matchResultOf(roundResults: ServerStatusPayload['roundResults']): TournamentMatchResult {
  const set = computeSetResult(roundResults);
  return {
    roundResults,
    set,
    // side0 = slotA の不変条件により、computeSetResult の winnerSide がそのまま使える
    winnerSide: set.winnerSide,
    decidedBy:  set.decidedBy ?? 'points',
    capturedAt: Date.now(),
  };
}
