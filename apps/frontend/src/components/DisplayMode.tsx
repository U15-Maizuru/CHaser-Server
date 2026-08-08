import type { InlineMapData, ServerStatusPayload, TournamentStatePayload } from '@u15/ws-types';
import { DEFAULT_DISPLAY_PREFS, hasQualifying, MapObject } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useGamePhaseSound } from '../hooks/useGamePhaseSound';
import { useStartCountdown } from '../hooks/useStartCountdown';
import { useBgm } from '../hooks/useBgm';
import { useCurrentMap } from '../hooks/useCurrentMap';
import { useTextures } from '../hooks/useTextures';
import { MainWindow } from './MainWindow';
import { FitArea } from './FitArea';
import { MapThumbnail } from './MapThumbnail';
import { sourceLabel } from './MapSourceSection';
import { BracketView } from './tournament/BracketView';
import { QualifyingView, displayQualifyingPhase } from './tournament/QualifyingView';
import type { QualifyingPhase } from './tournament/QualifyingView';
import { LeagueTable } from './tournament/LeagueTable';
import { TournamentFinale } from './tournament/TournamentFinale';
import { TournamentStandby } from './tournament/TournamentStandby';
import { isTournamentComplete } from '../lib/tournamentResult';
import { idxForSide } from '../lib/roundSide';
import { roundPointsFor } from '../lib/setResult';
import {
  BG_ROOT, BG_CARD,
  COOL_COLOR, COOL_DARK, COOL_PALE,
  HOT_COLOR,  HOT_DARK,  HOT_PALE,
  TURN_BASE, TURN_LIGHT,
  WIN_BASE, WIN_LIGHT,
  GOLD_BASE, GOLD_LIGHT,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD, SHADOW_SM,
  RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../ui';

export function DisplayMode({ wsUrl, roomId, httpBase }: { wsUrl: string; roomId: string; httpBase: string }) {
  const state   = useGameState(wsUrl, roomId);
  const { serverStatus, snapshot, turnInfo, gameEnd, isConnected, tournamentState } = state;
  const prefs = serverStatus?.displayPrefs ?? DEFAULT_DISPLAY_PREFS;
  const phase = serverStatus?.phase ?? 'setup';
  // 大会中でなければ結果は使われない
  const groupView = displayQualifyingPhase(tournamentState);

  useGamePhaseSound(snapshot, serverStatus, gameEnd, turnInfo, prefs.muted, true);
  const countdown = useStartCountdown(serverStatus?.phase, turnInfo);
  useBgm(httpBase, serverStatus?.phase, prefs.bgmTrack, prefs.bgmMuted, true);
  // 待機中にこれから戦うマップを見せる (対戦中は盤面そのものが出るので使わない)
  const { currentMap } = useCurrentMap(httpBase, roomId, isConnected, serverStatus);

  if (!isConnected) {
    return (
      <div style={splash.root}>
        <div style={splash.title}>{prefs.displayTitle}</div>
        <div style={splash.sub}>バックエンドに接続中...</div>
      </div>
    );
  }

  // ── 大会運営中の出し分け ──────────────────────────────────────────────────
  //
  // 対戦中 (playing) はどの場合も盤面が主役。それ以外は armedMatchId が分かれ目になる:
  //
  //   armed 無し … 運営を始めた直後 / 試合を確定した直後 → 表だけを大きく見せる
  //   armed 有り … 「この試合を準備」以降 → 準備画面、対戦が終われば結果画面
  //
  // 確定しても phase は 'finished' のまま (バックエンドはルームに触れない) なので、
  // armedMatchId を見ないと結果画面から抜けられない。最後の試合には次の arm も無い。
  //
  // 予選ありの大会では「予選表 / 決勝表 のどちらを出すか」を運営パネルが決める
  // (運営席の表示とは連動しない)。全工程が終わったうえで決勝側を見ていれば表彰画面。
  if (tournamentState && phase !== 'playing') {
    if (groupView.phase === 'bracket' && isTournamentComplete(tournamentState)) {
      return <TournamentFinale state={tournamentState} displayTitle={prefs.displayTitle} />;
    }
    if (!tournamentState.armedMatchId) {
      return (
        <TournamentStandby
          state={tournamentState}
          displayTitle={prefs.displayTitle}
          groupPhase={groupView.phase}
          holdingGroupResult={groupView.holdingResult}
        />
      );
    }
  }

  if (phase === 'setup') {
    return (
      <SetupWaiting
        serverStatus={serverStatus}
        displayTitle={prefs.displayTitle}
        tournament={tournamentState}
        groupPhase={groupView.phase}
        currentMap={currentMap}
        theme={prefs.theme}
      />
    );
  }

  return (
    <div style={{ height: '100vh' }}>
      <MainWindow
        snapshot={snapshot}
        turnInfo={turnInfo}
        gameEnd={gameEnd}
        serverStatus={serverStatus}
        isConnected={isConnected}
        phase={phase}
        theme={prefs.theme}
        veilAlpha={prefs.veilAlpha}
        variant="display"
        countdown={countdown}
        displayTitle={prefs.displayTitle}
      />
    </div>
  );
}

// ── 待機画面 ──────────────────────────────────────────────────────────────────

const STATE_LABEL: Record<string, string> = {
  waiting:   '接続待ち',
  connected: '接続中...',
  ready:     '準備完了',
};

function stateBadgeStyle(state: string): React.CSSProperties {
  switch (state) {
    case 'ready':     return { background: WIN_LIGHT,   color: WIN_BASE };
    case 'connected': return { background: TURN_LIGHT,  color: TURN_BASE };
    default:          return { background: '#e8e4f0',   color: TEXT_MUTED };
  }
}

// team-index (0=COOL / 1=HOT) ごとの配色一式
const TEAM_COLORS = [
  { label: 'COOL', color: COOL_COLOR, dark: COOL_DARK, pale: COOL_PALE },
  { label: 'HOT',  color: HOT_COLOR,  dark: HOT_DARK,  pale: HOT_PALE  },
] as const;

function SetupWaiting({ serverStatus, displayTitle, tournament, groupPhase, currentMap, theme }: {
  serverStatus: ServerStatusPayload | null;
  displayTitle: string;
  /** 大会運営中なら、待機中にトーナメント表 / リーグ表を見せる */
  tournament?: TournamentStatePayload | null;
  /** 予選ありのとき、いま出すもの */
  groupPhase?: QualifyingPhase;
  /** これから戦うマップ。取得前は null */
  currentMap?: InlineMapData | null;
  theme: string;
}) {
  const clients      = serverStatus?.clients;
  const doubleMode   = serverStatus?.doubleMode ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;
  const roundResults = serverStatus?.roundResults ?? [];

  // 2ゲーム制の第1ゲームと第2ゲームの間 (プログラム再接続待ち)。この間 snapshot は破棄されるが
  // roundResults は ServerStatusPayload に残るので、ここから第1ゲームの結果を再構成できる。
  const intermission = doubleMode && roundResults.length === 1 ? roundResults[0] : null;

  // カードの左右は MainWindow と同じく idxForSide で決める。そうしないと swapSlotConfigs 後の
  // 待機画面だけプログラムの左右が入れ替わって見え、第2ゲームが始まるとまた元に戻ってしまう。
  // 第1ゲーム前 (currentRound=0) は恒等写像なので、従来どおり COOL が左・HOT が右になる。
  const leftIdx  = idxForSide(0, currentRound);
  const rightIdx = idxForSide(1, currentRound);

  // 第2ゲームは先攻・後攻が入れ替わるぶん盤面も180°反転する (MainWindow と同じ条件)。
  // 待機中のプレビューも反転させておかないと、開始した瞬間に向きが変わって見える。
  const flip = doubleMode && currentRound === 1;

  const upcoming = tournament?.matches.find(m => m.id === tournament.armedMatchId) ?? null;
  const nameOfParticipant = (id: string | null) =>
    tournament?.participants.find(p => p.id === id)?.name ?? '—';

  // 対戦カードの並びと勝ち上がり表は、画面の残りを分け合って**どちらも**空きいっぱいに拡大する。
  // 片方を自然な大きさのまま置くと、第1ゲームの結果が出ている間だけ勝ち上がり表が潰れてしまう。
  const meeting = (
    <div style={sw.meeting}>
      {/* 第1ゲームの結果 (2ゲーム制のインターミッション中のみ) */}
      {intermission && (
        <div style={sw.recap}>
          <div style={sw.recapTitle}>第1ゲームの結果</div>
          <div style={sw.recapRow}>
            <span style={sw.recapName}>{intermission.playerNames[idxForSide(0, intermission.round)]}</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 0)}</span>
            <span style={sw.recapDash}>—</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 1)}</span>
            <span style={sw.recapName}>{intermission.playerNames[idxForSide(1, intermission.round)]}</span>
          </div>
        </div>
      )}

      {/* COOL / マップ / HOT (セットアップ画面と同じ骨格) */}
      <div style={sw.teams}>
        {clients && (
          <TeamCard idx={leftIdx} name={clients[leftIdx].name || '---'} state={clients[leftIdx].state} />
        )}
        {currentMap
          ? <MapPreview
              map={currentMap} theme={theme} flip={flip}
              label={serverStatus ? sourceLabel(serverStatus.mapSource) : ''}
            />
          : <div style={sw.vs}>VS</div>}
        {clients && (
          <TeamCard idx={rightIdx} name={clients[rightIdx].name || '---'} state={clients[rightIdx].state} />
        )}
      </div>

      {/* {upcoming && (
        <div style={sw.upcoming}>
          <span style={sw.upcomingTag}>対戦試合</span>
          <span style={sw.upcomingLabel}>{upcoming.label}</span>
          <span style={sw.upcomingNames}>
            {nameOfParticipant(upcoming.resolvedA)} vs {nameOfParticipant(upcoming.resolvedB)}
          </span>
        </div>
      )} */}
    </div>
  );

  return (
    <div style={sw.root}>
      {/* タイトル */}
      <div style={sw.titleWrap}>
        <div style={sw.title}>{displayTitle}</div>
        <div style={sw.sub}>
          {doubleMode ? `第${currentRound + 1}ゲーム — ` : ''}対戦開始をお待ちください
        </div>
      </div>

      <FitArea maxScale={1.4} style={tournament ? sw.meetingArea : sw.meetingAreaAlone}>
        {meeting}
      </FitArea>

      {/* 大会運営中は勝ち上がりを観客に見せる (待機中の間だけ) */}
      {tournament && (
        <div style={sw.bracket}>
          {hasQualifying(tournament.stage.format) ? (
            <QualifyingView state={tournament} phase={groupPhase} />
          ) : tournament.stage.format === 'league' ? (
            <LeagueTable
              matches={tournament.matches}
              participants={tournament.participants}
              standings={tournament.standings ?? []}
              upcomingMatchId={tournament.armedMatchId}
              fit
            />
          ) : (
            <BracketView
              matches={tournament.matches}
              participants={tournament.participants}
              upcomingId={tournament.armedMatchId}
              fit
            />
          )}
        </div>
      )}
    </div>
  );
}

/** これから戦うマップ。第2ゲーム前は対戦画面と同じ向き (反転) で見せる */
function MapPreview({ map, theme, flip, label }: {
  map: InlineMapData; theme: string; flip: boolean; label: string;
}) {
  const tex = useTextures(theme);
  // 15×17 のマップでプレイヤーカードと釣り合う大きさ
  const cellSize = Math.max(4, Math.min(12, Math.floor(200 / Math.max(map.size.x, map.size.y))));
  const itemCount = map.field.flat().filter(c => c === MapObject.ITEM).length;
  return (
    <div style={mp.card}>
      <div style={mp.name}>{label}</div>
      <MapThumbnail
        field={map.field as MapObject[][]}
        size={map.size}
        teamFirstPoint={map.teamFirstPoint}
        textures={tex}
        cellSize={cellSize}
        flip={flip}
      />
      <div style={mp.meta}>ターン {map.turn} ・ アイテム {itemCount}</div>
      {flip && <div style={mp.flip}>盤面反転</div>}
    </div>
  );
}

function TeamCard({ idx, name, state }: { idx: 0 | 1; name: string; state: string }) {
  const { label, color, dark, pale } = TEAM_COLORS[idx];
  const badge = stateBadgeStyle(state);
  return (
    <div style={{ ...tc.card, background: pale }}>
      <div style={{ ...tc.header, background: `linear-gradient(135deg, ${color}, ${dark})` }}>
        {label}
      </div>
      <div style={{ ...tc.name, color: dark }}>{name}</div>
      <div style={{ ...tc.badge, ...badge }}>{STATE_LABEL[state] ?? state}</div>
    </div>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const splash: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16,
  },
  title: { fontSize: 32, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_MUTED },
};

const sw: Record<string, React.CSSProperties> = {
  root: {
    // 画面から出さない縦フレックス。中の2つの領域が、割り当てられた高さに合わせて自分で拡大・縮小する
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16, padding: '20px 16px',
    boxSizing: 'border-box', overflow: 'hidden',
  },
  // 対戦カード + マップ。大会運営中は画面を勝ち上がり表と分け合う
  meeting: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
  },
  meetingArea:      { flex: '0 0 45%' },
  meetingAreaAlone: { flex: 1 },
  // 待機中に見せる勝ち上がり表。残りの高さを渡し、その中で図を最大化させる
  bracket: {
    flex: 1, minHeight: 0, width: '100%',
  },
  titleWrap: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 },
  title: { fontSize: 38, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:   { fontSize: 16, color: TEXT_SECONDARY },
  teams: { display: 'flex', alignItems: 'center', gap: 32, flexShrink: 0 },
  vs: {
    fontSize: 28, fontWeight: 800, color: TEXT_MUTED,
    fontFamily: FONT_NUM, letterSpacing: '0.1em',
  },

  // 「この試合を準備」で確定した、これから行う試合
  upcoming: {
    display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
    background: GOLD_LIGHT, border: `2px solid ${GOLD_BASE}`,
    borderRadius: 99, padding: '8px 22px',
  },
  upcomingTag: {
    fontSize: 12, fontWeight: 800, letterSpacing: '0.1em',
    color: '#fff', background: GOLD_BASE, borderRadius: 99, padding: '3px 12px',
  },
  upcomingLabel: { fontSize: 14, color: TEXT_SECONDARY },
  upcomingNames: { fontSize: 22, fontWeight: 800, color: TEXT_PRIMARY },

  // 第1ゲームの結果 (2ゲーム制のインターミッション)。左右の並びは下のプレイヤーカードと揃える
  recap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    padding: '18px 32px',
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
  recapTitle: {
    fontSize: 13, fontWeight: 700, color: WIN_BASE, letterSpacing: '0.1em',
  },
  recapRow:   { display: 'flex', alignItems: 'baseline', gap: 16 },
  recapName:  { fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, minWidth: 120, textAlign: 'center' },
  recapScore: { fontSize: 34, fontWeight: 800, color: TEXT_PRIMARY, fontFamily: FONT_NUM },
  recapDash:  { fontSize: 22, color: TEXT_MUTED },
  recapNote:  { fontSize: 13, color: TEXT_SECONDARY },
};

// これから戦うマップ (待機画面の中央)
const mp: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '14px 18px', background: BG_CARD,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
  head: { fontSize: 11, color: TEXT_MUTED, letterSpacing: '0.1em', alignSelf: 'flex-start' },
  name: {
    fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY,
    maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 11, color: TEXT_SECONDARY, fontFamily: FONT_NUM },
  flip: {
    fontSize: 11, fontWeight: 700, color: TURN_BASE, background: TURN_LIGHT,
    borderRadius: 99, padding: '3px 10px',
  },
};

const tc: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    padding: '0 0 20px',
    borderRadius: RADIUS_MD, overflow: 'hidden',
    boxShadow: SHADOW_MD, minWidth: 220,
  },
  header: {
    width: '100%', textAlign: 'center',
    color: '#fff', fontWeight: 800, fontSize: 20,
    padding: '14px 0', letterSpacing: '0.1em',
    marginBottom: 4,
  },
  name:  {
    fontSize: 22, fontWeight: 800,
    minHeight: 32, letterSpacing: '0.02em',
  },
  badge: {
    fontWeight: 700, fontSize: 12,
    padding: '5px 18px', borderRadius: 99, letterSpacing: '0.06em',
  },
};
