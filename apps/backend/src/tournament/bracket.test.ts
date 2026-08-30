import { describe, it, expect } from 'vitest';
import type { MatchSlotRef, ParticipantDef, TournamentMatch } from '@u15/ws-types';
import { balanceBracketHalves, bracketSizeFor, seedOrder } from '@u15/ws-types';
import { buildBracket, orderBySeed, sideCoin } from './bracket.js';
import { captureResult, confirmResult, resolveMatches } from './progress.js';

function people(n: number): ParticipantDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`,
    name: `プレイヤー${i + 1}`,
    seed: i + 1,
    program: null,
  }));
}

const OPTS = { thirdPlaceMatch: false };

/** その枠の participantId (bye など、参加者でない枠は null) */
const idOf = (ref: MatchSlotRef): string | null =>
  ref.kind === 'participant' ? ref.participantId : null;

/** その枠の選手番号。参加者でない枠は最下位 (Infinity) */
const seedIn = (ref: MatchSlotRef): number =>
  ref.kind === 'participant' ? Number(ref.participantId.slice(1)) : Infinity;

/** そのカードの実参加者数 (0..2) */
const headsOf = (m: TournamentMatch): number =>
  (m.slotA.kind === 'participant' ? 1 : 0) + (m.slotB.kind === 'participant' ? 1 : 0);

/** 1回戦のカードを [先攻, 後攻] の participantId で。**buildBracket が組んだ順** */
const firstRoundPairs = (ms: TournamentMatch[]): (string | null)[][] =>
  ms.filter(m => m.stage === 0).map(m => [idOf(m.slotA), idOf(m.slotB)]);

describe('seedOrder', () => {
  it('標準シード順を生成する', () => {
    expect(seedOrder(1)).toEqual([1]);
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
});

describe('bracketSizeFor', () => {
  it('参加者数を収める最小の2の冪を返す', () => {
    expect(bracketSizeFor(2)).toBe(2);
    expect(bracketSizeFor(3)).toBe(4);
    expect(bracketSizeFor(5)).toBe(8);
    expect(bracketSizeFor(8)).toBe(8);
    expect(bracketSizeFor(9)).toBe(16);
  });
});

describe('balanceBracketHalves', () => {
  const bye = (x: number | null) => x === null;

  it('左半分のほうが少ないときだけ左右を入れ替える', () => {
    // 左1/右2 → 入れ替える
    expect(balanceBracketHalves([1, null, 2, 3], bye)).toEqual([2, 3, 1, null]);
    // 左2/右1 → そのまま
    expect(balanceBracketHalves([2, 3, 1, null], bye)).toEqual([2, 3, 1, null]);
    // 同数 → そのまま (左右対称を崩さない)
    expect(balanceBracketHalves([1, 4, 2, 3], bye)).toEqual([1, 4, 2, 3]);
  });

  it('長さが2の冪でない・2未満なら何もしない', () => {
    expect(balanceBracketHalves([1], bye)).toEqual([1]);
    expect(balanceBracketHalves([], bye)).toEqual([]);
    expect(balanceBracketHalves([1, null, 2], bye)).toEqual([1, null, 2]);
  });
});

describe('orderBySeed', () => {
  it('seed 指定者が昇順で先、未指定者は記載順で後ろ', () => {
    const ps: ParticipantDef[] = [
      { id: 'c', name: 'C', program: null },
      { id: 'a', name: 'A', seed: 1, program: null },
      { id: 'd', name: 'D', program: null },
      { id: 'b', name: 'B', seed: 5, program: null },   // 飛び番でも順序関係だけ使う
    ];
    expect(orderBySeed(ps).map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('sideCoin', () => {
  it('同じ種なら何度呼んでも同じ結果 (Math.random ではなく決定的)', () => {
    const a = sideCoin('cup-1:SF1');
    expect(sideCoin('cup-1:SF1')).toBe(a);
    expect(sideCoin('cup-1:SF1')).toBe(a);
  });

  it('種が違えば結果が変わりうる (大会・試合ごとに独立して決まる)', () => {
    const results = new Set([
      sideCoin('cup-1:SF1'), sideCoin('cup-1:SF2'), sideCoin('cup-2:SF1'), sideCoin('cup-3:FINAL'),
    ]);
    // 4通り全部が同じ値になる (=定数関数) ことはない、というだけの緩い確認
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('buildBracket', () => {
  it('8人フルシードは 1-8 / 4-5 | 3-6 / 2-7 で組まれる (左右は点対称)', () => {
    // 左山と右山は線対称ではなく点対称なので、第1シードが左上なら第2シードは右下。
    // 標準シード順そのものは 1-8 / 4-5 | 2-7 / 3-6 で、右山のカードの順だけが反転する
    expect(firstRoundPairs(buildBracket(people(8), OPTS))).toEqual([
      ['p01', 'p08'],
      ['p04', 'p05'],
      ['p03', 'p06'],
      ['p02', 'p07'],
    ]);
  });

  it('16人は上下のサブブロック同士も点対称になる', () => {
    // 標準シード順は 1-16/8-9/4-13/5-12 | 2-15/7-10/3-14/6-11 (線対称)。
    // 各ブロックの下半分のカードの順を再帰的に反転するので、左山の中でも
    // 上のサブブロックは第1シードが上、下のサブブロックは第4シードが下に来る
    expect(firstRoundPairs(buildBracket(people(16), OPTS))).toEqual([
      ['p01', 'p16'], ['p08', 'p09'], ['p05', 'p12'], ['p04', 'p13'],   // 左山 (上→下)
      ['p03', 'p14'], ['p06', 'p11'], ['p07', 'p10'], ['p02', 'p15'],   // 右山 (上→下)
    ]);
  });

  it('どのブロックでも、上のサブブロックは最強シードが先頭・下は最終カードに来る', () => {
    // これが「向かい合うブロックは点対称」ということ
    for (const n of [4, 8, 16, 32]) {
      const cards = buildBracket(people(n), OPTS)
        .filter(m => m.stage === 0)
        .map(m => [seedIn(m.slotA), seedIn(m.slotB)]);
      const walk = (list: number[][], path: string) => {
        if (list.length < 2) return;
        const h = list.length / 2;
        const up = list.slice(0, h), down = list.slice(h);
        const best = (x: number[][]) => Math.min(...x.flat());
        expect({ n, path, 上: up[0]!.includes(best(up)) }).toEqual({ n, path, 上: true });
        expect({ n, path, 下: down[down.length - 1]!.includes(best(down)) })
          .toEqual({ n, path, 下: true });
        walk(up, path + '上');
        walk(down, path + '下');
      };
      walk(cards, '');
    }
  });

  it('点対称にしても対戦の組み合わせは変わらない (第1・第2シードは決勝まで当たらない)', () => {
    // 山の中の反転なので、どのカードも中身は標準シード順のまま
    const cards = firstRoundPairs(buildBracket(people(8), OPTS))
      .map(pair => [...pair].sort().join('-'))
      .sort();
    expect(cards).toEqual(['p01-p08', 'p02-p07', 'p03-p06', 'p04-p05']);
  });

  it('7人は左右を入れ替えて左山を多くする (3-6 / 2-7 | 4-5 / 1-bye)', () => {
    // 標準シード順のままだと左3人・右4人になる。表は左山から実施するので、
    // 空いているほうを先に消化する形になってしまう。山の中も同じ規則で整えるので、
    // bye のカードはその山のいちばん下に来る
    expect(firstRoundPairs(buildBracket(people(7), OPTS))).toEqual([
      ['p03', 'p06'],
      ['p02', 'p07'],
      ['p04', 'p05'],
      ['p01', null],
    ]);
  });

  it('不戦のカードは試合番号を消費しない', () => {
    // 5人ならサイズ8・bye3つで、実際に戦うのは 4位-5位 の1試合だけ。
    // 不戦にも番号を振ると「第4試合しか行われない」という表示になってしまう
    const first = buildBracket(people(5), OPTS).filter(m => m.stage === 0);
    const real  = first.filter(m => m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye');
    const byes  = first.filter(m => m.slotA.kind === 'bye' || m.slotB.kind === 'bye');
    expect(real).toHaveLength(1);
    expect(real[0]!.label).toBe('準々決勝 第1試合');
    // 不戦は回戦名だけ。番号を名乗らせない
    for (const m of byes) expect(m.label).toBe('準々決勝');
  });

  it('開始時に両者が決まっているカードへ、勝ち上がり待ちより先の番号を振る', () => {
    // 9人はサイズ16・bye7つ。1回戦の実戦は 8位-9位 の1試合だけで、2回戦は
    //   1位-(8位/9位の勝者) … 下の回戦の勝ち上がり待ち
    //   2位-7位 / 3位-6位 / 4位-5位 … 不戦で上がった者どうし = 開始時点で両者確定
    // が混ざる。弱いほうの選手が弱い順だけで決めると勝ち上がり待ちが第1試合になり、
    // 8位-9位を戦ったばかりの選手が連戦、残る6人は待ちぼうけになる
    const ms = resolveMatches(buildBracket(people(9), OPTS));
    const cards = ms.filter(m => m.stage === 1)
      .sort((a, b) => a.no! - b.no!)
      .map(m => `${m.resolvedA ?? '?'}v${m.resolvedB ?? '?'}`);
    expect(cards).toEqual([
      'p02vp07', 'p03vp06', 'p04vp05',   // 開始時に両者が決まっているカード (上位が先攻)
      'p01v?',                           // 8位-9位 の勝者待ち
    ]);
  });

  it('bye が無ければ番号付けは従来どおり (混在が起きるのは実質2回戦だけ)', () => {
    // フルシードではどの段も「開始時に確定」の別が一様なので、番号は弱いほうの
    // 選手が弱い順そのまま = 再帰的点対称 (16人の1回戦は表の上から 1 8 5 4 3 6 7 2)
    const nos = buildBracket(people(16), OPTS).filter(m => m.stage === 0).map(m => m.no);
    expect(nos).toEqual([1, 8, 5, 4, 3, 6, 7, 2]);
  });

  it('不戦の枠は、上がる選手を先攻に固定する', () => {
    // 対戦は行われないのでどちらでもよいが、固定したほうが組み合わせ表・CSV が読みやすい。
    // 1ゲーム制のコイントスにも左右されないこと
    for (const sideSeed of [undefined, 'cup-a', 'cup-b']) {
      const opts = sideSeed === undefined ? OPTS : { ...OPTS, sideSeed };
      const byes = buildBracket(people(5), opts)
        .filter(m => (m.slotA.kind === 'bye') !== (m.slotB.kind === 'bye'));
      expect(byes.length).toBeGreaterThan(0);
      for (const m of byes) {
        expect({ sideSeed, a: m.slotA.kind, b: m.slotB.kind })
          .toEqual({ sideSeed, a: 'participant', b: 'bye' });
      }
    }
  });

  it('不戦通過者は次の回戦で必ず先攻になる (2ゲーム制)', () => {
    // 不戦で上がった選手同士が当たるカードでは、上位シードが先攻・下位シードが後攻
    const sidesOf = (n: number) => {
      const ms     = buildBracket(people(n), OPTS);
      const byeIds = new Map(ms
        .filter(m => (m.slotA.kind === 'bye') !== (m.slotB.kind === 'bye'))
        .map(m => [m.id, Number((m.slotA as { participantId: string }).participantId.slice(1))]));
      const out: { seed: number; side: string }[] = [];
      for (const m of ms) {
        for (const [side, ref] of [['先攻', m.slotA], ['後攻', m.slotB]] as const) {
          if (ref.kind !== 'winner-of') continue;
          const seed = byeIds.get(ref.matchId);
          if (seed !== undefined) out.push({ seed, side });
        }
      }
      return out.sort((a, b) => a.seed - b.seed);
    };

    // 6人 = bye2つ。相手はどちらも1回戦の勝者なので、両方とも先攻
    expect(sidesOf(6)).toEqual([
      { seed: 1, side: '先攻' }, { seed: 2, side: '先攻' },
    ]);
    // 9人 = bye7つ。1位-(8位/9位の勝者) 以外は不戦通過者同士なので、上位4人が先攻・
    // 下位3人が後攻に割れる (2位-7位 / 3位-6位 / 4位-5位)
    expect(sidesOf(9)).toEqual([
      { seed: 1, side: '先攻' }, { seed: 2, side: '先攻' },
      { seed: 3, side: '先攻' }, { seed: 4, side: '先攻' },
      { seed: 5, side: '後攻' }, { seed: 6, side: '後攻' }, { seed: 7, side: '後攻' },
    ]);
  });

  it('開始時に両者が決まっているカードは、どの回戦でも上位シードが先攻 (2ゲーム制)', () => {
    // 1回戦は seedOrder の並びがそのまま (上位シードが slotA)、2回戦以降は
    // 不戦通過者同士のカードで assignSidesAfterWalkover が揃える。
    // 勝ち上がり待ちのカードは、誰が来るか決まっていないので対象外
    for (let n = 2; n <= 64; n++) {
      const ms = resolveMatches(buildBracket(people(n), { thirdPlaceMatch: true }));
      for (const m of ms) {
        if (m.byeA || m.byeB || m.resolvedA === null || m.resolvedB === null) continue;
        const seed = (id: string) => Number(id.slice(1));
        expect({ n, id: m.id, 上位が先攻: seed(m.resolvedA) < seed(m.resolvedB) })
          .toEqual({ n, id: m.id, 上位が先攻: true });
      }
    }
  });

  it('2ゲーム制では、先攻側の子カードが必ず上に来る (接続線が交差しない)', () => {
    for (let n = 2; n <= 32; n++) {
      const ms   = buildBracket(people(n), { thirdPlaceMatch: true });
      const byId = new Map(ms.map(m => [m.id, m]));
      for (const m of ms) {
        if (m.slotA.kind !== 'winner-of' || m.slotB.kind !== 'winner-of') continue;
        const a = byId.get(m.slotA.matchId)!;
        const b = byId.get(m.slotB.matchId)!;
        if (a.stage !== b.stage) continue;   // 3位決定戦は loser-of なので来ない
        expect({ n, id: m.id, 先攻が上: a.order < b.order })
          .toEqual({ n, id: m.id, 先攻が上: true });
      }
    }
  });

  it('1ゲーム制は表の位置と先攻・後攻が無関係 (コイントスで並びが動かない)', () => {
    // 毎試合コイントスなので位置は追従させない。種を変えても表の並びは同じ
    const layout = (sideSeed?: string) => buildBracket(
      people(16), sideSeed === undefined ? OPTS : { ...OPTS, sideSeed })
      .filter(m => m.stage === 0)
      .sort((x, y) => x.order - y.order)
      .map(m => [m.slotA, m.slotB]
        .map(r => (r.kind === 'participant' ? Number(r.participantId.slice(1)) : 0))
        .sort((x, y) => x - y)
        .join('-'))
      .join(' ');
    expect(layout('cup-a')).toBe(layout());
    expect(layout('cup-b')).toBe(layout());
  });

  it('1ゲーム制では次の回戦の先攻・後攻は今までどおりコイントスで決まる', () => {
    // 「試合ごとにランダムに決める」仕様は変えていない。種を変えれば並びも変わりうる
    const sfSides = (sideSeed: string) => buildBracket(people(6), { ...OPTS, sideSeed })
      .filter(m => m.stage === 1)
      .map(m => `${m.slotA.kind === 'winner-of' ? m.slotA.matchId : '-'}`)
      .join(',');
    const seen = new Set([sfSides('cup-a'), sfSides('cup-b'), sfSides('cup-c')]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('どの人数でも、対戦するカードの試合番号が 1..k で詰まっている', () => {
    for (let n = 2; n <= 32; n++) {
      const first = buildBracket(people(n), OPTS).filter(m => m.stage === 0);
      if (first.length === 0) continue;
      const nos = first
        .filter(m => m.slotA.kind !== 'bye' && m.slotB.kind !== 'bye')
        .map(m => m.no!)
        .sort((a, b) => a - b);
      expect({ n, nos }).toEqual({ n, nos: nos.map((_, i) => i + 1) });
    }
  });

  // 以下2つは**配置規則の出力 (buildBracket が組んだ順)** を見る。表示位置 (order) は
  // このあと alignDisplayToSides が先攻・後攻に合わせて動かすことがあるが、
  // 入れ替わるのは必ず不戦のカード (表では非表示) との間なので、実戦のカードの
  // 相対順序はこの順のまま
  it('どのブロックでも上 (左) の人数が下 (右) を下回らない', () => {
    for (let n = 2; n <= 32; n++) {
      const heads = buildBracket(people(n), OPTS).filter(m => m.stage === 0).map(headsOf);
      if (heads.length < 2) continue;   // 2人は決勝1試合だけ
      // 根から葉へ、各ブロックで上半分 >= 下半分 を確かめる
      const walk = (list: number[], path: string) => {
        if (list.length < 2) return;
        const h = list.length / 2;
        const sum = (xs: number[]) => xs.reduce((a, c) => a + c, 0);
        const up = sum(list.slice(0, h)), down = sum(list.slice(h));
        expect({ n, path, ok: up >= down }).toEqual({ n, path, ok: true });
        walk(list.slice(0, h), path + '上');
        walk(list.slice(h), path + '下');
      };
      walk(heads, '');
    }
  });

  it('どの人数でも左山の人数が右山を下回らない', () => {
    for (let n = 2; n <= 16; n++) {
      const first = buildBracket(people(n), OPTS).filter(m => m.stage === 0);
      if (first.length < 2) continue;   // 2人は決勝1試合だけで、左右の山に分かれない
      const heads = first.map(headsOf);
      const half  = heads.length / 2;
      const left  = heads.slice(0, half).reduce((a, c) => a + c, 0);
      const right = heads.slice(half).reduce((a, c) => a + c, 0);
      expect({ n, left, right }).toEqual({ n, left: Math.max(left, right), right });
    }
  });

  it('運営が手で組んだ並び (slots) は左が少なくても入れ替えない', () => {
    const pairs = firstRoundPairs(
      buildBracket(people(3), { ...OPTS, slots: ['p01', null, 'p02', 'p03'] }));
    expect(pairs).toEqual([['p01', null], ['p02', 'p03']]);
  });

  it('8人ならラウンドは 1回戦/準決勝/決勝 の3段・計7試合', () => {
    const ms = buildBracket(people(8), OPTS);
    expect(ms).toHaveLength(7);
    expect(ms.filter(m => m.stage === 0)).toHaveLength(4);
    expect(ms.filter(m => m.stage === 1)).toHaveLength(2);
    expect(ms.filter(m => m.stage === 2)).toHaveLength(1);
    expect(ms.find(m => m.stage === 2)!.id).toBe('FINAL');
    expect(ms.filter(m => m.stage === 1).map(m => m.id)).toEqual(['SF1', 'SF2']);
  });

  it('5人ならサイズ8・bye3つで、bye同士のカードは1つも出ない', () => {
    const first = buildBracket(people(5), OPTS).filter(m => m.stage === 0);
    expect(first).toHaveLength(4);

    const byeCount = first.reduce((n, m) =>
      n + (m.slotA.kind === 'bye' ? 1 : 0) + (m.slotB.kind === 'bye' ? 1 : 0), 0);
    expect(byeCount).toBe(3);

    const bothBye = first.filter(m => m.slotA.kind === 'bye' && m.slotB.kind === 'bye');
    expect(bothBye).toHaveLength(0);
  });

  it('2人なら決勝1試合だけ', () => {
    const ms = buildBracket(people(2), OPTS);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.id).toBe('FINAL');
    expect(ms[0]!.label).toBe('決勝');
  });

  it('1人・0人では試合が成立しない', () => {
    expect(buildBracket(people(1), OPTS)).toEqual([]);
    expect(buildBracket([], OPTS)).toEqual([]);
  });

  it('thirdPlaceMatch は準決勝2つの loser-of を参照する', () => {
    const ms = buildBracket(people(4), { thirdPlaceMatch: true });
    const third = ms.find(m => m.id === 'THIRD');
    expect(third).toBeDefined();
    expect(third!.slotA).toEqual({ kind: 'loser-of', matchId: 'SF1' });
    expect(third!.slotB).toEqual({ kind: 'loser-of', matchId: 'SF2' });
    expect(third!.label).toBe('3位決定戦');
  });

  it('2人では3位決定戦を作らない (準決勝が存在しない)', () => {
    const ms = buildBracket(people(2), { thirdPlaceMatch: true });
    expect(ms.find(m => m.id === 'THIRD')).toBeUndefined();
  });

  it('sideSeed を省略すると今まで通り slotA が常に若いシード側になる', () => {
    const ms = buildBracket(people(2), OPTS);
    expect(ms[0]!.slotA).toEqual({ kind: 'participant', participantId: 'p01' });
    expect(ms[0]!.slotB).toEqual({ kind: 'participant', participantId: 'p02' });
  });

  it('sideSeed を渡すと試合ごとのコイントスで slotA/slotB が入れ替わりうる', () => {
    // sideCoin('cup-b:FINAL') は false (入れ替えなし)、sideCoin('cup-a:FINAL') は true (入れ替え)
    const noSwap = buildBracket(people(2), { ...OPTS, sideSeed: 'cup-b' })[0]!;
    expect(noSwap.slotA).toEqual({ kind: 'participant', participantId: 'p01' });
    expect(noSwap.slotB).toEqual({ kind: 'participant', participantId: 'p02' });

    const swapped = buildBracket(people(2), { ...OPTS, sideSeed: 'cup-a' })[0]!;
    expect(swapped.slotA).toEqual({ kind: 'participant', participantId: 'p02' });
    expect(swapped.slotB).toEqual({ kind: 'participant', participantId: 'p01' });
  });

  it('明示 slots を尊重する', () => {
    const ms = buildBracket(people(4), {
      thirdPlaceMatch: false,
      slots: ['p03', 'p01', 'p02', 'p04'],
    });
    expect(firstRoundPairs(ms)).toEqual([['p03', 'p01'], ['p02', 'p04']]);
  });

  it('明示 slots で両側 bye になったカードも詰まらず下流へ伝播する', () => {
    // 手書きの slots では自動生成と違い bye 同士が起こりうる
    const ms = resolveMatches(buildBracket(people(2), {
      thirdPlaceMatch: false,
      slots: ['p01', 'p02', null, null],
    }));

    // 試合番号は「弱いほうの選手が弱い順」なので、bye 同士 (= 最も弱い) のカードが第1試合に
    // なる。id で引くと入れ替わるため、ここは中身で引く
    const empty = ms.find(m => m.slotA.kind === 'bye' && m.slotB.kind === 'bye')!;
    expect(empty.byeA).toBe(true);
    expect(empty.byeB).toBe(true);
    expect(empty.status).toBe('done');
    expect(empty.result!.winnerSide).toBeNull();

    const real = ms.find(m => m.stage === 0 && m.id !== empty.id)!;

    // 決勝は実カードの結果待ちなのでまだ pending。ただし bye 同士の側は
    // 「勝者不在の枠」= bye と解決済み
    const final = ms.find(m => m.id === 'FINAL')!;
    expect(final.byeB).toBe(true);
    expect(final.status).toBe('pending');

    // 実カードが決まれば、決勝は不戦勝として自動確定し詰まらない
    const done = resolveMatches(confirmResult(
      captureResult(ms, real.id, {
        roundResults: [], set: null, decidedBy: 'wins', winnerSide: 0, capturedAt: 1,
      }),
      real.id, {},
    ));
    const final2 = done.find(m => m.id === 'FINAL')!;
    expect(final2.status).toBe('done');
    expect(final2.result!.decidedBy).toBe('walkover');
    expect(final2.resolvedA).toBe('p01');
  });
});
