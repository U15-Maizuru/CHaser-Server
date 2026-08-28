import type { TournamentMatch } from '@u15/ws-types';
import {
  COOL_COLOR, GOLD_BASE, HOT_COLOR, TEXT_MUTED, TURN_BASE, WIN_BASE,
} from '../../../ui';

// 試合状態 (TournamentMatch['status']) の日本語ラベルと色。MatchCard (対戦1枚のカード) と
// MatchInfoCard (トーナメント表で対になる2枚のプレイヤーカードの間に挟む対戦カード) の
// どちらも同じ状態を表示するので、ラベル・色はここを唯一の情報源にする。

export const MATCH_STATUS_LABEL: Record<TournamentMatch['status'], string> = {
  pending:          '勝者待ち',
  ready:            '対戦確定',
  armed:            '準備完了',
  in_progress:      '対戦中',
  awaiting_confirm: '結果確認',
  done:             '試合終了',
};

export const MATCH_STATUS_COLOR: Record<TournamentMatch['status'], string> = {
  pending:          TEXT_MUTED,
  ready:            TURN_BASE,
  armed:            COOL_COLOR,
  in_progress:      HOT_COLOR,
  awaiting_confirm: GOLD_BASE,
  done:             WIN_BASE,
};

/**
 * 「これから行う試合」の枠を金色に脈打たせる共通アニメーション。MatchCard と PlayerCard の
 * 両方が `<style>{UPCOMING_KEYFRAMES}</style>` として使う。同じ @keyframes 名を2箇所が
 * 独自定義すると、内容がずれたときに気づきにくいのでここに集約する。
 */
export const UPCOMING_KEYFRAMES = `
@keyframes u15-upcoming {
  0%,100% { box-shadow: 0 0 0 2px ${GOLD_BASE}, 0 0 10px 2px rgba(221,170,34,0.35) }
  50%     { box-shadow: 0 0 0 3px ${GOLD_BASE}, 0 0 20px 6px rgba(221,170,34,0.65) }
}`;
