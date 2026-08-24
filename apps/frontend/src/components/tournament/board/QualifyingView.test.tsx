import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  StageRules,
  GroupStanding, ResolvedParticipant, StandingRow, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import { displayQualifyingPhase, QualifyingView, isQualifyingFinished, shouldShowFinale } from './QualifyingView';
import { QualifierSection } from '../qualifier/QualifierSection';

// 予選リーグ + 決勝トーナメントの見せ方。要点は2つ:
//   ① リーグ表には**そのリーグの試合と参加者だけ**を渡すこと
//   ② 予選の結果待ちの枠を「Aリーグ 1位」と書くこと (空欄だと何を待っているか伝わらない)

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function standing(participantId: string, rank: number, tied = false): StandingRow {
  return {
    participantId, played: 1, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, itemPoints: 0, strikePoints: 0, sweepPoints: 0,
    items: 0, remainingTurns: 0, rank, tied,
  };
}

const groups: GroupStanding[] = [
  {
    group: 0, label: 'A', participantIds: ['p1', 'p4', 'p5'],
    standings: [standing('p1', 1), standing('p4', 2), standing('p5', 3)],
  },
  {
    group: 1, label: 'B', participantIds: ['p2', 'p3'],
    standings: [standing('p2', 1), standing('p3', 2)],
  },
];

function groupMatch(group: number, a: string, b: string, done = false): TournamentMatch {
  return {
    id: `G${group + 1}-D1M1`, stage: 0, order: group, label: `${group}リーグ 第1節`, group,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: done ? 'done' : 'ready',
    ...(done ? { result: {
      roundResults: [], set: null, decidedBy: 'walkover' as const,
      winnerSide: 0 as const, capturedAt: 1, confirmedAt: 1,
    } } : {}),
  };
}

const FINAL: TournamentMatch = {
  id: 'FINAL', stage: 1, order: 0, label: '決勝',
  slotA: { kind: 'group-rank', group: 0, rank: 1 },
  slotB: { kind: 'group-rank', group: 1, rank: 1 },
  resolvedA: null, resolvedB: null, byeA: false, byeB: false, status: 'pending',
};

function state(
  done = false,
  opts: { confirmed?: boolean; displayView?: TournamentStatePayload['displayView'] } = {},
): TournamentStatePayload {
  const q = (group: number, rank: number, id: string, ambiguous = false) => ({
    group, rank, autoParticipantId: id, manualParticipantId: null, participantId: id,
    tied: ambiguous, ambiguous, pending: !done, bye: false,
  });
  return {
    tournamentId: 'cup', name: '予選あり杯', ruleSet: 'maizuru',
    match: { doubleMode: false },
    stage: stageRulesFor('group-then-bracket'),
    participants,
    matches: [groupMatch(0, 'p1', 'p4', done), groupMatch(1, 'p2', 'p3', done), FINAL],
    standings: null,
    groups,
    qualifiers: [q(0, 1, 'p1'), q(0, 2, 'p4', true), q(1, 1, 'p2'), q(1, 2, 'p3')],
    qualifierCandidates: [],
    qualifiersConfirmed: opts.confirmed ?? false,
    stageMaps: [null, null], thirdPlaceMapId: null, stageLabels: ['予選 第1節', '決勝'],
    displayView: opts.displayView ?? 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('isQualifyingFinished', () => {
  it('予選が全部確定して初めて true', () => {
    expect(isQualifyingFinished(state(false))).toBe(false);
    expect(isQualifyingFinished(state(true))).toBe(true);
  });
});

describe('displayQualifyingPhase — 決勝進出者の確定を待つ', () => {
  it('予選中は予選表 (据え置きの見出しは出さない)', () => {
    expect(displayQualifyingPhase(state(false))).toEqual({ phase: 'groups', holdingResult: false });
  });

  it('予選を持たない形式は常に決勝側 (でないと表彰画面が永久に出ない)', () => {
    for (const format of ['single-elimination', 'league'] as const) {
      const s = {
        ...state(true),
        stage:   stageRulesFor(format),
        matches: [{ ...FINAL, status: 'done' as const }],
      };
      expect(displayQualifyingPhase(s)).toEqual({ phase: 'bracket', holdingResult: false });
      expect(shouldShowFinale(s, displayQualifyingPhase(s).phase)).toBe(true);
    }
  });

  it('予選が終わっても、確定するまでは予選の最終結果を出し続ける', () => {
    // ここが時間切れで勝手に切り替わると、運営が同点の枠を見直す前に決勝表になってしまう
    expect(displayQualifyingPhase(state(true))).toEqual({ phase: 'groups', holdingResult: true });
  });

  it('確定すると決勝トーナメント表に移る', () => {
    expect(displayQualifyingPhase(state(true, { confirmed: true })))
      .toEqual({ phase: 'bracket', holdingResult: false });
  });

  it('運営が明示的に選んでいればそちらが勝つ (据え置きの見出しも出さない)', () => {
    expect(displayQualifyingPhase(state(true, { displayView: 'bracket' })))
      .toEqual({ phase: 'bracket', holdingResult: false });
    expect(displayQualifyingPhase(state(true, { confirmed: true, displayView: 'groups' })))
      .toEqual({ phase: 'groups', holdingResult: false });
  });
});

describe('表示の切り替え', () => {
  it('phase を渡すとその表を出し、タブは出さない', () => {
    // 観戦画面は運営パネルの指定に従う。運営席のタブ操作と混ざらないよう外から決める
    render(<QualifyingView state={state(true)} phase="groups" showTabs />);
    expect(screen.getByText('Aリーグ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '予選リーグ' })).toBeNull();
  });

  it('全工程が終わっていても予選側を見ているなら表彰画面にはしない', () => {
    // 決勝まで確定した状態を作る
    const complete = state(true);
    complete.matches = complete.matches.map(m => (m.id !== 'FINAL' ? m : {
      ...m, status: 'done' as const, resolvedA: 'p1', resolvedB: 'p2',
      result: {
        roundResults: [], set: null, decidedBy: 'walkover' as const,
        winnerSide: 0 as const, capturedAt: 1, confirmedAt: 1,
      },
    }));

    expect(shouldShowFinale(complete, 'bracket')).toBe(true);
    // 運営が予選表を出しているあいだは表彰画面に飛ばさない
    expect(shouldShowFinale(complete, 'groups')).toBe(false);
    // 予選までしか終わっていなければ、決勝側を見ていても表彰ではない
    expect(shouldShowFinale(state(true), 'bracket')).toBe(false);
  });
});

describe('QualifyingView', () => {
  it('予選中はリーグ表を人数ぶん並べる', () => {
    render(<QualifyingView state={state(false)} />);
    expect(screen.getByText('Aリーグ')).toBeTruthy();
    expect(screen.getByText('Bリーグ')).toBeTruthy();
  });

  it('リーグ表にはそのリーグの参加者しか出ない', () => {
    render(<QualifyingView state={state(false)} />);
    // 星取表 (各リーグ1つ目の table) は2人ぶんの行しか持たない
    const tables = screen.getAllByRole('table');
    const rows = tables[0]!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);   // A リーグの3人だけ (B リーグは別の表)
  });

  it('凡例は星取表のすぐ下に出し、「未消化」は書かない', () => {
    render(<QualifyingView state={state(false)} />);
    const legends = screen.getAllByText(/○ 勝ち/);
    expect(legends).toHaveLength(2);            // リーグごとに1つ
    for (const el of legends) expect(el.textContent).not.toContain('未消化');
  });

  it('プレイヤー数が違っても順位表が同じグリッド行に載る (上端がそろう)', () => {
    // A=3人 / B=2人。素直に縦積みすると星取表の高さが違って順位表の位置がずれる
    const { container } = render(<QualifyingView state={state(false)} />);
    const grid = container.querySelector('[style*="grid"]') as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe('auto auto auto');
    // 列方向に流さないと、リーグの塊が横に並んで表が入り乱れる
    expect(grid.style.gridAutoFlow).toBe('column');
    // リーグ2つ × (見出し + 星取表 + 順位表) = 6 個の直下の子
    expect(grid.children).toHaveLength(6);
  });

  it('順位表は決勝トーナメントへ上がる順位まで強調する (予選の途中でも)', () => {
    render(<QualifyingView state={state(false)} />);
    // リーグごとに「上位2名が進出」を出す
    expect(screen.getAllByText(/上位 2 名が決勝トーナメントへ進出/)).toHaveLength(2);

    // A リーグ (3人) の順位表 = 2つ目の table。上位2行だけ色がつく
    const rows = [...screen.getAllByRole('table')[1]!.querySelectorAll('tbody tr')];
    expect(rows.map(r => (r as HTMLElement).style.background !== ''))
      .toEqual([true, true, false]);
  });

  it('運営が枠を差し替えたら、順位表の強調もその人に移る', () => {
    const s = state(true);
    // A リーグ2位の枠を、順位表3位の p5 に差し替えた
    s.qualifiers = (s.qualifiers ?? []).map(q => (q.group === 0 && q.rank === 2
      ? { ...q, manualParticipantId: 'p5', participantId: 'p5' } : q));
    render(<QualifyingView state={s} />);

    const rows = [...screen.getAllByRole('table')[1]!.querySelectorAll('tbody tr')];
    expect(rows.map(r => (r as HTMLElement).style.background !== ''))
      .toEqual([true, false, true]);
  });

  it('決勝進出者を確定すると決勝トーナメント表に切り替わる', () => {
    // 確定前は予選表のまま (運営席のタブも進行に追従する)
    render(<QualifyingView state={state(true)} />);
    expect(screen.getByText('Aリーグ')).toBeTruthy();
    cleanup();

    render(<QualifyingView state={state(true, { confirmed: true })} />);
    expect(screen.getAllByText('決勝').length).toBeGreaterThan(0);
    expect(screen.queryByText('Aリーグ')).toBeNull();
  });

  it('タブで予選と決勝を行き来できる', () => {
    // 確定済み = 既定は決勝表。そこから予選表へ戻せること
    render(<QualifyingView state={state(true, { confirmed: true })} showTabs />);
    fireEvent.click(screen.getByText('予選リーグ'));
    expect(screen.getByText('Aリーグ')).toBeTruthy();
  });

  it('決まっていない枠は「Aリーグ 1位」と書く', () => {
    render(<QualifyingView state={state(false)} showTabs />);
    fireEvent.click(screen.getByText('決勝トーナメント'));
    expect(screen.getByText('Aリーグ 1位')).toBeTruthy();
    expect(screen.getByText('Bリーグ 1位')).toBeTruthy();
  });
});

// ── BOT対戦予選 ──
//
// 位相の判断 (予選 / 決勝、確定待ちの据え置き) は予選リーグと完全に共通で、
// 差し替わるのは予選側のボードだけ。ここではその分岐が効いていることを確かめる。

describe('QualifyingView (BOT対戦予選)', () => {
  /** 予選リーグ用の state を BOT対戦予選に読み替える (位相の判断は共通なので使い回せる) */
  function botState(done: boolean, opts: { confirmed?: boolean } = {}): TournamentStatePayload {
    const s = state(done, opts);
    return {
      ...s,
      stage: { ...stageRulesFor('bot-then-bracket'), advanceCount: 2 } as StageRules,
      // 1グループに全員。試合は各自 BOT と1試合
      groups: [{
        group: 0, label: 'A', participantIds: ['p1', 'p2', 'p3'],
        standings: [standing('p1', 1), standing('p2', 2), standing('p3', 3)],
      }],
      participants: [
        ...participants,
        {
          id: '__bot__', name: '運営BOT', seed: 0,
          programCatalogId: null, builtinCpu: true, programName: '内蔵CPU', isBot: true,
        },
      ],
      matches: [
        ...['p1', 'p2', 'p3'].map((pid, i) => ({
          id: `B-M${i + 1}`, stage: 0, order: i, label: `BOT対戦予選 第${i + 1}試合`, group: 0,
          slotA: { kind: 'participant' as const, participantId: pid },
          slotB: { kind: 'participant' as const, participantId: '__bot__' },
          resolvedA: pid, resolvedB: '__bot__', byeA: false, byeB: false,
          status: (done ? 'done' : 'ready') as TournamentMatch['status'],
          ...(done ? { result: {
            roundResults: [], set: null, decidedBy: 'walkover' as const,
            winnerSide: 0 as const, capturedAt: 1, confirmedAt: 1,
          } } : {}),
        })),
        { ...FINAL, slotB: { kind: 'group-rank' as const, group: 0, rank: 2 } },
      ],
    };
  }

  it('予選側では星取表ではなくエントリー + 順位リストを出す', () => {
    render(<QualifyingView state={botState(false)} />);
    expect(screen.getByText(/^エントリー/)).toBeTruthy();
    expect(screen.getByText(/^試合結果/)).toBeTruthy();
    expect(screen.queryByText('Aリーグ')).toBeNull();
  });

  it('タブの呼び名が「BOT対戦予選」になる', () => {
    render(<QualifyingView state={botState(true, { confirmed: true })} showTabs />);
    fireEvent.click(screen.getByText('BOT対戦予選'));
    expect(screen.getByText(/^エントリー/)).toBeTruthy();
  });

  it('確定するまでは予選のまま、確定すると決勝トーナメント表へ移る (予選リーグと同じ)', () => {
    render(<QualifyingView state={botState(true)} />);
    expect(screen.getByText(/^エントリー/)).toBeTruthy();
    cleanup();

    render(<QualifyingView state={botState(true, { confirmed: true })} />);
    expect(screen.getAllByText('決勝').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^エントリー/)).toBeNull();
  });

  it('決まっていない枠は「予選 1位」と書く (リーグ名を付けない)', () => {
    render(<QualifyingView state={botState(false)} showTabs />);
    fireEvent.click(screen.getByText('決勝トーナメント'));
    expect(screen.getByText('予選 1位')).toBeTruthy();
    expect(screen.getByText('予選 2位')).toBeTruthy();
  });
});

describe('QualifierSection', () => {
  it('枠ごとに選び直せる', () => {
    const onChange = vi.fn();
    render(<QualifierSection state={state(true)} onChange={onChange} />);

    const select = screen.getByLabelText('Aリーグ 1位') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'p5' } });
    expect(onChange).toHaveBeenCalledWith(0, 1, 'p5', undefined);
  });

  it('自動判定の結果を選択肢に見せる', () => {
    render(<QualifierSection state={state(true)} onChange={vi.fn()} />);
    expect(screen.getByText('自動（A）')).toBeTruthy();
  });

  it('境目で同点の枠には注意を出す', () => {
    render(<QualifierSection state={state(true)} onChange={vi.fn()} />);
    expect(screen.getByText(/勝ち点・合計ポイント・直接対決まで並んだ枠があります/)).toBeTruthy();
    expect(screen.getByText('同点 — 要確認')).toBeTruthy();
  });

  it('予選が終わるまでは確定させない', () => {
    render(<QualifierSection state={state(false)} onChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('qualifier-waiting')).toBeTruthy();
    expect(screen.queryByText(/この決勝進出者で確定/)).toBeNull();
  });

  it('予選が終わったら確定ボタンを出す', () => {
    const onConfirm = vi.fn();
    render(<QualifierSection state={state(true)} onChange={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText(/この決勝進出者で確定/));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('確定後は取り消せる', () => {
    const onConfirm = vi.fn();
    render(
      <QualifierSection
        state={state(true, { confirmed: true })} onChange={vi.fn()} onConfirm={onConfirm}
      />);
    expect(screen.getByText(/確定済み/)).toBeTruthy();
    fireEvent.click(screen.getByText('確定を取り消す'));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('確定操作を渡さなければ確定の欄は出ない (トーナメント表の選択バーなど)', () => {
    render(<QualifierSection state={state(true)} onChange={vi.fn()} />);
    expect(screen.queryByText(/この決勝進出者で確定/)).toBeNull();
  });

  it('既に別の枠に入っている人は候補に出さない (同じ人が2回出るのを防ぐ)', () => {
    render(<QualifierSection state={state(true)} onChange={vi.fn()} />);
    const select = screen.getByLabelText('Bリーグ 1位') as HTMLSelectElement;
    const values = [...select.options].map(o => o.value);
    // B リーグ2位に入っている p3 は選べない
    expect(values).toContain('p2');
    expect(values).not.toContain('p3');
  });
});
