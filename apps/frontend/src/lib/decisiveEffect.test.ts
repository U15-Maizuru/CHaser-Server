import { describe, it, expect } from 'vitest';
import type { GameEndPayload } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { decisiveEffectFrom, type TeamMark } from './decisiveEffect';

function makeEnd(over: Partial<GameEndPayload> = {}): GameEndPayload {
  return {
    winner:      Winner.COOL,
    reason:      Reason.SCORE,
    playerNames: ['A', 'B'],
    finalScore:  [0, 0],
    ...over,
  };
}

/** 指定 role のマークを取り出す (存在しなければテストを失敗させる) */
function markOf(gameEnd: GameEndPayload, role: TeamMark['role']): TeamMark {
  const effect = decisiveEffectFrom(gameEnd);
  const mark   = effect?.marks.find(m => m.role === role);
  if (!mark) throw new Error(`role=${role} のマークが無い`);
  return mark;
}

// 演出のある決着理由 (Reason.NONE 以外のすべて)
const ALL_REASONS = [
  Reason.ATTACK, Reason.COLLISION, Reason.TRAPPED,
  Reason.CONFINED, Reason.FOULED, Reason.SCORE,
] as const;

describe('decisiveEffectFrom — 勝敗が必ず盤面に出る', () => {
  it.each(ALL_REASONS)('reason=%i でも勝者に 👑 が付く', (reason) => {
    const winner = markOf(makeEnd({ winner: Winner.COOL, reason }), 'winner');
    expect(winner).toMatchObject({ team: 0, badge: '👑', accent: 'gold', dim: false });
  });

  it.each(ALL_REASONS)('reason=%i でも敗者は暗転する', (reason) => {
    expect(markOf(makeEnd({ winner: Winner.COOL, reason }), 'loser').dim).toBe(true);
  });

  it.each(ALL_REASONS)('reason=%i のマークは勝者と敗者のちょうど2件', (reason) => {
    expect(decisiveEffectFrom(makeEnd({ winner: Winner.HOT, reason }))?.marks).toHaveLength(2);
  });
});

describe('decisiveEffectFrom — 敗者の導出', () => {
  it('COOL の勝ちなら敗者は HOT (index 1)', () => {
    const e = decisiveEffectFrom(makeEnd({ winner: Winner.COOL, reason: Reason.ATTACK }));
    expect(markOf(makeEnd({ winner: Winner.COOL, reason: Reason.ATTACK }), 'loser').team).toBe(1);
    expect(e?.marks.find(m => m.role === 'winner')?.team).toBe(0);
  });

  it('HOT の勝ちなら敗者は COOL (index 0)', () => {
    expect(markOf(makeEnd({ winner: Winner.HOT, reason: Reason.ATTACK }), 'loser').team).toBe(0);
    expect(markOf(makeEnd({ winner: Winner.HOT, reason: Reason.ATTACK }), 'winner').team).toBe(1);
  });
});

// 対になる決着理由 (アタック↔衝突、包囲↔自縛) が必ず見分けられることを担保する。
// 片方だけ確認すると「両方とも同じ見た目になっていた」という退行を見逃すため、必ず対で検証する。
describe('decisiveEffectFrom — アタックと衝突の区別', () => {
  const attack    = markOf(makeEnd({ winner: Winner.COOL, reason: Reason.ATTACK }),    'loser');
  const collision = markOf(makeEnd({ winner: Winner.COOL, reason: Reason.COLLISION }), 'loser');

  it('どちらも敗者の上にブロックを重ねる (shape は共通)', () => {
    expect(attack.shape).toBe('crush');
    expect(collision.shape).toBe('crush');
  });

  it('アタックは相手のせい、衝突は自滅として色分けされる', () => {
    expect(attack.accent).toBe('opponent');
    expect(collision.accent).toBe('warn');
  });

  it('バッジも別物になっている', () => {
    expect(attack.badge).not.toBe(collision.badge);
  });
});

describe('decisiveEffectFrom — 包囲と自縛の区別', () => {
  const trapped  = markOf(makeEnd({ winner: Winner.HOT, reason: Reason.TRAPPED }),  'loser');
  const confined = markOf(makeEnd({ winner: Winner.HOT, reason: Reason.CONFINED }), 'loser');

  it('どちらも周囲4マスの強調表示になる (shape は共通)', () => {
    expect(trapped.shape).toBe('surround');
    expect(confined.shape).toBe('surround');
  });

  it('包囲は相手のせい、自縛は自滅として色分けされる', () => {
    expect(trapped.accent).toBe('opponent');
    expect(confined.accent).toBe('warn');
  });

  it('バッジも別物になっている', () => {
    expect(trapped.badge).not.toBe(confined.badge);
  });
});

describe('decisiveEffectFrom — タイムアップ (アイテム数判定)', () => {
  it('kind は score になる', () => {
    expect(decisiveEffectFrom(makeEnd({ winner: Winner.HOT, reason: Reason.SCORE }))?.kind).toBe('score');
  });

  it('敗者はリングもバッジも持たず、暗転だけで負けを示す', () => {
    const loser = markOf(makeEnd({ winner: Winner.HOT, reason: Reason.SCORE }), 'loser');
    expect(loser).toMatchObject({ shape: 'none', accent: null, badge: null, dim: true });
  });

  it('勝者側は他の決着理由と同じ 👑 になる', () => {
    expect(markOf(makeEnd({ winner: Winner.HOT, reason: Reason.SCORE }), 'winner').badge).toBe('👑');
  });
});

describe('decisiveEffectFrom — 引き分け', () => {
  const effect = decisiveEffectFrom(makeEnd({ winner: Winner.DRAW, reason: Reason.SCORE }));

  it('両チームに同じ 🤝 の印が付く', () => {
    expect(effect?.marks).toHaveLength(2);
    expect(effect?.marks.map(m => m.team).sort()).toEqual([0, 1]);
    for (const m of effect!.marks) {
      expect(m).toMatchObject({ role: 'draw', badge: '🤝', accent: 'gold', dim: false });
    }
  });

  it('引き分けなので勝者・敗者のマークは無い', () => {
    expect(effect?.marks.some(m => m.role === 'winner' || m.role === 'loser')).toBe(false);
  });
});

describe('decisiveEffectFrom — 通信エラー', () => {
  it('敗者 (切断した側) に 📵 と自滅色が付く', () => {
    const loser = markOf(makeEnd({ winner: Winner.COOL, reason: Reason.FOULED }), 'loser');
    expect(loser).toMatchObject({ shape: 'none', accent: 'warn', badge: '📵', dim: true });
  });
});

describe('decisiveEffectFrom — 演出しないケース', () => {
  it('gameEnd が無ければ null', () => {
    expect(decisiveEffectFrom(null)).toBeNull();
  });

  it('reason が NONE なら null', () => {
    expect(decisiveEffectFrom(makeEnd({ winner: Winner.COOL, reason: Reason.NONE }))).toBeNull();
  });

  it('未決着 (CONTINUE) なら null', () => {
    expect(decisiveEffectFrom(makeEnd({ winner: Winner.CONTINUE, reason: Reason.ATTACK }))).toBeNull();
  });
});
