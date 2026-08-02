// 実体は @u15/ws-types の scoring.ts へ移した。大会運営機能 (apps/backend/src/tournament) が
// サーバー側でも試合勝者を求める必要があり、判定を一本化したままにするため。
// 既存の import (`from '../lib/setResult'`) を書き換えずに済むよう、ここは re-export のシムとして残す。
export type { SetResult } from '@u15/ws-types';
export { roundPointsFor, roundWonBy, computeSetResult } from '@u15/ws-types';
