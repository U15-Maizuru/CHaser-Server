import { afterEach, describe, expect, it } from 'vitest';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  TournamentFormat,
  ResolvedParticipant, StandingRow, TournamentMatch, TournamentStatePayload,
} from '@u15/ws-types';
import { TournamentStandby } from './TournamentStandby';

// 試合と試合の間の観戦画面。表が出ることと、たった今終わった試合が
// トーナメント・リーグの**どちらでも**分かることを確かめる。

afterEach(() => cleanup());

const participants: ResolvedParticipant[] = ['A', 'B', 'C', 'D'].map((name, i) => ({
  id: `p${i + 1}`, name, seed: i + 1,
  programCatalogId: null, builtinCpu: true, programName: '内蔵CPU',
}));

function done(winnerSide: 0 | 1 | null, confirmedAt = 2): TournamentMatch['result'] {
  return {
    roundResults: [], set: null, decidedBy: 'points', winnerSide,
    capturedAt: 1, confirmedAt,
  };
}

function match(
  id: string, stage: number, a: string, b: string, extra: Partial<TournamentMatch> = {},
): TournamentMatch {
  return {
    id, stage, order: 0, label: id,
    slotA: { kind: 'participant', participantId: a },
    slotB: { kind: 'participant', participantId: b },
    resolvedA: a, resolvedB: b, byeA: false, byeB: false,
    status: 'ready',
    ...extra,
  };
}

function standing(participantId: string, rank: number): StandingRow {
  return {
    participantId, played: 1, wins: 0, draws: 0, losses: 0,
    points: 0, totalPoints: 0, itemPoints: 0, strikePoints: 0, sweepPoints: 0,
    items: 0, remainingTurns: 0, rank, tied: false,
  };
}

function state(
  format: TournamentFormat,
  matches: TournamentMatch[],
  standings: StandingRow[] | null = null,
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: false },
    stage: stageRulesFor(format),
    participants, matches, standings, groups: null, qualifiers: null, qualifierCandidates: null, stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    qualifiersConfirmed: false,
    displayView: 'auto', autoPlay: { enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null },
    lanes: [{ roomId: 'room', primary: true, armedMatchId: null }],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
  };
}

describe('TournamentStandby', () => {
  it('運営を始めた直後は表だけを出す (終わった試合はまだ無い)', () => {
    const matches = [
      { ...match('SF1', 0, 'p1', 'p2'), slotA: { kind: 'participant' as const, participantId: 'p1' } },
      match('SF2', 0, 'p3', 'p4'),
    ];
    render(<TournamentStandby state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    expect(screen.getByText('テスト杯')).toBeInTheDocument();
    expect(screen.getByText('まもなく開始します')).toBeInTheDocument();
    expect(screen.queryByText('試合終了')).not.toBeInTheDocument();
  });

  it('トーナメント: 確定した試合のカードと勝者が分かる', () => {
    const matches = [
      match('SF1', 0, 'p1', 'p2', { status: 'done', label: '準決勝 第1試合', result: done(1) }),
      match('SF2', 0, 'p3', 'p4'),
    ];
    render(<TournamentStandby state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    // 見出しの結果ピルに勝者が出る
    expect(screen.getByText('B の勝ち')).toBeInTheDocument();
    // 「試合終了」は表の中の該当カードのバッジだけ (見出しには勝者だけを出す)
    expect(screen.getAllByText('試合終了')).toHaveLength(1);
    expect(screen.getAllByText('準決勝 第1試合').length).toBeGreaterThan(0);
  });

  // 「〜の勝ち」だけでは何勝何敗だったのか・点差だったのかが伝わらない。
  // 第1ゲームのリキャップ (SetupWaiting) と同じ「名前→ポイント→勝ち数→ダッシュ→
  // 勝ち数→ポイント→名前」の左右対称な並びで両者の内訳を添える
  it('トーナメント: 見出しに両者の勝ち数・合計ポイントを左右対称の並びで添える', () => {
    const twoGameResult: TournamentMatch['result'] = {
      roundResults: [{} as never, {} as never],
      set: { wins: [1, 2], totals: [110, 130], draws: 0, winnerSide: 1, decidedBy: 'wins' },
      decidedBy: 'wins', winnerSide: 1, capturedAt: 1, confirmedAt: 2,
    };
    const matches = [
      match('SF1', 0, 'p1', 'p2', { status: 'done', label: '準決勝 第1試合', result: twoGameResult }),
      match('SF2', 0, 'p3', 'p4'),
    ];
    render(<TournamentStandby state={state('single-elimination', matches)} displayTitle="U15 大会" />);

    const row = screen.getByTestId('result-score');
    const texts = [...row.children].map(el => el.textContent);
    expect(texts).toEqual(['A', '110pt', '1勝', '—', '2勝', '130pt', 'B']);

    // アイコンは付けず、色 (太字/緑 vs 沈んだ色) だけで勝敗を見分けられるようにする
    const [nameA, nameB] = within(row).getAllByText(/^(A|B)$/);
    expect(nameA!.style.fontWeight).not.toBe('800');
    expect(nameB!.style.fontWeight).toBe('800');
  });

  // 予選リーグの最終試合が終わった瞬間、holdingGroupResult が true になる。
  // このとき見出しのラベルだけ「予選リーグ 最終結果」に差し替わり、
  // その試合の勝者・スコアは消えずに出続ける必要がある — カードごと消すと、
  // 最後の試合だけ結果を見せずに予選リーグ表の画面へ飛んだように見えてしまう (報告されたバグ)
  it('予選: 最終試合が終わった直後もその試合の勝者・スコアを出し続ける', () => {
    const matches = [
      match('G0-M1', 0, 'p1', 'p2', {
        group: 0, status: 'done', label: '第1節 第1試合', result: done(0, 1),
      }),
      match('G0-M2', 0, 'p3', 'p4', {
        group: 0, status: 'done', label: '第1節 第2試合', result: done(1, 2),
      }),
    ];
    render(
      <TournamentStandby
        state={state('group-then-bracket', matches)}
        displayTitle="U15 大会"
        groupPhase="groups"
        holdingGroupResult
      />,
    );

    // 見出しは「予選リーグ 最終結果」に差し替わる
    expect(screen.getByText('予選リーグ 最終結果')).toBeInTheDocument();
    // それでも confirmedAt が最も新しい試合 (G0-M2: p3 vs p4、winnerSide=1) の
    // 勝者 D は出続ける
    expect(screen.getByText('D の勝ち')).toBeInTheDocument();
    expect(screen.queryByText('第1節 第2試合')).not.toBeInTheDocument();
  });

  // BOT対戦予選も「予選の位相判断は予選リーグと共通」(QualifyingView) なので、同じ経路で
  // holdingGroupResult が立つ。ラベルの呼び名だけ qualifyingLabel で分かれるので、
  // ここが「BOT対戦予選」に差し替わることも確かめる
  it('BOT予選: 最終試合が終わった直後もその試合の勝者を出し続ける', () => {
    const matches = [
      match('B-M1', 0, 'p1', 'bot', {
        group: 0, status: 'done', label: 'BOT対戦予選 第1試合', result: done(0, 1),
      }),
      match('B-M2', 0, 'p2', 'bot', {
        group: 0, status: 'done', label: 'BOT対戦予選 第2試合', result: done(0, 2),
      }),
    ];
    const s: TournamentStatePayload = {
      ...state('bot-then-bracket', matches),
      participants: [
        ...participants,
        {
          id: 'bot', name: '運営BOT', seed: 0,
          programCatalogId: null, builtinCpu: true, programName: '内蔵CPU', isBot: true,
        },
      ],
      groups: [{ group: 0, label: 'A', participantIds: ['p1', 'p2'], standings: [] }],
    };
    render(
      <TournamentStandby
        state={s}
        displayTitle="U15 大会"
        groupPhase="groups"
        holdingGroupResult
      />,
    );

    // 見出しは「BOT対戦予選 最終結果」に差し替わる (予選リーグとは呼び名が違う)
    expect(screen.getByText('BOT対戦予選 最終結果')).toBeInTheDocument();
    // それでも confirmedAt が最も新しい試合 (B-M2: p2 vs bot、winnerSide=0) の勝者 B は出続ける
    expect(screen.getByText('B の勝ち')).toBeInTheDocument();
    expect(screen.queryByText('BOT対戦予選 第2試合')).not.toBeInTheDocument();
  });

  // 決勝進出者を確定すると groupPhase が 'groups' → 'bracket' に切り替わる
  // (holdingGroupResult も false に戻る) が、lastConfirmedMatch はまだ予選の最終試合を
  // 指したまま — 決勝側はまだ1試合も確定していないため。ここで弾かないと、決勝表に
  // 切り替わった直後だけ予選の最終試合のカードが居残って見えてしまう (報告されたバグ)
  it('予選: 決勝進出者を確定して決勝表に切り替わったら、予選最終試合のカードは出さない', () => {
    const matches = [
      match('G0-M1', 0, 'p1', 'p2', {
        group: 0, status: 'done', label: '第1節 第1試合', result: done(0, 1),
      }),
      match('G0-M2', 0, 'p3', 'p4', {
        group: 0, status: 'done', label: '第1節 第2試合', result: done(1, 2),
      }),
      match('SF1', 1, 'p1', 'p4'),
    ];
    render(
      <TournamentStandby
        state={{ ...state('group-then-bracket', matches), qualifiersConfirmed: true }}
        displayTitle="U15 大会"
        groupPhase="bracket"
        holdingGroupResult={false}
      />,
    );

    // 決勝の試合はまだ1つも確定していないので、代わりに「まもなく開始します」になる
    expect(screen.getByText('まもなく開始します')).toBeInTheDocument();
    expect(screen.queryByText('D の勝ち')).not.toBeInTheDocument();
    expect(screen.queryByText('第1節 第2試合')).not.toBeInTheDocument();
  });

  // BOT予選でも同じ経路 (QualifyingView の位相判断が共通) でバグが起きうるので確かめる
  it('BOT予選: 決勝進出者を確定して決勝表に切り替わったら、予選最終試合のカードは出さない', () => {
    const matches = [
      match('B-M1', 0, 'p1', 'bot', {
        group: 0, status: 'done', label: 'BOT対戦予選 第1試合', result: done(0, 1),
      }),
      match('B-M2', 0, 'p2', 'bot', {
        group: 0, status: 'done', label: 'BOT対戦予選 第2試合', result: done(0, 2),
      }),
      match('SF1', 1, 'p1', 'p2'),
    ];
    const s: TournamentStatePayload = {
      ...state('bot-then-bracket', matches),
      qualifiersConfirmed: true,
      participants: [
        ...participants,
        {
          id: 'bot', name: '運営BOT', seed: 0,
          programCatalogId: null, builtinCpu: true, programName: '内蔵CPU', isBot: true,
        },
      ],
      groups: [{ group: 0, label: 'A', participantIds: ['p1', 'p2'], standings: [] }],
    };
    render(
      <TournamentStandby
        state={s}
        displayTitle="U15 大会"
        groupPhase="bracket"
        holdingGroupResult={false}
      />,
    );

    expect(screen.getByText('まもなく開始します')).toBeInTheDocument();
    expect(screen.queryByText('B の勝ち')).not.toBeInTheDocument();
    expect(screen.queryByText('BOT対戦予選 第2試合')).not.toBeInTheDocument();
  });

  // 決勝トーナメントの同点は confirmResult できない (再試合か審判裁定が要る) が、運営が
  // 「この結果で確定」で認めた (tieAcknowledged) 時点でスコアは観客に見せてよい。
  // armedMatchId はこの試合を指したまま (再試合/裁定はまだ選んでいない) なので、
  // lastConfirmedMatch (confirmedAt 済みだけ) より優先して拾えているかを確かめる
  it('同点を「この結果で確定」で認めた試合は、確定を待たず「引き分け」とスコアを見せる', () => {
    const tiedResult: TournamentMatch['result'] = {
      roundResults: [{} as never, {} as never],
      set: { wins: [1, 1], totals: [100, 100], draws: 0, winnerSide: null, decidedBy: null },
      decidedBy: 'points', winnerSide: null, capturedAt: 1,
    };
    const matches = [
      match('SF1', 0, 'p1', 'p2', {
        status: 'awaiting_confirm', label: '準決勝 第1試合', result: tiedResult, tieAcknowledged: true,
      }),
      match('SF2', 0, 'p3', 'p4'),
      {
        ...match('FINAL', 1, 'p1', 'p3'),
        slotA: { kind: 'winner-of' as const, matchId: 'SF1' },
        slotB: { kind: 'winner-of' as const, matchId: 'SF2' },
      },
    ];
    const st: TournamentStatePayload = { ...state('single-elimination', matches), armedMatchId: 'SF1' };
    render(<TournamentStandby state={st} displayTitle="U15 大会" />);

    expect(screen.getByText('引き分け')).toBeInTheDocument();
    expect(screen.queryByText(/の勝ち/)).not.toBeInTheDocument();
    const row = screen.getByTestId('result-score');
    expect([...row.children].map(el => el.textContent)).toEqual(['A', '100pt', '1勝', '—', '1勝', '100pt', 'B']);
  });

  it('決着していない同点 (tieAcknowledged がまだ立っていない) は、いつもどおり「まもなく開始します」のまま', () => {
    const tiedResult: TournamentMatch['result'] = {
      roundResults: [{} as never, {} as never],
      set: { wins: [1, 1], totals: [100, 100], draws: 0, winnerSide: null, decidedBy: null },
      decidedBy: 'points', winnerSide: null, capturedAt: 1,
    };
    const matches = [
      match('SF1', 0, 'p1', 'p2', {
        status: 'awaiting_confirm', label: '準決勝 第1試合', result: tiedResult,
      }),
      match('SF2', 0, 'p3', 'p4'),
    ];
    const st: TournamentStatePayload = { ...state('single-elimination', matches), armedMatchId: 'SF1' };
    render(<TournamentStandby state={st} displayTitle="U15 大会" />);

    expect(screen.getByText('まもなく開始します')).toBeInTheDocument();
    expect(screen.queryByText('引き分け')).not.toBeInTheDocument();
  });

  it('リーグ: 確定した試合のセットが星取表で強調される', () => {
    const matches = [
      match('L-D1M1', 0, 'p1', 'p2', { status: 'done', label: '第1節 第1試合', result: done(0) }),
      match('L-D1M2', 0, 'p3', 'p4'),
    ];
    const standings = [standing('p1', 1), standing('p2', 2), standing('p3', 3), standing('p4', 4)];
    render(<TournamentStandby state={state('league', matches, standings)} displayTitle="U15 大会" />);

    expect(screen.getByText('第1節 第1試合')).toBeInTheDocument();
    expect(screen.getByText('A の勝ち')).toBeInTheDocument();

    // 星取表は対称なので (A,B) と (B,A) の2セルが光る
    const cross = screen.getAllByRole('table')[0]!;
    const marked = within(cross).getAllByRole('cell')
      .filter(td => td.style.outline.includes('solid'));
    expect(marked).toHaveLength(2);
  });
});
