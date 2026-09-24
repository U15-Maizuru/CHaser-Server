import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NO_ANNOUNCEMENT } from '@u15/ws-types';
import type { AnnouncementState, TournamentFormat, TournamentStatePayload } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { stageRulesFor } from '../../../test/tournamentFixture';
import { DisplayTab, displayPinned } from './DisplayTab';

// 観戦画面の表示を切り替える専用タブ。ボタンが正しいコマンドを送ることと、形式ごとに
// 意味のある選択肢だけが並ぶこと、指定中の印が出ることを見る。

afterEach(() => cleanup());

function state(
  format: TournamentFormat, over: Partial<TournamentStatePayload> = {},
): TournamentStatePayload {
  return {
    tournamentId: 'cup', name: 'テスト杯', ruleSet: 'maizuru',
    match: { doubleMode: false }, stage: stageRulesFor(format),
    participants: [], matches: [], standings: null, groups: null, qualifiers: null,
    qualifierCandidates: null, stageMaps: [], thirdPlaceMapId: null, stageLabels: [],
    qualifiersConfirmed: false,
    displayView: 'auto', bracketView: 'auto', groupView: 'auto',
    autoPlay: { enabled: false, loop: false, announce: false, tieBreak: 'pause', stoppedReason: null },
    lanes: [{ roomId: 'room', primary: true, armedMatchId: null }],
    armedMatchId: null, boundRoomId: 'room', updatedAt: 0,
    ...over,
  };
}

const twoGroups = [
  { group: 0, label: 'A', participantIds: [], standings: [] },
  { group: 1, label: 'B', participantIds: [], standings: [] },
];

function setup(s: TournamentStatePayload, announcement: AnnouncementState = NO_ANNOUNCEMENT) {
  const commands = {
    setDisplayView: vi.fn(), setBracketView: vi.fn(), setGroupView: vi.fn(),
  } as unknown as TournamentCommands;
  render(
    <DisplayTab state={s} commands={commands} announcement={announcement} setAnnouncement={vi.fn()} />,
  );
  return commands;
}

const button = (name: string) => screen.getByRole('button', { name });

describe('DisplayTab — 選択肢は形式に合うものだけ', () => {
  it('トーナメント: 進行 / 参加者一覧 と トーナメントの型。予選の表・決勝進出者・リーグ指定は無い', () => {
    setup(state('single-elimination'));
    expect(button('進行に合わせる')).toBeTruthy();
    expect(button('参加者一覧')).toBeTruthy();
    expect(button('準々決勝〜決勝')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '予選リーグ表' })).toBeNull();
    expect(screen.queryByRole('button', { name: '決勝進出者' })).toBeNull();
    expect(screen.queryByRole('button', { name: '全リーグ' })).toBeNull();
  });

  it('リーグ戦: 表の見せ方の節そのものが無い (切り出す表が無い)', () => {
    setup(state('league'));
    expect(screen.queryByText('表の見せ方')).toBeNull();
    expect(button('参加者一覧')).toBeTruthy();
  });

  it('予選リーグ(2リーグ): 予選表・決勝表・決勝進出者・リーグ指定が並ぶ', () => {
    setup(state('group-then-bracket', { groups: twoGroups }));
    for (const name of ['予選リーグ表', '決勝トーナメント表', '決勝進出者', '全リーグ', 'Aリーグ', 'Bリーグ']) {
      expect(button(name)).toBeTruthy();
    }
  });

  it('予選リーグが1つだけなら、リーグ指定は出さない', () => {
    setup(state('group-then-bracket', { groups: [twoGroups[0]!] }));
    expect(screen.queryByRole('button', { name: '全リーグ' })).toBeNull();
    expect(screen.getByText('トーナメント')).toBeTruthy();
  });

  it('BOT対戦予選は「BOT対戦予選の表」と呼ぶ', () => {
    setup(state('bot-then-bracket'));
    expect(button('BOT対戦予選の表')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '予選リーグ表' })).toBeNull();
  });
});

describe('DisplayTab — 操作', () => {
  it('ボタンが対応するコマンドを送る', () => {
    const c = setup(state('group-then-bracket', { groups: twoGroups }));
    fireEvent.click(button('予選リーグ表'));
    fireEvent.click(button('決勝進出者'));
    fireEvent.click(button('Bリーグ'));
    fireEvent.click(button('左ブロック'));
    expect(c.setDisplayView).toHaveBeenNthCalledWith(1, 'groups');
    expect(c.setDisplayView).toHaveBeenNthCalledWith(2, 'qualifiers');
    expect(c.setGroupView).toHaveBeenCalledWith(1);
    expect(c.setBracketView).toHaveBeenCalledWith('left');
  });

  it('「すべて自動に戻す」は指定している軸だけを自動に戻す', () => {
    const c = setup(state('group-then-bracket', { groups: twoGroups, groupView: 0 }));
    fireEvent.click(button('すべて自動に戻す'));
    expect(c.setGroupView).toHaveBeenCalledWith('auto');
    expect(c.setBracketView).not.toHaveBeenCalled();
  });
});

describe('DisplayTab — 指定中の印', () => {
  it('何も指定していなければ「指定中」も「戻す」も出ない', () => {
    setup(state('single-elimination'));
    expect(screen.queryByText('指定中')).toBeNull();
    expect(screen.queryByRole('button', { name: 'すべて自動に戻す' })).toBeNull();
  });

  it('画面を指定していると、その節に「指定中」が出る', () => {
    setup(state('single-elimination', { displayView: 'participants' }));
    const section = screen.getByText('観戦画面の内容').closest('div')!.parentElement!;
    expect(within(section).getByText('指定中')).toBeTruthy();
  });

  it('表の見せ方を指定していると、その節に「指定中」と戻すボタンが出る', () => {
    setup(state('single-elimination', { bracketView: 'quarter' }));
    expect(screen.getByText('指定中')).toBeTruthy();
    expect(button('すべて自動に戻す')).toBeTruthy();
  });

  it('表を指定している間は直前の結果を出さないことを伝える', () => {
    setup(state('group-then-bracket', { groups: twoGroups, displayView: 'groups' }));
    expect(screen.getByText(/直前の試合の結果を出しません/)).toBeTruthy();
  });
});

describe('displayPinned (タブの見出しの印)', () => {
  const s = state('single-elimination');
  it('何も指定していなければ false', () => {
    expect(displayPinned(s, NO_ANNOUNCEMENT)).toBe(false);
  });
  it.each([
    ['画面', { displayView: 'participants' as const }],
    ['予選リーグ', { groupView: 0 as const }],
    ['トーナメント', { bracketView: 'left' as const }],
  ])('%sを指定していれば true', (_n, over) => {
    expect(displayPinned({ ...s, ...over }, NO_ANNOUNCEMENT)).toBe(true);
  });
  it('アナウンスを出していれば true', () => {
    expect(displayPinned(s, { ...NO_ANNOUNCEMENT, visible: true })).toBe(true);
  });
});
