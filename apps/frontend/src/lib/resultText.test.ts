import { describe, it, expect } from 'vitest';
import type { GameEndPayload } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { drawText, reasonLabel, winnerText } from './resultText';

function makeEnd(reason: Reason, winner = Winner.COOL): GameEndPayload {
  return { winner, reason } as GameEndPayload;
}

describe('reasonLabel', () => {
  it('競技ルールの勝利条件どおりの表記を返す', () => {
    expect(reasonLabel(Reason.SCORE)).toBe('アイテム数');
    expect(reasonLabel(Reason.TRAPPED)).toBe('閉じ込め');
    expect(reasonLabel(Reason.CONFINED)).toBe('自縛');
    expect(reasonLabel(Reason.ATTACK)).toBe('アタック');
    expect(reasonLabel(Reason.COLLISION)).toBe('衝突');
  });

  // 競技ルールでは「中断」だが、フッターのリセットボタン (対戦中は「中断」) と紛れる
  it('FOULED は「通信エラー」と表示する', () => {
    expect(reasonLabel(Reason.FOULED)).toBe('通信エラー');
  });

  it('決着していない理由 (NONE) は空文字', () => {
    expect(reasonLabel(Reason.NONE)).toBe('');
  });
});

describe('winnerText', () => {
  it('相手を仕留めた決着は理由をそのまま添える', () => {
    expect(winnerText(makeEnd(Reason.ATTACK), 'あかり')).toBe('⭐ あかり の勝ち！ (アタック)');
  });

  // 反則決着でも敗者視点の LOSE 表記にはせず、常に勝者視点の文言にする
  it('反則決着は「相手の反則」と添える', () => {
    expect(winnerText(makeEnd(Reason.CONFINED), 'あかり')).toBe('⭐ あかり の勝ち！ (相手の反則: 自縛)');
    expect(winnerText(makeEnd(Reason.COLLISION), 'あかり')).toBe('⭐ あかり の勝ち！ (相手の反則: 衝突)');
    expect(winnerText(makeEnd(Reason.FOULED), 'あかり')).toBe('⭐ あかり の勝ち！ (相手の反則: 通信エラー)');
  });

  it('閉じ込め (相手を追い詰めた側) は反則扱いにしない', () => {
    expect(winnerText(makeEnd(Reason.TRAPPED), 'あかり')).toBe('⭐ あかり の勝ち！ (閉じ込め)');
  });
});

describe('drawText', () => {
  it('引き分けは決着理由を添える', () => {
    expect(drawText(makeEnd(Reason.SCORE, Winner.DRAW))).toBe('🤝 引き分け (アイテム数)');
  });
});
