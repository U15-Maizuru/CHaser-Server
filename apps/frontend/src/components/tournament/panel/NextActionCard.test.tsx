import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  ResolvedParticipant, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { NextActionCard } from './NextActionCard';

// 「今やること」は常に1枚だけ出る。運営はこのカードだけ見ていれば大会を進められる、
// というのがこの画面の要件なので、状況ごとに何が出るかをここで押さえる。

const participant = (id: string, over: Partial<ResolvedParticipant> = {}): ResolvedParticipant => ({
  id, name: id.toUpperCase(), seed: 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
  ...over,
});

const match = (over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id: 'FINAL', stage: 0, label: '決勝', order: 0,
  slotA: { kind: 'participant', participantId: 'p1' },
  slotB: { kind: 'participant', participantId: 'p2' },
  resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
  status: 'ready',
  ...over,
});

function state(over: Partial<TournamentStatePayload> = {}): TournamentStatePayload {
  const base: TournamentStatePayload = {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: false },
    stage: stageRulesFor('single-elimination'),
    participants: [participant('p1'), participant('p2')],
    matches: [match()],
    standings: null, groups: null, qualifiers: null, qualifierCandidates: null,
    qualifiersConfirmed: false,
    displayView: 'auto', bracketView: 'auto', groupView: 'auto',
    autoPlay: { enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null },
    stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    lanes: [{ roomId: 'room', primary: true, armedMatchId: null }],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
    ...over,
  };
  // **主レーンの armedMatchId は payload の armedMatchId と常に同じ。**
  // バックエンドが同じ値から両方を組み立てるので、テストでもここを揃えておかないと
  // nextOperatorAction (レーンを見る) が「準備済み」を見落とす
  return over.lanes
    ? base
    : { ...base, lanes: [{ roomId: 'room', primary: true, armedMatchId: base.armedMatchId }] };
}

const commands = {
  arm: vi.fn(), armNext: vi.fn(), startLanes: vi.fn(),
  confirmQualifiers: vi.fn(), assignProgram: vi.fn(),
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(s: TournamentStatePayload | null) {
  render(
    <NextActionCard
      state={s}
      commands={commands as unknown as TournamentCommands}
      programs={[{ id: 'lib-1', displayName: 'A のプログラム' } as never]}
    />,
  );
}

describe('NextActionCard', () => {
  it('大会を選ぶ前は大会の選択へ誘導する', () => {
    show(null);
    expect(screen.getByText('大会を選ぶ')).toBeInTheDocument();
  });

  it('未実施なら次の試合を準備するボタンを出す', () => {
    show(state());
    expect(screen.getByText('次の試合を準備する')).toBeInTheDocument();
    fireEvent.click(screen.getByText('この試合を準備 ▶'));
    expect(commands.arm).toHaveBeenCalledWith('FINAL');
  });

  it('確定待ちがあれば、準備より先に確定を促す', () => {
    show(state({ matches: [match({ status: 'awaiting_confirm' })] }));
    expect(screen.getByText('結果を確定する')).toBeInTheDocument();
    expect(screen.queryByText('この試合を準備 ▶')).not.toBeInTheDocument();
  });

  it('準備済みならフッターの「ゲームスタート」へ誘導する', () => {
    show(state({ matches: [match({ status: 'armed' })], armedMatchId: 'FINAL' }));
    expect(screen.getByText('ゲームを開始する')).toBeInTheDocument();
  });

  it('全部終われば大会終了を出す', () => {
    show(state({ matches: [match({ status: 'done' })] }));
    expect(screen.getByText('大会終了')).toBeInTheDocument();
  });

  it('出場者のプログラムが未登録なら、その場で割り当てさせる', () => {
    show(state({
      participants: [
        participant('p1', { builtinCpu: false, programName: null }),
        participant('p2'),
      ],
    }));
    expect(screen.getByText('プログラムを割り当てる')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('P1 のプログラム'), { target: { value: 'lib-1' } });
    expect(commands.assignProgram).toHaveBeenCalledWith('p1', 'lib-1');
  });

  // ── 並列実行 (BOT対戦予選を複数レーンで同時に走らせる) ──────────────────────
  //
  // 「この試合を準備」を押した瞬間に action は 'start' へ移るので、その1手で残りの
  // レーンへ配る入口を失わないことが要点。

  /** レーン n 本の BOT対戦予選。予選試合は3つとも未実施 */
  const parallel = (lanes: (string | null)[]) => state({
    stage: stageRulesFor('bot-then-bracket'),
    participants: [participant('p1'), participant('p2'), participant('p3'), participant('bot')],
    matches: [
      match({ id: 'Q1', group: 0, order: 0, resolvedA: 'p1', resolvedB: 'bot' }),
      match({ id: 'Q2', group: 0, order: 1, resolvedA: 'p2', resolvedB: 'bot' }),
      match({ id: 'Q3', group: 0, order: 2, resolvedA: 'p3', resolvedB: 'bot' }),
    ].map(m => (lanes.includes(m.id) ? { ...m, status: 'armed' as const } : m)),
    lanes: lanes.map((armedMatchId, i) => ({
      roomId: `room${i}`, primary: i === 0, armedMatchId,
    })),
    armedMatchId: lanes[0],
  });

  it('並列実行中は、1試合ずつではなくまとめて準備するほうを主役にする', () => {
    show(parallel([null, null, null]));
    fireEvent.click(screen.getByText('3試合をまとめて準備 ▶'));
    expect(commands.armNext).toHaveBeenCalled();
    // 1試合だけ準備する道も残す (押し間違いではないと分かる文言で)
    expect(screen.getByText('この試合だけ準備')).toBeInTheDocument();
  });

  it('1レーンだけ準備してしまっても、残りのレーンへ配り直せる', () => {
    show(parallel(['Q1', null, null]));
    expect(screen.getByText('ゲームを開始する')).toBeInTheDocument();
    fireEvent.click(screen.getByText('空いているレーンへ、あと2試合を準備 ▶'));
    expect(commands.armNext).toHaveBeenCalled();
  });

  it('準備済みの試合にはレーン番号を添える (観戦画面の分割表示と突き合わせるため)', () => {
    show(parallel(['Q1', 'Q2', null]));
    expect(screen.getByText('レーン1')).toBeInTheDocument();
    expect(screen.getByText('レーン2')).toBeInTheDocument();
    expect(screen.queryByText('レーン3')).not.toBeInTheDocument();
  });

  it('確定待ちが複数あることを、確定を促すときに知らせる', () => {
    show(state({
      matches: [
        match({ id: 'M1', status: 'awaiting_confirm' }),
        match({ id: 'M2', status: 'awaiting_confirm' }),
      ],
    }));
    expect(screen.getByText('（確定待ち 2 件。1件ずつ確定します）')).toBeInTheDocument();
  });

  it('予選が終わったら決勝進出者の確定を促す', () => {
    const groupMatch = match({ id: 'G1', group: 0, status: 'done' });
    show(state({
      stage:   stageRulesFor('group-then-bracket'),
      matches: [groupMatch, match({ id: 'FINAL', stage: 1, status: 'pending' })],
    }));
    expect(screen.getByText('決勝進出者を確定する')).toBeInTheDocument();
    fireEvent.click(screen.getByText('この決勝進出者で確定 ▶'));
    expect(commands.confirmQualifiers).toHaveBeenCalledWith(true);
  });

  it('BOT対戦予選で候補が定員を超えている間は確定ボタンを出さない', () => {
    // BotQualifierSection (進行タブ) 側の disabled={over > 0} を素通りして
    // 同点のボーダーを1人も削らずに確定できてしまっていた回帰を防ぐ
    const groupMatch = match({ id: 'G1', group: 0, status: 'done' });
    const candidate = (id: string, onBorder: boolean) => ({
      participantId: id, rank: 4, totalPoints: 100, strikePoints: 0, itemPoints: 100,
      items: 10, remainingTurns: 0, excluded: false, onBorder,
    });
    show(state({
      stage:   stageRulesFor('bot-then-bracket'),
      matches: [groupMatch, match({ id: 'FINAL', stage: 1, status: 'pending' })],
      qualifierCandidates: [
        candidate('p1', true), candidate('p2', true), candidate('p3', true),
        candidate('p4', true), candidate('p5', true),
      ],
    }));
    expect(screen.getByText('決勝進出者を確定する')).toBeInTheDocument();
    expect(screen.queryByText('この決勝進出者で確定 ▶')).not.toBeInTheDocument();
    expect(screen.getByText(/あと1名を削ってください/)).toBeInTheDocument();
  });
});
