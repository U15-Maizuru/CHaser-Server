import { useMemo, useState } from 'react';
import type { GroupStanding, TournamentStatePayload } from '@u15/ws-types';
import { advancePerGroupOf, hasBotStage, hasQualifying } from '@u15/ws-types';
import { isTournamentComplete } from '../../../lib/tournamentResult';
import { FitArea } from '../../FitArea';
import { BotStageBoard } from './BotStageBoard';
import { BracketView } from './BracketView';
import { LeagueTable } from './LeagueTable';
import { Button, FONT_UI, TEXT_PRIMARY } from '../../../ui';

// 「予選 + 決勝トーナメント」の全体像。予選の表と決勝トーナメント表を切り替えて見せる。
//
// 予選の中身は形式ごとに違うが (リーグの星取表 / BOT対戦の順位リスト)、
// **「いま予選と決勝のどちらを出すか」の判断は完全に共通**なので、その位相だけをここに置く。
// 分けて書くと、片方だけ「決勝進出者の確定を待つ」を実装し忘れて事故になる。
//
// 1画面に全部を詰めない理由: 予選2リーグの星取表と順位表だけで4枚あり、そこへ
// トーナメント表を足すと、観客席のプロジェクターでどれも読めない大きさになる。
// FitArea は空き領域いっぱいまで拡大するので、見せる対象を絞るほど大きく出せる。

export type QualifyingPhase = 'groups' | 'bracket';

/** 予選が全部終わったか (= 既定で決勝トーナメントを見せてよいか) */
export function isQualifyingFinished(state: TournamentStatePayload): boolean {
  const qualifying = state.matches.filter(m => m.group !== undefined);
  return qualifying.length > 0 && qualifying.every(m => m.status === 'done');
}

/**
 * 進行に追従したときの表示 (運営の指定が 'auto' のとき)。
 *
 * **予選が終わっても自動では決勝表へ移らない。** 運営が決勝進出者を確定するまで
 * 予選の最終結果を出し続ける — 順位と勝ち上がりを観客が確かめる時間になり、
 * 同点の枠を運営が見直す機会にもなる。時間で切り替えると、その両方が間に合わない。
 */
export function autoQualifyingPhase(state: TournamentStatePayload): {
  phase: QualifyingPhase; holdingResult: boolean;
} {
  // 予選を持たない形式に「予選表」は無いので、常に決勝側 (通常のトーナメント表 / リーグ表)。
  // ここを 'groups' に倒すと、観戦画面の表彰画面 (shouldShowFinale) が
  // **トーナメント・リーグの大会で永久に出ない**
  if (!hasQualifying(state.stage.format))  return { phase: 'bracket', holdingResult: false };
  if (!isQualifyingFinished(state))  return { phase: 'groups',  holdingResult: false };
  if (state.qualifiersConfirmed)     return { phase: 'bracket', holdingResult: false };
  return { phase: 'groups', holdingResult: true };
}

/**
 * 観戦画面が「いま何を出すか」。
 *
 * 運営が明示的に選んでいればそれに従い、'auto' なら進行に追従する
 * (= 決勝進出者の確定を待つ)。運営が手で選んでいる間は据え置きの見出しを出さない —
 * 「確定待ち」ではなく運営が意図して出している表だから。
 */
export function displayQualifyingPhase(state: TournamentStatePayload | null): {
  phase: QualifyingPhase; holdingResult: boolean;
} {
  if (!state) return { phase: 'groups', holdingResult: false };
  if (state.displayView === 'groups')  return { phase: 'groups',  holdingResult: false };
  if (state.displayView === 'bracket') return { phase: 'bracket', holdingResult: false };
  return autoQualifyingPhase(state);
}

/** 予選の呼び名。見出し・タブ・据え置きの文言で使う */
export function qualifyingLabel(state: TournamentStatePayload): string {
  return hasBotStage(state.stage.format) ? 'BOT対戦予選' : '予選リーグ';
}

/**
 * そのグループから実際に上がる人。**運営が枠を手で差し替えたときだけ**返す。
 *
 * 差し替えが無ければ null を返し、順位表には「上位 advancePerGroup 人」を位置で塗らせる —
 * 予選の途中は枠がまだ埋まっていない (pending) ので、枠を見て塗ると通過圏が消えてしまう。
 */
function overriddenQualifiers(
  state: TournamentStatePayload, group: number,
): string[] | null {
  const slots = (state.qualifiers ?? []).filter(q => q.group === group);
  if (!slots.some(q => q.manualParticipantId !== null)) return null;
  return slots.map(q => q.participantId).filter((id): id is string => id !== null);
}

/**
 * 1つのリーグを LeagueTable に渡すための props。単独で大きく見せる場合 (finishedGroup)
 * と、全リーグを並べたグリッドの1マスとして見せる場合 (groupsGrid) の両方で使う —
 * 「そのリーグの試合・参加者だけを渡す」「順位表は上位 advancePerGroup 人までを
 * 強調する」という組み立て方自体は表示のしかたに関係なく同じなため。
 */
function groupTableProps(
  state: TournamentStatePayload, g: GroupStanding,
  finishedMatchId: string | null, interactive: boolean, onSelect?: (matchId: string) => void,
) {
  return {
    title:            `${g.label}リーグ`,
    // **そのリーグの試合・参加者だけを渡す。** 全体を渡すと星取表が
    // 他リーグの参加者まで軸に並べ、決勝トーナメントの同じ顔合わせも拾ってしまう
    matches:          state.matches.filter(m => m.group === g.group),
    participants:     state.participants.filter(p => g.participantIds.includes(p.id)),
    standings:        g.standings,
    advanceCount:     advancePerGroupOf(state.stage),
    qualifiedIds:     overriddenQualifiers(state, g.group),
    upcomingMatchId:  state.armedMatchId,
    finishedMatchId,
    interactive,
    ...(onSelect ? { onSelect } : {}),
  };
}

/** 全工程が終わったうえで決勝トーナメント側を見ているか (= 表彰画面を出すべきか) */
export function shouldShowFinale(state: TournamentStatePayload, phase: QualifyingPhase): boolean {
  return isTournamentComplete(state) && phase === 'bracket';
}

export interface QualifyingViewProps {
  state: TournamentStatePayload;
  /** 運営席では試合を選べる */
  interactive?: boolean;
  selectedId?:  string | null;
  onSelect?:    (matchId: string) => void;
  /** たった今確定した試合 (観戦画面の強調用) */
  finishedMatchId?: string | null;
  /** 切り替えタブを出すか。観戦画面では出さず、進行に合わせて自動で切り替える */
  showTabs?:    boolean;
  /** 拡大の上限。観戦画面 (プロジェクタ) は大きく、操作する画面は控えめに */
  maxScale?:    number;
  /** 表示するものを外から決める (観戦画面は運営パネルの指定に従う)。渡すとタブは出ない */
  phase?:       QualifyingPhase;
}

export function QualifyingView({
  state, interactive = false, selectedId = null, onSelect,
  finishedMatchId = null, showTabs = false, maxScale = 3, phase: controlled,
}: QualifyingViewProps) {
  const autoPhase: QualifyingPhase = autoQualifyingPhase(state).phase;
  // 運営が明示的に選ぶまでは進行に追従する (決勝進出者を確定すると決勝表へ切り替わる)
  const [picked, setPicked] = useState<QualifyingPhase | null>(null);
  const phase = controlled ?? picked ?? autoPhase;

  const bracketMatches = useMemo(
    () => state.matches.filter(m => m.group === undefined), [state.matches],
  );

  const groups = state.groups ?? [];

  // たった今終わった試合が予選リーグのものなら、そのリーグだけを大きく見せる。
  // 全リーグを並べた表 (下の groupsGrid) は星取表の下に順位表を積むしかないが、
  // 1リーグに絞れば LeagueTable の fit (横並び) が使えて、観客にはそちらのほうが
  // 見やすい。試合が確定していない・確定した試合が決勝側のときは null のまま
  // (=== 下の groupsGrid にフォールバック)
  const finishedMatch = finishedMatchId != null
    ? state.matches.find(m => m.id === finishedMatchId) ?? null
    : null;
  const finishedGroup = finishedMatch?.group != null
    ? groups.find(g => g.group === finishedMatch.group) ?? null
    : null;

  const board = phase === 'bracket' ? (
    <BracketView
      matches={bracketMatches}
      participants={state.participants}
      format={state.stage.format}
      upcomingId={state.armedMatchId}
      finishedId={finishedMatchId}
      interactive={interactive}
      selectedId={selectedId}
      {...(onSelect ? { onSelect } : {})}
      fit
      maxScale={maxScale}
    />
  ) : hasBotStage(state.stage.format) ? (
    <BotStageBoard
      state={state}
      maxScale={maxScale}
      interactive={interactive}
      {...(onSelect ? { onSelect } : {})}
      finishedMatchId={finishedMatchId}
    />
  ) : finishedGroup ? (
    // 試合直後は当該リーグだけを、星取表と順位表を横に並べて出す
    // (LeagueTable 自身の fit と同じ並び方 — 上の説明を参照)
    <LeagueTable
      {...groupTableProps(state, finishedGroup, finishedMatchId, interactive, onSelect)}
      fit
      maxScale={maxScale}
    />
  ) : (
    // リーグ表は個別に fit させず、**まとめて1つの FitArea に入れる**。
    // 表ごとに拡大すると、参加者数の違うリーグが別々の倍率になって不揃いに見える
    <FitArea maxScale={maxScale}>
      {/*
        見出し / 星取表 / 順位表 を3行のグリッドに流し込む (列 = リーグ)。
        リーグごとにプレイヤー数が違うと星取表の高さが変わるので、素直に縦積みすると
        その下の順位表の位置がリーグ間でずれる。行の高さはいちばん高い塊にそろうため、
        グリッドに載せれば星取表の高さに関係なく順位表の上端がそろう。
      */}
      <div style={{ ...groupsGrid, gridTemplateColumns: `repeat(${groups.length}, auto)` }}>
        {groups.map(g => (
          <LeagueTable
            key={g.group}
            gridCells
            {...groupTableProps(state, g, finishedMatchId, interactive, onSelect)}
          />
        ))}
      </div>
    </FitArea>
  );

  return (
    <div style={root}>
      {showTabs && controlled === undefined && (
        <div style={tabs}>
          {(['groups', 'bracket'] as const).map(p => (
            <Button
              key={p}
              variant="choice"
              size="sm"
              selected={phase === p}
              onClick={() => setPicked(p)}
            >
              {p === 'groups' ? qualifyingLabel(state) : '決勝トーナメント'}
            </Button>
          ))}
          {picked !== null && picked !== autoPhase && (
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              進行に合わせる
            </Button>
          )}
        </div>
      )}
      <div style={board_}>{board}</div>
    </div>
  );
}

const root: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0,
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
};

// FitArea の親は高さの決まった箱にすること (中身を絶対配置で流れから外すため)
const board_: React.CSSProperties = { flex: 1, minHeight: 0 };

// 列 = リーグ、行 = 見出し / 星取表 / 順位表。行の高さが最大値にそろうので、
// プレイヤー数の違うリーグ同士でも順位表の上端が一直線に並ぶ
const groupsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateRows: 'auto auto auto',
  // **列方向に流すこと。** 既定 (row) だと1リーグぶんの3つが横に並んでしまい、
  // 「Aリーグの見出し / Bリーグの星取表 / Aリーグの順位表 …」と入り乱れる
  gridAutoFlow: 'column',
  justifyContent: 'center', alignItems: 'start',
  columnGap: 28, rowGap: 12,
};

// 見た目は共通の Button (choice / ghost) に任せる。ここで枠線と塗りを書き起こすと、
// 運営パネルの同じ役割のボタンとだんだんずれる
const tabs: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
