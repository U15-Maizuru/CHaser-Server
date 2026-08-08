import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  QualifierCandidate, ResolvedParticipant, TournamentStatePayload,
} from '@u15/ws-types';
import { BotQualifierSection } from './BotQualifierSection';

// 決勝進出者の「最終決定確認リスト」。要点は3つ:
//   ① ボーダーが同点なら定員より多く並び、その旨を出す
//   ② 人数が合うまで確定させない
//   ③ 削除は取り消せる (行はリストに残る)

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function candidate(
  id: string, rank: number, opts: Partial<QualifierCandidate> = {},
): QualifierCandidate {
  return {
    participantId: id, rank, totalPoints: 100, strikePoints: 0, itemPoints: 100,
    excluded: false, onBorder: false, ...opts,
  };
}

function state(
  candidates: QualifierCandidate[], confirmed = false,
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'BOT予選杯', format: 'bot-then-bracket',
    rules: {
      doubleMode: false, mapCatalogId: null, stageMaps: [], thirdPlaceMatch: false,
      leaguePoints: { win: 3, draw: 1, loss: 0 }, doubleRoundRobin: false,
      groupCount: 1, advancePerGroup: 2,
      botProgram: null, botName: null, botStageMap: 'map-1', participantSide: 0,
    },
    participants,
    matches: [],
    standings: null, groups: null, qualifiers: null,
    qualifierCandidates: candidates,
    qualifiersConfirmed: confirmed,
    stageMaps: [], stageLabels: [],
    displayView: 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('BotQualifierSection', () => {
  it('予選が終わるまでは確認リストを出さない', () => {
    render(<BotQualifierSection state={state([])} onExclude={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByTestId('bot-qualifier-waiting')).toBeInTheDocument();
    expect(screen.queryByText('この顔ぶれで確定 ▶')).not.toBeInTheDocument();
  });

  it('定員ちょうどならそのまま確定できる', () => {
    const onConfirm = vi.fn();
    render(
      <BotQualifierSection
        state={state([candidate('p1', 1), candidate('p2', 2)])}
        onExclude={vi.fn()} onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByTestId('bot-qualifier-over')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('この顔ぶれで確定 ▶'));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('ボーダー同点で定員を超えていたら、あと何人削るかを出して確定を止める', () => {
    const onConfirm = vi.fn();
    render(
      <BotQualifierSection
        state={state([
          candidate('p1', 1),
          candidate('p2', 2, { onBorder: true }),
          candidate('p3', 2, { onBorder: true }),
        ])}
        onExclude={vi.fn()} onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId('bot-qualifier-over').textContent).toContain('あと');
    expect(screen.getAllByText('同点')).toHaveLength(2);

    const btn = screen.getByText('この顔ぶれで確定 ▶');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('削除ボタンで excluded を立てる', () => {
    const onExclude = vi.fn();
    render(
      <BotQualifierSection
        state={state([candidate('p1', 1), candidate('p2', 2)])}
        onExclude={onExclude} onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('B を削除'));
    expect(onExclude).toHaveBeenCalledWith('p2', true);
  });

  it('削除済みの行は残り、「戻す」で取り消せる', () => {
    const onExclude = vi.fn();
    render(
      <BotQualifierSection
        state={state([
          candidate('p1', 1), candidate('p3', 3),
          candidate('p2', 2, { excluded: true }),
        ])}
        onExclude={onExclude} onConfirm={vi.fn()}
      />,
    );

    // 削除済みも行としては見える (取り消せるように)
    expect(screen.getByText('B')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('B を戻す'));
    expect(onExclude).toHaveBeenCalledWith('p2', false);
  });

  it('同点の内訳 (一撃 / アイテム) を出す', () => {
    render(
      <BotQualifierSection
        state={state([
          candidate('p1', 1, { totalPoints: 150, strikePoints: 50, itemPoints: 100 }),
          candidate('p2', 2, { totalPoints: 150, strikePoints: 0,  itemPoints: 100 }),
        ])}
        onExclude={vi.fn()} onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('一撃')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('確定済みなら取り消しだけを出す', () => {
    const onConfirm = vi.fn();
    render(
      <BotQualifierSection
        state={state([candidate('p1', 1), candidate('p2', 2)], true)}
        onExclude={vi.fn()} onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByText('確定を取り消す'));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });
});
