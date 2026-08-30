import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  ResolvedParticipant, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { ProgressTab } from './ProgressTab';

// 試合一覧は**運営の作業リスト**。不戦の枠は対戦ではないので、ここには出さない。
// (人数の都合で表の形を保つためだけに存在する枠で、運営がすることは何も無い。
//  結果CSVのほうは記録なので「誰が不戦勝で上がったか」を残す — 役割が違う)

const participant = (id: string, seed: number): ResolvedParticipant => ({
  id, name: id.toUpperCase(), seed,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
});

const match = (over: Partial<TournamentMatch>): TournamentMatch => ({
  id: 'X', stage: 0, label: '準々決勝 第1試合', order: 0, no: 1,
  slotA: { kind: 'participant', participantId: 'p1' },
  slotB: { kind: 'participant', participantId: 'p2' },
  resolvedA: 'p1', resolvedB: 'p2', byeA: false, byeB: false,
  status: 'ready',
  ...over,
});

/** 実戦1つ + 不戦2つ (5人トーナメントの1回戦にあたる形) */
function state(): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: false },
    stage: stageRulesFor('single-elimination'),
    participants: [1, 2, 3, 4].map(i => participant(`p${i}`, i)),
    matches: [
      match({ id: 'QF1', label: '準々決勝 第1試合', order: 0, no: 1 }),
      match({
        id: 'QF2', label: '準々決勝', order: 1, no: 2,
        slotB: { kind: 'bye' }, resolvedB: null, byeB: true, status: 'done',
      }),
      match({
        id: 'QF3', label: '準々決勝', order: 2, no: 3,
        slotA: { kind: 'bye' }, resolvedA: null, byeA: true, status: 'done',
      }),
    ],
    standings: null, groups: null, qualifiers: null, qualifierCandidates: null,
    qualifiersConfirmed: false,
    displayView: 'auto',
    autoPlay: { enabled: false, loop: false, stoppedReason: null },
    stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

const commands = {
  reopenMatch: vi.fn(), setMatchMap: vi.fn(), swapSides: vi.fn(),
} as unknown as TournamentCommands;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ProgressTab — 試合一覧', () => {
  it('不戦の枠は一覧に出さない', () => {
    render(<ProgressTab state={state()} httpBase="http://x" commands={commands} />);
    expect(screen.getAllByText('準々決勝 第1試合')).not.toHaveLength(0);
    // 不戦の枠は回戦名だけのラベルを持つが、そもそも行が出ない
    expect(screen.queryByText('準々決勝')).toBeNull();
  });

  it('完了カウントにも不戦を数えない', () => {
    render(<ProgressTab state={state()} httpBase="http://x" commands={commands} />);
    // 不戦2つは done だが、対戦は1つも終わっていない
    expect(screen.getByText('試合 (0/1 完了)')).toBeTruthy();
  });
});
