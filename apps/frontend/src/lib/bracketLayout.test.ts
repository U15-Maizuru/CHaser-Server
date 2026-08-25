import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, TournamentMatch } from '@u15/ws-types';
import { bracketLayout } from './bracketLayout';

function m(
  id: string, stage: number, order: number, label: string,
  slotA: MatchSlotRef, slotB: MatchSlotRef,
): TournamentMatch {
  return {
    id, stage, order, label, slotA, slotB,
    resolvedA: null, resolvedB: null, byeA: false, byeB: false, status: 'pending',
  };
}

const P = (id: string): MatchSlotRef => ({ kind: 'participant', participantId: id });
const W = (id: string): MatchSlotRef => ({ kind: 'winner-of', matchId: id });
const L = (id: string): MatchSlotRef => ({ kind: 'loser-of', matchId: id });

/** 4人トーナメント (SF1, SF2 → FINAL) */
const FOUR = [
  m('SF1', 0, 0, '準決勝 第1試合', P('p1'), P('p4')),
  m('SF2', 0, 1, '準決勝 第2試合', P('p2'), P('p3')),
  m('FINAL', 1, 0, '決勝', W('SF1'), W('SF2')),
];

const OPTS = { cardW: 200, cardH: 60, gapX: 50, gapY: 20, padding: 10, headerH: 20 };

describe('bracketLayout', () => {
  it('空なら空のレイアウトを返す', () => {
    const l = bracketLayout([]);
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.width).toBe(0);
  });

  it('回戦ごとに列が分かれる', () => {
    const l = bracketLayout(FOUR, OPTS);
    const x = (id: string) => l.nodes.find(n => n.matchId === id)!.x;
    expect(x('SF1')).toBe(x('SF2'));
    expect(x('FINAL')).toBe(x('SF1') + 200 + 50);
  });

  it('1回戦は上から等間隔に並ぶ', () => {
    const l = bracketLayout(FOUR, OPTS);
    const sf1 = l.nodes.find(n => n.matchId === 'SF1')!;
    const sf2 = l.nodes.find(n => n.matchId === 'SF2')!;
    expect(sf2.y - sf1.y).toBe(60 + 20);
  });

  it('親カードは子2つの中点に置かれる', () => {
    const l = bracketLayout(FOUR, OPTS);
    const c = (id: string) => {
      const n = l.nodes.find(x => x.matchId === id)!;
      return n.y + n.h / 2;
    };
    expect(c('FINAL')).toBeCloseTo((c('SF1') + c('SF2')) / 2, 5);
  });

  it('接続線は子の右端から親の左端へ引かれる', () => {
    const l = bracketLayout(FOUR, OPTS);
    expect(l.edges).toHaveLength(2);

    const sf1   = l.nodes.find(n => n.matchId === 'SF1')!;
    const final = l.nodes.find(n => n.matchId === 'FINAL')!;
    const edge  = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;

    expect(edge.d.startsWith(`M ${sf1.x + sf1.w} ${sf1.y + sf1.h / 2}`)).toBe(true);
    expect(edge.d.endsWith(`H ${final.x}`)).toBe(true);
  });

  it('参加者スロットには線を引かない', () => {
    const l = bracketLayout([m('ONLY', 0, 0, '決勝', P('a'), P('b'))], OPTS);
    expect(l.edges).toEqual([]);
  });

  it('列見出しは回戦名になる (「第N試合」は落とす)', () => {
    const l = bracketLayout(FOUR, OPTS);
    expect(l.columns.map(c => c.label)).toEqual(['準決勝', '決勝']);
  });

  it('3位決定戦が決勝と同じ列でも重ならない', () => {
    const withThird = [
      ...FOUR,
      m('THIRD', 1, 1, '3位決定戦', L('SF1'), L('SF2')),
    ];
    const l = bracketLayout(withThird, OPTS);
    const final = l.nodes.find(n => n.matchId === 'FINAL')!;
    const third = l.nodes.find(n => n.matchId === 'THIRD')!;

    expect(third.x).toBe(final.x);
    // 縦に離れていること (どちらが上でもよい)
    const gap = Math.abs(third.y - final.y);
    expect(gap).toBeGreaterThanOrEqual(60 + 20);
  });

  // 審判裁定の注記が付くと MatchCard は cardH より縦に伸びる (matchCardHeight)。
  // 固定 cardH で押し下げを計算すると、伸びた決勝の下に3位決定戦が重なってしまう
  it('cardHeightOf で実際の高さを渡すと、伸びたカードの下にも重ならない', () => {
    const withThird = [
      ...FOUR,
      m('THIRD', 1, 1, '3位決定戦', L('SF1'), L('SF2')),
    ];
    const TALL_FINAL_H = 60 + 15; // 裁定の注記ぶん伸びた決勝カードの高さ
    const l = bracketLayout(withThird, {
      ...OPTS,
      cardHeightOf: match => match.id === 'FINAL' ? TALL_FINAL_H : OPTS.cardH,
    });
    const final = l.nodes.find(n => n.matchId === 'FINAL')!;
    const third = l.nodes.find(n => n.matchId === 'THIRD')!;

    expect(final.h).toBe(TALL_FINAL_H);
    // 実際の高さ (固定 cardH ではなく) ぶんの隙間が空いていること = 重ならない
    expect(third.y).toBeGreaterThanOrEqual(final.y + final.h + OPTS.gapY);
  });

  it('bye を含む回戦でも全カードが配置される', () => {
    const withBye = [
      m('QF1', 0, 0, '準々決勝 第1試合', P('p1'), { kind: 'bye' }),
      m('QF2', 0, 1, '準々決勝 第2試合', P('p4'), P('p5')),
      m('SF1', 1, 0, '準決勝', W('QF1'), W('QF2')),
    ];
    const l = bracketLayout(withBye, OPTS);
    expect(l.nodes).toHaveLength(3);
    expect(l.edges).toHaveLength(2);
  });

  it('全体の幅は列数から決まる', () => {
    const l = bracketLayout(FOUR, OPTS);
    // padding*2 + 2列 + 列間1つ
    expect(l.width).toBe(10 * 2 + 2 * 200 + 50);
  });

  it('高さは一番下のカードを含む', () => {
    const l = bracketLayout(FOUR, OPTS);
    const bottom = Math.max(...l.nodes.map(n => n.y + n.h));
    expect(l.height).toBeGreaterThanOrEqual(bottom - l.nodes[0]!.y);
  });

  it('8人でも3列になる', () => {
    const eight: TournamentMatch[] = [
      ...[0, 1, 2, 3].map(i => m(`QF${i + 1}`, 0, i, `準々決勝 第${i + 1}試合`, P(`a${i}`), P(`b${i}`))),
      m('SF1', 1, 0, '準決勝 第1試合', W('QF1'), W('QF2')),
      m('SF2', 1, 1, '準決勝 第2試合', W('QF3'), W('QF4')),
      m('FINAL', 2, 0, '決勝', W('SF1'), W('SF2')),
    ];
    const l = bracketLayout(eight, OPTS);
    expect(l.columns).toHaveLength(3);
    expect(l.nodes).toHaveLength(7);
    expect(l.edges).toHaveLength(6);
  });
});
