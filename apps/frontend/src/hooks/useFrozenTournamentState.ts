import { useRef } from 'react';
import type { TournamentStatePayload } from '@u15/ws-types';

/**
 * MainWindow に渡す tournamentState を、指定した条件を満たす間だけ直前の値に凍結する。
 *
 * 試合結果を確定すると tournamentState は armedMatchId=null へ即座に更新される。対策なしだと
 * 「大会登録名からプログラム自己申告名への切り替わり」や「BOT予選の合計得点が決勝の獲得アイテム数
 * 表示に戻る」(koryuDisplay.ts の scoringContextOf が armedMatchOf に依存するため) が、確定直後の
 * 一瞬 (対戦表示窓は暗転が閉じるまで) または setup に戻るまでずっと (コントロール窓) 見えてしまう。
 *
 * `trackLive` が true の間は tournamentState をそのまま追いかけ、false の間は最後に true だった
 * ときの値を返し続ける。呼び出し側は「この試合の表示中である」と言える条件 (対戦表示窓なら
 * 暗転が閉じている `currentGroup === displayedGroup`、コントロール窓なら `phase === 'setup'` の
 * 否定) を渡す。
 */
export function useFrozenTournamentState(
  tournamentState: TournamentStatePayload | null | undefined,
  trackLive: boolean,
): TournamentStatePayload | null | undefined {
  const ref = useRef(tournamentState);
  if (trackLive) ref.current = tournamentState;
  return ref.current;
}
