import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { GameStateSnapshot, RoundResult, ServerStatusPayload } from '@u15/ws-types';
import { Reason, Winner } from '@u15/ws-types';
import { PlayerSidePanel } from './PlayerSidePanel';
import { PENALTY_COLOR, WIN_BASE } from '../styles/tokens';

// 2試合制パネルの明細表示の検証。ボーナスの符号と色 (加点=ミント / 減点=オレンジ) は
// 決着理由に依存するため、CPU 対戦では狙って再現しづらい。ここでラウンド結果を直接
// 与えて、アイテム + 一撃 + 総取り = 小計 の足し算と、勝敗数の表示を固定する。

function makeRound(round: 0 | 1, over: Partial<RoundResult> = {}): RoundResult {
  return {
    round,
    winner:         Winner.COOL,
    reason:         Reason.SCORE,
    scores:         [0, 0],
    remainingTurns: 0,
    strikeBonus:    [0, 0],
    sweepBonus:     [0, 0],
    playerNames:    ['A', 'B'],
    ...over,
  };
}

function makeStatus(over: Partial<ServerStatusPayload> = {}): ServerStatusPayload {
  const client = { type: 'cpu', state: 'ready', name: 'CPU', ip: '127.0.0.1', port: 0 } as const;
  return {
    phase: 'finished', localIP: '127.0.0.1',
    clients: [{ ...client }, { ...client }],
    doubleMode: true, repeatMode: false, demoMode: false,
    currentRound: 1, roundResults: [], darkMode: false,
    mapSource: { kind: 'random' } as ServerStatusPayload['mapSource'],
    ...over,
  };
}

const snapshot: GameStateSnapshot = {
  field: [[0]], size: { x: 1, y: 1 },
  teamPos: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  teamScore: [0, 0], turnCount: 0, leaveItems: 0,
  playerNames: ['A', 'B'],
};

/** jsdom は style.color を rgb() 表記に正規化するため、比較する側も揃える */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** 「一撃」などのラベルに対応する値セル (直後の兄弟要素) を取り出す */
function rowsOf(container: HTMLElement): { label: string; value: string; color: string }[] {
  return [...container.querySelectorAll('span')]
    .filter(sp => ['アイテム', '一撃', '総取り', '小計', '合計'].includes(sp.textContent ?? ''))
    .map(sp => {
      const v = sp.nextElementSibling as HTMLElement | null;
      return { label: sp.textContent ?? '', value: v?.textContent ?? '', color: v?.style.color ?? '' };
    });
}

function renderPanel(side: 0 | 1, roundResults: RoundResult[], over: Partial<ServerStatusPayload> = {}) {
  // maxHeight=0 で高さ実測による縮小補正 (jsdom では scrollHeight が常に 0) を止め、
  // 表示内容そのものだけを検証する
  return render(
    <PlayerSidePanel
      side={side} snapshot={snapshot}
      serverStatus={makeStatus({ roundResults, ...over })}
      width={200} maxHeight={0}
    />,
  );
}

describe('PlayerSidePanel (2試合制)', () => {
  it('アタック勝ちのラウンドは 一撃 +50pt をミント色で出し、小計に足し込む', () => {
    // 第1試合を COOL (= side 0) がアタックで勝利。残アイテム 8 → 総取り 48
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.ATTACK,
      scores: [7, 4], strikeBonus: [50, 0], sweepBonus: [48, 0],
    });
    const rows = rowsOf(renderPanel(0, [rr]).container);

    expect(rows.slice(0, 4)).toEqual([
      { label: 'アイテム', value: '70pt',  color: expect.any(String) },
      { label: '一撃',     value: '+50pt', color: rgb(WIN_BASE) },
      { label: '総取り',   value: '+48pt', color: rgb(WIN_BASE) },
      { label: '小計',     value: '168pt', color: expect.any(String) },
    ]);
  });

  it('自滅で負けたラウンドは 一撃 の減点をオレンジで出す', () => {
    // 第1試合を COOL が勝ち、HOT (= side 1) が衝突負け → -3×4 = -12
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.COLLISION,
      scores: [7, 4], strikeBonus: [0, -12], sweepBonus: [48, 0],
    });
    const rows = rowsOf(renderPanel(1, [rr]).container);

    expect(rows.slice(0, 4)).toEqual([
      { label: 'アイテム', value: '40pt',  color: expect.any(String) },
      { label: '一撃',     value: '-12pt', color: rgb(PENALTY_COLOR) },
      { label: '総取り',   value: '0pt',   color: expect.any(String) },
      { label: '小計',     value: '28pt',  color: expect.any(String) },
    ]);
  });

  it('未確定 (試合中) の一撃・総取りは — で出す', () => {
    const live = renderPanel(0, [], { phase: 'playing', currentRound: 0 });
    const liveRows = rowsOf(live.container);
    expect(liveRows.find(r => r.label === '一撃')?.value).toBe('—');
    expect(liveRows.find(r => r.label === '総取り')?.value).toBe('—');
  });

  it('TOTAL は勝敗数と2試合の合計 (小計の和) を出す', () => {
    // side 0 から見て 2勝0敗。合計 = 168 + 100 = 268
    const round1 = makeRound(0, {
      winner: Winner.COOL, reason: Reason.ATTACK,
      scores: [7, 4], strikeBonus: [50, 0], sweepBonus: [48, 0],
    });
    // 第2試合は先後が入れ替わるので side 0 = HOT
    const round2 = makeRound(1, { winner: Winner.HOT, reason: Reason.SCORE, scores: [3, 10] });

    const { container } = renderPanel(0, [round1, round2]);
    expect(container.textContent).toContain('2勝0敗');
    expect(container.textContent).toContain('🏆 TOTAL');
    expect(rowsOf(container).find(r => r.label === '合計')?.value).toBe('268pt');
  });

  it('1勝1敗なら勝敗数は並び、合計ポイントで上回った側に 🏆 が付く', () => {
    const round1 = makeRound(0, { winner: Winner.COOL, scores: [12, 2] }); // side0: 120 / side1: 20
    const round2 = makeRound(1, { winner: Winner.COOL, scores: [5, 3] });  // side0(HOT): 30 / side1(COOL): 50

    const left  = renderPanel(0, [round1, round2]);
    const right = renderPanel(1, [round1, round2]);

    expect(left.container.textContent).toContain('1勝1敗');
    expect(right.container.textContent).toContain('1勝1敗');
    // 合計 150 vs 70 → side 0 の勝ち
    expect(left.container.textContent).toContain('🏆 TOTAL');
    expect(right.container.textContent).toContain('⭐ TOTAL');
  });

  it('引き分けたラウンドは勝敗数に入らず「分」で示す', () => {
    const round1 = makeRound(0, { winner: Winner.DRAW, scores: [5, 5] });
    const round2 = makeRound(1, { winner: Winner.COOL, scores: [7, 4] }); // COOL = side 1
    expect(renderPanel(0, [round1, round2]).container.textContent).toContain('0勝1敗1分');
    expect(renderPanel(1, [round1, round2]).container.textContent).toContain('1勝0敗1分');
  });
});

describe('PlayerSidePanel (1試合制)', () => {
  it('明細3行と合計ポイントを出し、勝敗数は出さない', () => {
    const rr = makeRound(0, {
      winner: Winner.COOL, reason: Reason.TRAPPED,
      scores: [6, 2], strikeBonus: [50, 0], sweepBonus: [36, 0],
    });
    const { container } = render(
      <PlayerSidePanel
        side={0} snapshot={snapshot}
        serverStatus={makeStatus({ doubleMode: false, currentRound: 0, roundResults: [rr] })}
        width={200} maxHeight={0}
      />,
    );

    const rows = rowsOf(container);
    expect(rows).toEqual([
      { label: 'アイテム', value: '60pt',  color: expect.any(String) },
      { label: '一撃',     value: '+50pt', color: rgb(WIN_BASE) },
      { label: '総取り',   value: '+36pt', color: rgb(WIN_BASE) },
    ]);
    expect(container.textContent).toContain('合計ポイント');
    expect(container.textContent).toContain('146pt'); // 60 + 50 + 36
    expect(container.textContent).not.toContain('勝');
  });
});
