import { afterEach, describe, expect, it } from 'vitest';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  QualifierCandidate, ResolvedParticipant, RuleSet, StandingRow, TournamentMatch,
  TournamentStatePayload,
} from '@u15/ws-types';
import { BOT_PARTICIPANT_ID } from '@u15/ws-types';
import { BotStageBoard } from './BotStageBoard';

// BOT対戦予選の進行画面。要点は3つ:
//   ① 順位リストには**終わった人だけ**が載り、予選が進むにつれて伸びる
//   ② 通過ラインは進出人数の位置に引かれる
//   ③ BOT はエントリーではないので、エントリーリストに出てこない

afterEach(() => cleanup());

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

const participants: ResolvedParticipant[] = [
  ...NAMES.map((name, i) => ({
    id: `p${i + 1}`, name, seed: i + 1,
    programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
  })),
  {
    id: BOT_PARTICIPANT_ID, name: '運営BOT', seed: 0,
    programCatalogId: null, builtinCpu: true, programName: '内蔵CPU', isBot: true,
  },
];

function standing(
  participantId: string, rank: number, played: number, totalPoints = 0, tied = false,
  items = totalPoints, remainingTurns = 0,
): StandingRow {
  return {
    participantId, played, wins: played, draws: 0, losses: 0,
    points: 0, totalPoints, itemPoints: totalPoints, strikePoints: 0, sweepPoints: 0,
    items, remainingTurns,
    rank, tied,
  };
}

function botMatch(i: number, done: boolean): TournamentMatch {
  const pid = `p${i + 1}`;
  return {
    id: `B-M${i + 1}`, stage: 0, order: i, label: `BOT対戦予選 第${i + 1}試合`, group: 0,
    slotA: { kind: 'participant', participantId: pid },
    slotB: { kind: 'participant', participantId: BOT_PARTICIPANT_ID },
    resolvedA: pid, resolvedB: BOT_PARTICIPANT_ID, byeA: false, byeB: false,
    status: done ? 'done' : 'ready',
    ...(done ? { result: {
      roundResults: [], set: null, decidedBy: 'walkover' as const,
      winnerSide: 0 as const, capturedAt: 1, confirmedAt: 1,
    } } : {}),
  };
}

/** 先頭 `finished` 人だけが終わっている状態 */
function state(
  finished: number,
  opts: {
    candidates?: QualifierCandidate[]; armedMatchId?: string; ruleSet?: RuleSet;
    standings?: StandingRow[];
  } = {},
): TournamentStatePayload {
  const standings: StandingRow[] = opts.standings ?? NAMES.map((_, i) =>
    standing(`p${i + 1}`, i + 1, i < finished ? 1 : 0, i < finished ? 100 - i * 10 : 0));

  return {
    tournamentId: 'cup', name: 'BOT予選杯', ruleSet: opts.ruleSet ?? 'maizuru',
    match: { doubleMode: false },
    stage: stageRulesFor('bot-then-bracket'),
    participants,
    matches: NAMES.map((_, i) => botMatch(i, i < finished)),
    standings: null,
    groups: [{
      group: 0, label: 'A',
      participantIds: NAMES.map((_, i) => `p${i + 1}`),
      standings,
    }],
    qualifiers: null,
    qualifierCandidates: opts.candidates ?? [],
    qualifiersConfirmed: false,
    stageMaps: ['map-1', null], thirdPlaceMapId: null, stageLabels: ['BOT対戦予選', '準決勝'],
    displayView: 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    armedMatchId: opts.armedMatchId ?? null, boundRoomId: 'room', updatedAt: 0,
  };
}

/** 順位リスト (右) の本文行から、プレイヤー名を並び順に取り出す */
function rankedNames(): string[] {
  const table = screen.getByText(/^試合結果/).parentElement!.querySelector('table');
  if (!table) return [];
  return within(table as HTMLElement).getAllByRole('row')
    .slice(1)   // 見出し行を落とす
    .map(r => r.children[1]!.textContent!);
}

describe('BotStageBoard', () => {
  it('エントリーリストには全参加者が並び、BOT は出てこない', () => {
    render(<BotStageBoard state={state(0)} />);
    const table = screen.getByText(/^エントリー/).parentElement!.querySelector('table')!;
    const rows  = within(table).getAllByRole('row').slice(1);

    expect(rows).toHaveLength(6);
    expect(rows.map(r => r.children[1]!.textContent)).toEqual(NAMES);
    expect(table.textContent).not.toContain('運営BOT');
  });

  it('対戦相手が全員同じ BOT であることを添える', () => {
    render(<BotStageBoard state={state(0)} />);
    expect(screen.getByText(/対戦相手は全員 運営BOT/)).toBeInTheDocument();
  });

  it('予選が進むにつれて順位リストが伸びる (終わった人だけ載る)', () => {
    const { rerender } = render(<BotStageBoard state={state(0)} />);
    expect(screen.getByText('まだ結果がありません')).toBeInTheDocument();

    rerender(<BotStageBoard state={state(2)} />);
    expect(rankedNames()).toEqual(['A', 'B']);

    rerender(<BotStageBoard state={state(6)} />);
    expect(rankedNames()).toEqual(NAMES);
  });

  it('消化数を「済 / 全体」で示す', () => {
    render(<BotStageBoard state={state(2)} />);
    expect(screen.getByText('試合結果（2 / 6）')).toBeInTheDocument();
  });

  it('通過ラインは進出人数の位置に引かれる', () => {
    render(<BotStageBoard state={state(6)} />);
    expect(screen.getByText(/上位 4 名が決勝トーナメントへ進出/)).toBeInTheDocument();

    // 4行目 (進出人数ぶんの最後) の下に線が入る
    const table = screen.getByText(/^試合結果/).parentElement!.querySelector('table')!;
    const rows  = within(table).getAllByRole('row').slice(1);
    const borderOf = (i: number) =>
      (rows[i]!.children[0] as HTMLElement).style.borderBottomWidth;
    expect(borderOf(3)).toBe('2px');
    expect(borderOf(2)).not.toBe('2px');
  });

  it('確認リストで削除された人は順位リストから外れ、下が繰り上がる', () => {
    const excluded: QualifierCandidate[] = [{
      participantId: 'p2', rank: 2, totalPoints: 90, strikePoints: 0, itemPoints: 90,
      items: 90, remainingTurns: 0,
      excluded: true, onBorder: false,
    }];
    render(<BotStageBoard state={state(6, { candidates: excluded })} />);
    expect(rankedNames()).toEqual(['A', 'C', 'D', 'E', 'F']);
  });

  it('交流大会ルールでは得点の内訳としてアイテム数・残りターン数の列を出す (一撃/アイテムポイントは出さない)', () => {
    const standings: StandingRow[] = [
      standing('p1', 1, 1, 27, false, 5, 12),   // 5個×3+残り12=27
      standing('p2', 2, 1, -3, false, 3, 12),   // 3個×3-残り12=-3
      ...NAMES.slice(2).map((_, i) => standing(`p${i + 3}`, i + 3, 0, 0)),
    ];
    render(<BotStageBoard state={state(6, { ruleSet: 'koryu', standings })} />);

    const table = screen.getByText(/^試合結果/).parentElement!.querySelector('table')!;
    expect(within(table).getByText('得点')).toBeInTheDocument();
    expect(within(table).getByText('アイテム数')).toBeInTheDocument();
    expect(within(table).getByText('残りターン')).toBeInTheDocument();
    expect(within(table).queryByText('一撃')).not.toBeInTheDocument();

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.children[3]!.textContent).toBe('27');   // 得点
    expect(rows[0]!.children[4]!.textContent).toBe('5');    // アイテム数
    expect(rows[0]!.children[5]!.textContent).toBe('12');   // 残りターン
    expect(rows[1]!.children[3]!.textContent).toBe('-3');
  });

  it('これから行う試合のエントリー行を「▶ 対戦」にする', () => {
    render(<BotStageBoard state={state(1, { armedMatchId: 'B-M2' })} />);
    const table = screen.getByText(/^エントリー/).parentElement!.querySelector('table')!;
    const rows  = within(table).getAllByRole('row').slice(1);

    expect(rows[0]!.children[2]!.textContent).toBe('済');
    expect(rows[1]!.children[2]!.textContent).toBe('▶ 対戦');
    expect(rows[2]!.children[2]!.textContent).toBe('—');
  });
});
