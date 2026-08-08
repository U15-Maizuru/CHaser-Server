import type { TournamentStatePayload } from '@u15/ws-types';
import { BracketView } from './BracketView';
import { LeagueTable } from './LeagueTable';
import { lastConfirmedMatch, medalOf, podiumOf } from '../../lib/tournamentResult';
import {
  BG_CARD, BG_ROOT, GOLD_BASE, GOLD_LIGHT,
  RADIUS_MD, SHADOW_MD, SHADOW_SM,
  TEXT_PRIMARY, TEXT_SECONDARY,
  FONT_UI,
} from '../../ui';

// 大会の全試合が確定したあと、観戦用画面に出す表彰画面。
//
// 骨格は DisplayMode の待機画面 (SetupWaiting) と同じ — 上段は自然な高さ、下段の
// トーナメント表 / リーグ表が残りの高さを全部もらって fit で最大化する。
// これをやらないと、プロジェクタでは表が下端で切れるか、豆粒のまま残るかのどちらかになる。

export interface TournamentFinaleProps {
  state:        TournamentStatePayload;
  displayTitle: string;
}

export function TournamentFinale({ state, displayTitle }: TournamentFinaleProps) {
  const podium   = podiumOf(state);
  // 最後に確定した試合 (ふつうは決勝) は、待機画面と同じように表の中でも示す
  const finished = lastConfirmedMatch(state);

  return (
    <div style={s.root}>
      <div style={s.titleWrap}>
        <div style={s.eyebrow}>{displayTitle}</div>
        <div style={s.title}>{state.name}</div>
        <div style={s.sub}>全試合終了</div>
      </div>

      {podium.length > 0 && (
        <div style={s.podium}>
          {podium.map(row => (
            <div key={row.rank} style={{ ...s.row, ...(row.rank === 1 ? s.rowTop : null) }}>
              <span style={row.rank === 1 ? s.medalTop : s.medal}>{medalOf(row.rank)}</span>
              <span style={row.rank === 1 ? s.labelTop : s.label}>{row.label}</span>
              <span style={row.rank === 1 ? s.nameTop : s.name}>{row.names.join(' ・ ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* 最終結果の表。次の試合はもう無いので upcoming の強調は渡さない */}
      <div style={s.figure}>
        {state.stage.format === 'league' ? (
          <LeagueTable
            matches={state.matches}
            participants={state.participants}
            standings={state.standings ?? []}
            finishedMatchId={finished?.id ?? null}
            fit
          />
        ) : (
          <BracketView
            // **決勝トーナメントの試合だけを渡す。** 予選リーグの試合を混ぜると
            // 節ごとに列が増え、列見出しが「Aリーグ」になって表が壊れる。
            // 表彰の場で見せるのは勝ち上がりの結果だけでよい (予選表は別途切り替えて出せる)
            matches={state.matches.filter(m => m.group === undefined)}
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
    textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
  },
  eyebrow: { fontSize: 14, color: TEXT_SECONDARY, letterSpacing: '0.1em' },
  title:   { fontSize: 38, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub: {
    fontSize: 13, fontWeight: 800, letterSpacing: '0.2em',
    color: '#fff', background: GOLD_BASE,
    borderRadius: 99, padding: '4px 18px', alignSelf: 'center',
  },

  // 表彰台。優勝だけ一段大きく、金の枠で囲う
  podium: {
    flexShrink: 0, alignSelf: 'center',
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '16px 28px', background: BG_CARD,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '4px 12px', borderRadius: 99,
  },
  rowTop: {
    background: GOLD_LIGHT, border: `2px solid ${GOLD_BASE}`,
    padding: '8px 18px', boxShadow: SHADOW_SM,
  },

  medal:    { fontSize: 22 },
  medalTop: { fontSize: 34 },

  label:    { fontSize: 14, color: TEXT_SECONDARY, minWidth: 72 },
  labelTop: { fontSize: 18, fontWeight: 700, color: GOLD_BASE, minWidth: 72 },

  name:    { fontSize: 24, fontWeight: 700, color: TEXT_PRIMARY },
  nameTop: { fontSize: 44, fontWeight: 800, color: TEXT_PRIMARY, letterSpacing: '0.02em' },

  // 残りの高さを全部渡す。中で fit が図を最大化する
  figure: { flex: 1, minHeight: 0, width: '100%' },
};
