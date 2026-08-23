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
  return {
    tournamentId: 'cup', name: 'テスト杯',
    match: { doubleMode: false },
    stage: stageRulesFor('single-elimination'),
    participants: [participant('p1'), participant('p2')],
    matches: [match()],
    standings: null, groups: null, qualifiers: null, qualifierCandidates: null,
    qualifiersConfirmed: false,
    displayView: 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    stageMaps: [], stageLabels: [],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
    ...over,
  };
}

const commands = { arm: vi.fn(), confirmQualifiers: vi.fn(), assignProgram: vi.fn() };

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
});
