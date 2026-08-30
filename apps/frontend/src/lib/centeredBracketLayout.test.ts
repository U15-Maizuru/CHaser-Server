import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, TournamentMatch } from '@u15/ws-types';
import { centeredBracketLayout } from './centeredBracketLayout';

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

/** 4人トーナメント (SF1=左山, SF2=右山 → FINAL) */
const FOUR = [
  m('SF1', 0, 0, '準決勝 第1試合', P('p1'), P('p4')),
  m('SF2', 0, 1, '準決勝 第2試合', P('p2'), P('p3')),
  m('FINAL', 1, 0, '決勝', W('SF1'), W('SF2')),
];

const OPTS = { cardW: 200, cardH: 30, gapX: 50, gapY: 20, padding: 10, headerH: 20, matchInfoH: 10 };

function nodesOf(l: ReturnType<typeof centeredBracketLayout>, matchId: string) {
  return {
    side0: l.nodes.find(n => n.matchId === matchId && n.side === 0)!,
    side1: l.nodes.find(n => n.matchId === matchId && n.side === 1)!,
  };
}

function matchNodeOf(l: ReturnType<typeof centeredBracketLayout>, matchId: string) {
  return l.matchNodes.find(n => n.matchId === matchId)!;
}

describe('centeredBracketLayout', () => {
  it('空なら空のレイアウトを返す', () => {
    const l = centeredBracketLayout([]);
    expect(l.nodes).toEqual([]);
    expect(l.matchNodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.width).toBe(0);
  });

  it('1試合ごとに side0/side1 の2枚のプレイヤーカードと、対戦カード1枚になる', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    expect(l.nodes).toHaveLength(6);
    expect(l.matchNodes).toHaveLength(3);
  });

  it('試合番号の小さい山が左、大きい山が右に置かれる', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const sf1 = nodesOf(l, 'SF1').side0;
    const sf2 = nodesOf(l, 'SF2').side0;
    const final = nodesOf(l, 'FINAL').side0;
    expect(sf1.x).toBeLessThan(final.x);
    expect(final.x).toBeLessThan(sf2.x);
  });

  it('同じ試合の side0/side1 は同じ x、間に対戦カードを挟んで side1 が下に来る', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const { side0, side1 } = nodesOf(l, 'SF1');
    const info = matchNodeOf(l, 'SF1');
    expect(side0.x).toBe(side1.x);
    expect(info.x).toBe(side0.x);
    expect(info.y).toBe(side0.y + side0.h);
    expect(side1.y).toBe(info.y + info.h);
  });

  it('決勝の slotA/slotB が入れ替わっていても、左右の山は入れ替わらない', () => {
    // 1ゲーム制では bracket.ts の sideCoin が決勝の先攻・後攻をコイントスで決めるため、
    // FINAL の slotA が SF2 を指すことがある。これで表が左右反転すると、試合番号順に
    // 進める運営 (compareByPlayOrder) が右山から始まってしまう
    const swapped = [
      FOUR[0]!, FOUR[1]!,
      m('FINAL', 1, 0, '決勝', W('SF2'), W('SF1')),
    ];
    const l = centeredBracketLayout(swapped, OPTS);
    const sf1 = nodesOf(l, 'SF1').side0;
    const sf2 = nodesOf(l, 'SF2').side0;
    const final = nodesOf(l, 'FINAL').side0;
    expect(sf1.x).toBeLessThan(final.x);
    expect(final.x).toBeLessThan(sf2.x);
  });

  it('決勝は左右の準決勝の中点に置かれる', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const centerOf = (id: string) => {
      const { side0, side1 } = nodesOf(l, id);
      const top = Math.min(side0.y, side1.y);
      const bottom = Math.max(side0.y + side0.h, side1.y + side1.h);
      return (top + bottom) / 2;
    };
    expect(centerOf('FINAL')).toBeCloseTo((centerOf('SF1') + centerOf('SF2')) / 2, 5);
  });

  it('左山からの接続線は子の右端→親の左端、右山からは子の左端→親の右端', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const sf1 = nodesOf(l, 'SF1').side0;
    const sf2 = nodesOf(l, 'SF2').side0;
    const final = nodesOf(l, 'FINAL').side0;

    const edgeFromLeft  = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;
    const edgeFromRight = l.edges.find(e => e.from === 'SF2' && e.to === 'FINAL')!;

    expect(edgeFromLeft.d.startsWith(`M ${sf1.x + sf1.w}`)).toBe(true);
    expect(edgeFromLeft.d.endsWith(`H ${final.x}`)).toBe(true);

    expect(edgeFromRight.d.startsWith(`M ${sf2.x}`)).toBe(true);
    expect(edgeFromRight.d.endsWith(`H ${final.x + final.w}`)).toBe(true);
  });

  it('参加者スロットには線を引かない', () => {
    const l = centeredBracketLayout([m('ONLY', 0, 0, '決勝', P('a'), P('b'))], OPTS);
    expect(l.edges).toEqual([]);
  });

  it('参加者2人 (決勝のみ) でも1組として配置される', () => {
    const l = centeredBracketLayout([m('ONLY', 0, 0, '決勝', P('a'), P('b'))], OPTS);
    expect(l.nodes).toHaveLength(2);
    expect(l.matchNodes).toHaveLength(1);
  });

  it('3位決定戦は決勝と同じ列に、重ならず配置される', () => {
    const withThird = [
      ...FOUR,
      m('THIRD', 1, 1, '3位決定戦', L('SF1'), L('SF2')),
    ];
    const l = centeredBracketLayout(withThird, OPTS);
    const final = nodesOf(l, 'FINAL').side0;
    const third = nodesOf(l, 'THIRD').side0;

    expect(third.x).toBe(final.x);
    const gap = Math.abs(third.y - final.y);
    expect(gap).toBeGreaterThan(0);
  });

  it('不戦の試合 (byeA) への/からの線は hidden になる', () => {
    const withBye = FOUR.map(x => x.id === 'SF1' ? { ...x, byeB: true } : x);
    const l = centeredBracketLayout(withBye, OPTS);
    const edge = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;
    expect(edge.kind).toBe('hidden');
  });

  it('決着した試合は、対の中点ではなく勝者側のカードから線が出る', () => {
    const withResult = FOUR.map(x => x.id === 'SF1' ? {
      ...x, status: 'done' as const,
      result: {
        roundResults: [], set: null, decidedBy: 'wins' as const,
        winnerSide: 1 as const, capturedAt: 0,
      },
    } : x);
    const l = centeredBracketLayout(withResult, OPTS);
    const { side0, side1 } = nodesOf(l, 'SF1');
    const edge = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;

    const y1 = Number(edge.d.split(' ')[2]);
    // 勝者 (side1) の縦中心から出ている。中点 (side0/side1 の間) ではない
    expect(y1).toBeCloseTo(side1.y + side1.h / 2, 5);
    expect(y1).not.toBeCloseTo((side0.y + side1.y + side1.h) / 2, 5);
  });

  it('まだ決着していない試合は、対の中点から線が出る', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const { side0, side1 } = nodesOf(l, 'SF1');
    const edge = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;
    const y1 = Number(edge.d.split(' ')[2]);
    const pairCenter = (Math.min(side0.y, side1.y) + Math.max(side0.y + side0.h, side1.y + side1.h)) / 2;
    expect(y1).toBeCloseTo(pairCenter, 5);
  });

  it('線の親側は、決着に関わらずその参照が入る側 (slotA→side0 / slotB→side1) のカードへ繋ぐ', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    const finalSide0 = nodesOf(l, 'FINAL').side0;
    const finalSide1 = nodesOf(l, 'FINAL').side1;
    const fromSF1 = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!; // FINAL.slotA = W(SF1)
    const fromSF2 = l.edges.find(e => e.from === 'SF2' && e.to === 'FINAL')!; // FINAL.slotB = W(SF2)

    const y2Of = (d: string) => Number(d.match(/V ([\d.-]+)/)![1]);
    expect(y2Of(fromSF1.d)).toBeCloseTo(finalSide0.y + finalSide0.h / 2, 5);
    expect(y2Of(fromSF2.d)).toBeCloseTo(finalSide1.y + finalSide1.h / 2, 5);
  });

  it('実際に決着した勝ち上がりの線は decided になる', () => {
    const withResult = FOUR.map(x => x.id === 'SF1' ? {
      ...x, status: 'done' as const,
      result: {
        roundResults: [], set: null, decidedBy: 'wins' as const,
        winnerSide: 0 as const, capturedAt: 0,
      },
    } : x);
    const l = centeredBracketLayout(withResult, OPTS);
    const edge = l.edges.find(e => e.from === 'SF1' && e.to === 'FINAL')!;
    expect(edge.kind).toBe('decided');
  });

  it('3位決定戦への線 (loser-of) は、決着していても decided にせず、敗者側のカードから出す', () => {
    const withThird = [
      ...FOUR.map(x => x.id === 'SF1' ? {
        ...x, status: 'done' as const,
        result: {
          roundResults: [], set: null, decidedBy: 'wins' as const,
          winnerSide: 0 as const, capturedAt: 0,
        },
      } : x),
      m('THIRD', 1, 1, '3位決定戦', L('SF1'), L('SF2')),
    ];
    const l = centeredBracketLayout(withThird, OPTS);
    const { side1 } = nodesOf(l, 'SF1'); // winnerSide=0 なので敗者は side1
    const edge = l.edges.find(e => e.from === 'SF1' && e.to === 'THIRD')!;

    expect(edge.kind).toBe('pending');
    const y1 = Number(edge.d.split(' ')[2]);
    expect(y1).toBeCloseTo(side1.y + side1.h / 2, 5);
  });

  it('列見出しは左山・中央・右山ぶん (回戦名は「第N試合」を落とす)', () => {
    const l = centeredBracketLayout(FOUR, OPTS);
    expect(l.columns.map(c => c.label).sort()).toEqual(['準決勝', '決勝', '準決勝'].sort());
  });

  it('matchInfoHeightOf で対戦カードの高さが変わっても重ならない', () => {
    const withThird = [
      ...FOUR,
      m('THIRD', 1, 1, '3位決定戦', L('SF1'), L('SF2')),
    ];
    const TALL_INFO_H = 40;
    const l = centeredBracketLayout(withThird, {
      ...OPTS,
      matchInfoHeightOf: match => match.id === 'FINAL' ? TALL_INFO_H : OPTS.matchInfoH,
    });
    const final = nodesOf(l, 'FINAL');
    const finalInfo = matchNodeOf(l, 'FINAL');
    const third = nodesOf(l, 'THIRD').side0;

    expect(finalInfo.h).toBe(TALL_INFO_H);
    expect(final.side1.y).toBe(final.side0.y + final.side0.h + TALL_INFO_H);
    expect(third.y).toBeGreaterThanOrEqual(final.side1.y + final.side1.h + OPTS.gapY);
  });

  it('8人でも左右3列ずつ + 中央の決勝1列になる', () => {
    const eight: TournamentMatch[] = [
      ...[0, 1].map(i => m(`QFL${i + 1}`, 0, i, `準々決勝 第${i + 1}試合`, P(`a${i}`), P(`b${i}`))),
      ...[0, 1].map(i => m(`QFR${i + 1}`, 0, i + 2, `準々決勝 第${i + 3}試合`, P(`c${i}`), P(`d${i}`))),
      m('SFL', 1, 0, '準決勝 第1試合', W('QFL1'), W('QFL2')),
      m('SFR', 1, 1, '準決勝 第2試合', W('QFR1'), W('QFR2')),
      m('FINAL', 2, 0, '決勝', W('SFL'), W('SFR')),
    ];
    const l = centeredBracketLayout(eight, OPTS);
    // 左 (QFL列 + SFL列) + 中央 (決勝) + 右 (SFR列 + QFR列) = 5列
    expect(l.columns).toHaveLength(5);
    expect(l.nodes).toHaveLength(eight.length * 2);
    expect(l.matchNodes).toHaveLength(eight.length);

    const finalX = nodesOf(l, 'FINAL').side0.x;
    const sflX = nodesOf(l, 'SFL').side0.x;
    const sfrX = nodesOf(l, 'SFR').side0.x;
    const qfl1X = nodesOf(l, 'QFL1').side0.x;
    const qfr1X = nodesOf(l, 'QFR1').side0.x;

    expect(qfl1X).toBeLessThan(sflX);
    expect(sflX).toBeLessThan(finalX);
    expect(finalX).toBeLessThan(sfrX);
    expect(sfrX).toBeLessThan(qfr1X);
  });
});
