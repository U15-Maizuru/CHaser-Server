import { useMemo, useState } from 'react';
import type { TournamentStatePayload } from '@u15/ws-types';
import { isTournamentComplete } from '../../lib/tournamentResult';
import { FitArea } from '../FitArea';
import { BracketView } from './BracketView';
import { LeagueTable } from './LeagueTable';
import {
  BORDER_COLOR, COOL_COLOR, FONT_UI, RADIUS_SM, TEXT_PRIMARY, TEXT_SECONDARY,
} from '../../styles/tokens';

// 「予選リーグ + 決勝トーナメント」の全体像。予選のリーグ表を人数ぶん並べ、
// 決勝トーナメント表と切り替えて見せる。
//
// 1画面に全部を詰めない理由: 予選2リーグの星取表と順位表だけで4枚あり、そこへ
// トーナメント表を足すと、観客席のプロジェクターでどれも読めない大きさになる。
// FitArea は空き領域いっぱいまで拡大するので、見せる対象を絞るほど大きく出せる。

export type GroupStagePhase = 'groups' | 'bracket';

/** 予選が全部終わったか (= 既定で決勝トーナメントを見せてよいか) */
export function isGroupStageFinished(state: TournamentStatePayload): boolean {
  const groupMatches = state.matches.filter(m => m.group !== undefined);
  return groupMatches.length > 0 && groupMatches.every(m => m.status === 'done');
}

/**
 * 進行に追従したときの表示 (運営の指定が 'auto' のとき)。
 *
 * **予選が終わっても自動では決勝表へ移らない。** 運営が決勝進出者を確定するまで
 * 予選の最終結果を出し続ける — 順位と勝ち上がりを観客が確かめる時間になり、
 * 同点の枠を運営が見直す機会にもなる。時間で切り替えると、その両方が間に合わない。
 */
export function autoGroupPhase(state: TournamentStatePayload): {
  phase: GroupStagePhase; holdingResult: boolean;
} {
  if (!isGroupStageFinished(state))  return { phase: 'groups',  holdingResult: false };
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
export function displayGroupPhase(state: TournamentStatePayload | null): {
  phase: GroupStagePhase; holdingResult: boolean;
} {
  if (!state) return { phase: 'groups', holdingResult: false };
  if (state.displayView === 'groups')  return { phase: 'groups',  holdingResult: false };
  if (state.displayView === 'bracket') return { phase: 'bracket', holdingResult: false };
  return autoGroupPhase(state);
}

/** 全工程が終わったうえで決勝トーナメント側を見ているか (= 表彰画面を出すべきか) */
export function shouldShowFinale(state: TournamentStatePayload, phase: GroupStagePhase): boolean {
  return isTournamentComplete(state) && phase === 'bracket';
}

export interface GroupStageViewProps {
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
  phase?:       GroupStagePhase;
}

export function GroupStageView({
  state, interactive = false, selectedId = null, onSelect,
  finishedMatchId = null, showTabs = false, maxScale = 3, phase: controlled,
}: GroupStageViewProps) {
  const autoPhase: GroupStagePhase = autoGroupPhase(state).phase;
  // 運営が明示的に選ぶまでは進行に追従する (決勝進出者を確定すると決勝表へ切り替わる)
  const [picked, setPicked] = useState<GroupStagePhase | null>(null);
  const phase = controlled ?? picked ?? autoPhase;

  const bracketMatches = useMemo(
    () => state.matches.filter(m => m.group === undefined), [state.matches],
  );

  const groups = state.groups ?? [];

  const board = phase === 'bracket' ? (
    <BracketView
      matches={bracketMatches}
      participants={state.participants}
      upcomingId={state.armedMatchId}
      finishedId={finishedMatchId}
      interactive={interactive}
      selectedId={selectedId}
      {...(onSelect ? { onSelect } : {})}
      fit
      maxScale={maxScale}
    />
  ) : (
    // リーグ表は個別に fit させず、**まとめて1つの FitArea に入れる**。
    // 表ごとに拡大すると、参加者数の違うリーグが別々の倍率になって不揃いに見える
    <FitArea maxScale={maxScale}>
      {/*
        見出し / 星取表 / 順位表 を3行のグリッドに流し込む (列 = リーグ)。
        リーグごとにチーム数が違うと星取表の高さが変わるので、素直に縦積みすると
        その下の順位表の位置がリーグ間でずれる。行の高さはいちばん高い塊にそろうため、
        グリッドに載せれば星取表の高さに関係なく順位表の上端がそろう。
      */}
      <div style={{ ...groupsGrid, gridTemplateColumns: `repeat(${groups.length}, auto)` }}>
        {groups.map(g => (
          <LeagueTable
            key={g.group}
            title={`${g.label}リーグ`}
            gridCells
            // **そのリーグの試合・参加者だけを渡す。** 全体を渡すと星取表が
            // 他リーグの参加者まで軸に並べ、決勝トーナメントの同じ顔合わせも拾ってしまう
            matches={state.matches.filter(m => m.group === g.group)}
            participants={state.participants.filter(p => g.participantIds.includes(p.id))}
            standings={g.standings}
            upcomingMatchId={state.armedMatchId}
            finishedMatchId={finishedMatchId}
            interactive={interactive}
            {...(onSelect ? { onSelect } : {})}
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
            <button
              key={p}
              style={{ ...tab, ...(phase === p ? tabActive : null) }}
              onClick={() => setPicked(p)}
            >
              {p === 'groups' ? '予選リーグ' : '決勝トーナメント'}
            </button>
          ))}
          {picked !== null && picked !== autoPhase && (
            <button style={tabGhost} onClick={() => setPicked(null)}>進行に合わせる</button>
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
// チーム数の違うリーグ同士でも順位表の上端が一直線に並ぶ
const groupsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateRows: 'auto auto auto',
  // **列方向に流すこと。** 既定 (row) だと1リーグぶんの3つが横に並んでしまい、
  // 「Aリーグの見出し / Bリーグの星取表 / Aリーグの順位表 …」と入り乱れる
  gridAutoFlow: 'column',
  justifyContent: 'center', alignItems: 'start',
  columnGap: 28, rowGap: 12,
};

const tabs: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };

const tab: React.CSSProperties = {
  border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, background: 'transparent',
  color: TEXT_SECONDARY, fontFamily: FONT_UI, fontWeight: 700, fontSize: 12,
  padding: '5px 12px', cursor: 'pointer',
};

const tabActive: React.CSSProperties = {
  background: COOL_COLOR, borderColor: COOL_COLOR, color: '#fff',
};

const tabGhost: React.CSSProperties = {
  ...tab, border: 'none', fontWeight: 400, fontSize: 11,
};
