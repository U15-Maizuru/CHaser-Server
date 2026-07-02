import type { RoundResult, ServerPhase } from '@u15/ws-types';

export class RoundController {
  phase:        ServerPhase   = 'setup';
  doubleMode:   boolean       = false;
  currentRound: 0 | 1         = 0;
  roundResults: RoundResult[] = [];
  turnDelayMs:  number        = 1000; // 1ターンあたりの表示待機時間 (デフォルト1秒)

  setDoubleMode(enabled: boolean): void {
    this.doubleMode = enabled;
  }

  setTurnDelay(ms: number): void {
    this.turnDelayMs = Math.max(0, Math.min(10000, ms));
  }

  recordRoundResult(result: RoundResult): void {
    this.roundResults.push(result);
  }

  canStart(): boolean {
    return this.phase === 'setup';
  }

  canGoNextRound(): boolean {
    if (this.phase !== 'finished') return false;
    if (!this.doubleMode || this.currentRound !== 1) return false;
    if (this.roundResults.length >= 2) return false; // 試合2は終了済み
    return true;
  }

  /** requestStart で1試合終わった直後の遷移。doubleMode の1試合目なら試合2待機へ */
  advanceAfterRound(): void {
    if (this.doubleMode && this.currentRound === 0) {
      this.currentRound = 1;
    }
    this.phase = 'finished';
  }

  /** requestReset 用: 完全に初期状態へ戻す */
  resetForNewGame(): void {
    this.phase        = 'setup';
    this.currentRound = 0;
    this.roundResults = [];
  }
}
