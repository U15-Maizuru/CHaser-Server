import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  QualifierSlot, ResolvedParticipant, TournamentFormat, TournamentStatePayload,
} from '@u15/ws-types';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { ParticipantListScreen } from './ParticipantListScreen';

afterEach(() => cleanup());

function person(i: number, extra: Partial<ResolvedParticipant> = {}): ResolvedParticipant {
  return {
    id: `p${i}`, name: `選手${i}`, seed: i,
    programCatalogId: null, builtinCpu: true, programName: '内蔵CPU', ...extra,
  };
}

function state(format: TournamentFormat, participants: ResolvedParticipant[]): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: false }, stage: stageRulesFor(format),
    participants, matches: [], standings: null, groups: null, qualifiers: null,
    qualifierCandidates: null, stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    qualifiersConfirmed: false,
    displayView: 'participants', bracketView: 'auto', groupView: 'auto',
    autoPlay: { enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null },
    lanes: [{ roomId: 'room', primary: true, armedMatchId: null }],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('ParticipantListScreen', () => {
  it.each(['single-elimination', 'league'] as const)(
    '%s: リーグ分けが無くても参加者全員を1枚にまとめて出す', format => {
      const people = [1, 2, 3, 4, 5].map(i => person(i));
      render(<ParticipantListScreen state={state(format, people)} displayTitle="U15 大会" />);

      expect(screen.getByText('テスト杯')).toBeInTheDocument();
      expect(screen.getByText('参加者一覧')).toBeInTheDocument();
      expect(screen.getByText('5名')).toBeInTheDocument();
      for (const p of people) expect(screen.getByText(p.name)).toBeInTheDocument();
    });

  it('運営BOT はエントリーではないので出さない', () => {
    const people = [person(1), person(2), person(99, { name: '運営BOT', isBot: true })];
    render(<ParticipantListScreen state={state('single-elimination', people)} displayTitle="U15 大会" />);

    expect(screen.getByText('2名')).toBeInTheDocument();
    expect(screen.queryByText('運営BOT')).toBeNull();
  });

  it('所属があれば名前の上に出る', () => {
    const people = [person(1, { affiliation: '舞鶴中' }), person(2)];
    render(<ParticipantListScreen state={state('single-elimination', people)} displayTitle="U15 大会" />);
    expect(screen.getByText('舞鶴中')).toBeInTheDocument();
  });
});

describe('ParticipantListScreen (決勝進出者)', () => {
  const people = [1, 2, 3, 4, 5, 6].map(i => person(i));
  const slot = (group: number, rank: number, id: string | null, extra: Partial<QualifierSlot> = {}): QualifierSlot => ({
    group, rank, autoParticipantId: id, manualParticipantId: null, participantId: id,
    tied: false, ambiguous: false, pending: id === null, bye: false, ...extra,
  });
  const qualifying = (slots: QualifierSlot[], confirmed = false): TournamentStatePayload => ({
    ...state('group-then-bracket', people),
    displayView: 'qualifiers',
    groups: [
      { group: 0, label: 'A', participantIds: ['p1', 'p2', 'p3'], standings: [] },
      { group: 1, label: 'B', participantIds: ['p4', 'p5', 'p6'], standings: [] },
    ],
    qualifiers: slots, qualifiersConfirmed: confirmed,
  });

  it('決勝の枠に入る人だけを、リーグごとに順位つきで出す (予選落ちの人は出ない)', () => {
    const st = qualifying([slot(0, 1, 'p2'), slot(0, 2, 'p1'), slot(1, 1, 'p5'), slot(1, 2, 'p4')], true);
    render(<ParticipantListScreen state={st} displayTitle="U15 大会" />);

    expect(screen.getByText('決勝トーナメント進出者')).toBeInTheDocument();
    expect(screen.getByText('Aリーグ')).toBeInTheDocument();
    expect(screen.getByText('Bリーグ')).toBeInTheDocument();
    for (const name of ['選手1', '選手2', '選手4', '選手5']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('選手3')).toBeNull();
    expect(screen.queryByText('選手6')).toBeNull();
  });

  it('運営が差し替えた人が出る (自動判定ではなく、実際に枠へ入る人)', () => {
    const st = qualifying([slot(0, 1, 'p3', { autoParticipantId: 'p1', manualParticipantId: 'p3' })], true);
    render(<ParticipantListScreen state={st} displayTitle="U15 大会" />);
    expect(screen.getByText('選手3')).toBeInTheDocument();
    expect(screen.queryByText('選手1')).toBeNull();
  });

  it('確定前は (暫定)、予選が終わっていない枠は「—」、不戦の枠は出さない', () => {
    const st = qualifying([slot(0, 1, null), slot(0, 2, null, { bye: true })]);
    render(<ParticipantListScreen state={st} displayTitle="U15 大会" />);

    expect(screen.getByText('決勝トーナメント進出者 (暫定)')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('1名')).toBeInTheDocument();
  });
});
