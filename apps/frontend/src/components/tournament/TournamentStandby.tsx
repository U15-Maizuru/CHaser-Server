import type { TournamentStatePayload } from '@u15/ws-types';
import { hasQualifying } from '@u15/ws-types';
import { BracketView } from './BracketView';
import { QualifyingView, qualifyingLabel, type QualifyingPhase } from './QualifyingView';
import { LeagueTable } from './LeagueTable';
import { lastConfirmedMatch, winnerNameOf } from '../../lib/tournamentResult';
import {
  BG_ROOT, RADIUS_MD, SHADOW_SM,
  TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE, WIN_LIGHT, WIN_PALE,
  FONT_UI,
} from '../../styles/tokens';

// 試合と試合の間の観戦用画面。トーナメント表 / リーグ表だけを画面いっぱいに見せる。
//
// 「この大会を運営」した直後から、「この試合を準備」で対戦カードが決まるまでの間と、
// 試合を「確定」してから次の試合を準備するまでの間がこの画面。確定直後は、たった今
// 終わった試合を表の中で強調して「どれが終わったのか」を観客に示す。

export interface TournamentStandbyProps {
  state:        TournamentStatePayload;
  displayTitle: string;
  /** 予選ありのとき、いま出すもの (運営パネルの指定 + 自動追従の結果) */
  groupPhase?:  QualifyingPhase;
  /** 予選が終わった直後の据え置き中。見出しを「予選リーグ 最終結果」に差し替える */
  holdingGroupResult?: boolean;
}

export function TournamentStandby({
  state, displayTitle, groupPhase, holdingGroupResult = false,
}: TournamentStandbyProps) {
  const finished = lastConfirmedMatch(state);
  const winner   = finished ? winnerNameOf(state, finished) : null;

  return (
    <div style={s.root}>
      <div style={s.titleWrap}>
        <div style={s.eyebrow}>{displayTitle}</div>
        <div style={s.title}>{state.name}</div>
        {holdingGroupResult ? (
          <div style={s.result}>
            <span style={s.resultLabel}>{qualifyingLabel(state)}</span>
            <span style={s.resultName}>最終結果</span>
          </div>
        ) : finished ? (
          <div style={s.result}>
            {/* <span style={s.resultTag}>試合終了</span> */}
            <span style={s.resultLabel}>{finished.label}</span>
            <span style={s.resultName}>{winner ? `${winner} の勝ち` : '決着なし'}</span>
          </div>
        ) : (
          <div style={s.sub}>まもなく開始します</div>
        )}
      </div>

      <div style={s.figure}>
        {hasQualifying(state.format) ? (
          <QualifyingView state={state} finishedMatchId={finished?.id ?? null} phase={groupPhase} />
        ) : state.format === 'league' ? (
          <LeagueTable
            matches={state.matches}
            participants={state.participants}
            standings={state.standings ?? []}
            finishedMatchId={finished?.id ?? null}
            fit
          />
        ) : (
          <BracketView
            matches={state.matches}
            participants={state.participants}
            finishedId={finished?.id ?? null}
            fit
          />
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16, padding: '20px 16px',
    boxSizing: 'border-box', overflow: 'hidden',
  },

  titleWrap: {
    textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8,
    alignItems: 'center', flexShrink: 0,
  },
  eyebrow: { fontSize: 14, color: TEXT_SECONDARY, letterSpacing: '0.1em' },
  title:   { fontSize: 34, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:     { fontSize: 16, color: TEXT_SECONDARY },

  // たった今終わった試合。表の中の強調 (ミント) と同じ色で結ぶ
  result: {
    display: 'flex', alignItems: 'center', gap: 14,
    background: WIN_PALE, border: `2px solid ${WIN_LIGHT}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM, padding: '8px 22px',
  },
  resultTag: {
    fontSize: 12, fontWeight: 800, letterSpacing: '0.1em',
    color: '#fff', background: WIN_BASE, borderRadius: 99, padding: '3px 12px',
  },
  resultLabel: { fontSize: 14, color: TEXT_SECONDARY },
  resultName:  { fontSize: 22, fontWeight: 800, color: TEXT_PRIMARY },

  // 残りの高さを全部渡す。中で fit が図を最大化する
  figure: { flex: 1, minHeight: 0, width: '100%' },
};
