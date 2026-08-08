import type { GameEndPayload } from '@u15/ws-types';
import { isBlunder, Reason } from '@u15/ws-types';

// 決着の文言。描画から切り離してテストできるようここに置く。

/**
 * 勝因 (原本の ResultLabel 相当): 決着理由を必ず表示する。
 *
 * 表記は競技ルールの勝利条件に合わせる (TRAPPED = 閉じ込め)。FOULED は競技ルールでは
 * 「中断」だが、フッターのリセットボタン (対戦中は「中断」) と紛れるため画面上は
 * 「通信エラー」と表示する。
 */
export function reasonLabel(reason: Reason): string {
  switch (reason) {
    case Reason.SCORE:     return 'アイテム数';
    case Reason.TRAPPED:   return '閉じ込め';
    case Reason.CONFINED:  return '自縛';
    case Reason.ATTACK:    return 'アタック';
    case Reason.COLLISION: return '衝突';
    case Reason.FOULED:    return '通信エラー';
    default:               return '';
  }
}

/**
 * 勝者側にのみ表示する「勝ち」テキスト。反則決着 (自縛/衝突/通信エラー) でも敗者視点の
 * LOSE 表記にはせず、常に勝者視点の文言 (相手の反則で勝った、という言い回し) にする。
 */
export function winnerText(gameEnd: GameEndPayload, winnerName: string): string {
  const reason = reasonLabel(gameEnd.reason);
  return isBlunder(gameEnd.reason)
    ? `⭐ ${winnerName} の勝ち！ (相手の反則: ${reason})`
    : `⭐ ${winnerName} の勝ち！ (${reason})`;
}

export function drawText(gameEnd: GameEndPayload): string {
  return `🤝 引き分け (${reasonLabel(gameEnd.reason)})`;
}
