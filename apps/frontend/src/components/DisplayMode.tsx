import { useMemo, useRef } from 'react';
import type {
  DisplayPrefs, InlineMapData, ServerPhase, ServerStatusPayload, TournamentStatePayload,
} from '@u15/ws-types';
import { DEFAULT_DISPLAY_PREFS, hasQualifying, idxForSide, MapObject, roundPointsFor, SCENE_FADE_MS } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useMuteOverride } from '../hooks/useMuteOverride';
import { useGamePhaseSound } from '../hooks/useGamePhaseSound';
import { useStartCountdown } from '../hooks/useStartCountdown';
import { useBgm } from '../hooks/useBgm';
import { useSceneTransition } from '../hooks/useSceneTransition';
import { useCurrentMap } from '../hooks/useCurrentMap';
import { useTextures } from '../hooks/useTextures';
import { MainWindow } from './MainWindow';
import { FitArea } from './FitArea';
import { MapThumbnail } from './MapThumbnail';
import { sourceLabel } from './MapSourceSection';
import { BracketView } from './tournament/board/BracketView';
import { QualifyingView, displayQualifyingPhase } from './tournament/board/QualifyingView';
import type { QualifyingPhase } from './tournament/board/QualifyingView';
import { LeagueTable } from './tournament/board/LeagueTable';
import { TournamentFinale } from './tournament/board/TournamentFinale';
import { TournamentStandby } from './tournament/board/TournamentStandby';
import { armedMatchNames, isTournamentComplete } from '../lib/tournamentResult';
import {
  BG_ROOT, BG_CARD,
  TURN_BASE, TURN_LIGHT,
  WIN_BASE, WIN_LIGHT,
  GOLD_BASE, GOLD_LIGHT,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD, SHADOW_SM,
  RADIUS_MD,
  FONT_UI, FONT_NUM,
  TEAM_PALETTE, teamGradient,
} from '../ui';

// ── 観客に出している画面 ──────────────────────────────────────────────────────
//
// 対戦中 (playing) はどの場合も盤面が主役。それ以外は大会運営中かどうかと
// armedMatchId が分かれ目になる:
//
//   armed 無し … 運営を始めた直後 / 試合を確定した直後 → 表だけを大きく見せる
//   armed 有り … 「この試合を準備」以降 → 準備画面、対戦が終われば結果画面
//
// 確定しても phase は 'finished' のまま (バックエンドはルームに触れない) なので、
// armedMatchId を見ないと結果画面から抜けられない。最後の試合には次の arm も無い。
//
// 予選ありの大会では「予選表 / 決勝表 のどちらを出すか」を運営パネルが決める
// (運営席の表示とは連動しない)。全工程が終わったうえで決勝側を見ていれば表彰画面。

type DisplayScene = 'award' | 'standby' | 'waiting' | 'playing' | 'result';

function displayScene(
  phase:      ServerPhase,
  tournament: TournamentStatePayload | null | undefined,
  groupPhase: QualifyingPhase,
): DisplayScene {
  if (tournament && phase !== 'playing') {
    if (groupPhase === 'bracket' && isTournamentComplete(tournament)) return 'award';
    if (!tournament.armedMatchId)                                     return 'standby';
  }
  if (phase === 'playing')  return 'playing';
  if (phase === 'finished') return 'result';
  return 'waiting';
}

// 場面ごとに鳴らす BGM。決着後 (result) を接続待ちと分けているのは、決着した盤面を
// 見せる時間と、次のプログラムを待つ時間とで会場の空気が違うため。
// 大会の待機表 (standby) は接続待ちと同じ曲でよい — どちらも次の対戦を待つ場面。
// playing だけは currentRound (2ゲーム制の1ゲーム目/2ゲーム目) も見て選ぶ
const BGM_OF_SCENE: Record<DisplayScene, (p: DisplayPrefs, round: 0 | 1) => string> = {
  award:   p => p.bgmTrackAward,
  standby: p => p.bgmTrackWait,
  waiting: p => p.bgmTrackWait,
  playing: (p, round) => round === 1 ? p.bgmTrack1 : p.bgmTrack0,
  result:  p => p.bgmTrackResult,
};

// 画面の暗転はこの単位で判定する。playing と result は同じ MainWindow をそのまま出し続ける
// (盤面の上に結果を重ねるだけ) ので、両者の間に切り替えは無く暗転もしない。
type VisualGroup = 'award' | 'standby' | 'waiting' | 'match';

function visualGroupOf(scene: DisplayScene): VisualGroup {
  return scene === 'playing' || scene === 'result' ? 'match' : scene;
}

export function DisplayMode({ wsUrl, roomId, httpBase }: { wsUrl: string; roomId: string; httpBase: string }) {
  const state   = useGameState(wsUrl, roomId);
  const { serverStatus, snapshot, turnInfo, gameEnd, isConnected, tournamentState } = state;
  const prefs = serverStatus?.displayPrefs ?? DEFAULT_DISPLAY_PREFS;

  // 表示・BGM 選曲・タイトル等はコントロールパネルが決めて全観戦画面に配信する値をそのまま使う。
  // SE/BGM のミュートだけは、ブラウザで観戦している端末ごとに上書きできる (自分の音量として)。
  // 会場の Electron 表示ウィンドウ (プロジェクタ等) には上書き UI を出さない
  const isBrowserSpectator = !window.electronAPI;
  const { override: muteOverride, setOverride: setMuteOverride } = useMuteOverride();
  const effectiveMuted    = isBrowserSpectator && muteOverride !== null ? muteOverride : prefs.muted;
  const effectiveBgmMuted = isBrowserSpectator && muteOverride !== null ? muteOverride : prefs.bgmMuted;

  const phase = serverStatus?.phase ?? 'setup';
  // 大会中でなければ結果は使われない
  const groupView = displayQualifyingPhase(tournamentState);

  // いま観客に出すべき画面。BGM の曲選び (BGM_OF_SCENE) と awarding 判定は、鳴らす音を
  // 即座に切り替えるためこの値をそのまま見る。描画だけは下の displayedGroup (暗転を挟んで
  // 遅れて切り替わる方) を見る — 条件を増やすと画面と音の食い違いが起きるので、
  // 「画面用に何を出すか」と「音用に何を鳴らすか」は常にこの scene 一つから決める
  const scene = displayScene(phase, tournamentState, groupView.phase);

  // 画面の切り替え自体は即座にせず、BGM のクロスフェードと同じ長さの暗転を挟む
  // (useSceneTransition のコメント参照)。以下の出し分けは displayedGroup だけを見る
  const currentGroup = visualGroupOf(scene);
  const { displayed: displayedGroup, curtain } = useSceneTransition(currentGroup);

  // 試合結果を確定した瞬間、tournamentState は (armedMatchId=null, 該当試合 status='done') に
  // 即座に更新される。この変化そのものは正しいが、暗転が閉じ切って画面を隠す前に
  // MainWindow が再描画されると、大会登録名からプログラム自己申告名への切り替わりが
  // 暗転前に一瞬見えてしまう。displayedGroup がまだ切り替わっていない (= 暗転が閉じて
  // いない) 間は、MainWindow に渡す tournamentState を直前の値のまま凍結する
  const tournamentForMatchRef = useRef(tournamentState);
  if (currentGroup === displayedGroup) {
    tournamentForMatchRef.current = tournamentState;
  }

  // 対戦画面がマウントされた瞬間 (暗転が閉じきった瞬間) から開始カウントダウンを進める。
  // ServerManager の startDelayMs 側に暗転ぶん (SCENE_FADE_MS) の余裕を足してあるので、
  // 最初の目盛り (1秒後) が来るより前に明転が終わり、観客には常に "3" から見える
  const countdown = useStartCountdown(displayedGroup === 'match', turnInfo);

  useGamePhaseSound({
    httpBase, snapshot, serverStatus, gameEnd, turnInfo, countdown,
    awarding: scene === 'award',
    muted: effectiveMuted, enabled: true,
  });
  // 対戦中の BGM は開始カウントダウンが終わってから鳴らす (カウント中は無音)。
  // 合図に turnInfo を使うのは、phase が playing になった時点ではまだカウント中で、
  // かつ **カウントの残り秒は effect で入るため最初の描画では null** になるから。
  // 残り秒で判定すると、その1描画のあいだだけ曲が鳴り出してしまう。
  const holdingBgm = scene === 'playing' && !turnInfo;
  useBgm(
    httpBase,
    holdingBgm ? 'none' : BGM_OF_SCENE[scene](prefs, serverStatus?.currentRound ?? 0),
    effectiveBgmMuted, true,
  );
  // 待機中にこれから戦うマップを見せる (対戦中は盤面そのものが出るので使わない)
  const { currentMap } = useCurrentMap(httpBase, roomId, isConnected, serverStatus);

  if (!isConnected) {
    return (
      <div style={splash.root}>
        <div style={splash.title}>{prefs.displayTitle}</div>
        <div style={splash.sub}>バックエンドに接続中...</div>
        {isBrowserSpectator && (
          <MuteToggle muted={effectiveMuted} onToggle={() => setMuteOverride(!effectiveMuted)} />
        )}
      </div>
    );
  }

  let content: React.ReactNode;
  if (displayedGroup === 'award' && tournamentState) {
    content = <TournamentFinale state={tournamentState} displayTitle={prefs.displayTitle} />;
  } else if (displayedGroup === 'standby' && tournamentState) {
    content = (
      <TournamentStandby
        state={tournamentState}
        displayTitle={prefs.displayTitle}
        groupPhase={groupView.phase}
        holdingGroupResult={groupView.holdingResult}
      />
    );
  } else if (displayedGroup === 'waiting') {
    content = (
      <SetupWaiting
        serverStatus={serverStatus}
        displayTitle={prefs.displayTitle}
        tournament={tournamentState}
        groupPhase={groupView.phase}
        currentMap={currentMap}
        theme={prefs.theme}
      />
    );
  } else {
    content = (
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
          tournament={tournamentForMatchRef.current}
        />
      </div>
    );
  }

  return (
    <>
      {content}
      <div style={{ ...curtainStyle, opacity: curtain }} />
      {/* 対戦中 (match) は盤面上部のプレイヤー名表示と重なるので出さない */}
      {isBrowserSpectator && displayedGroup !== 'match' && (
        <MuteToggle muted={effectiveMuted} onToggle={() => setMuteOverride(!effectiveMuted)} />
      )}
    </>
  );
}

/**
 * ブラウザ観戦者だけに出す、自分の端末用のミュート切り替え。会場の Electron 表示ウィンドウ
 * (プロジェクタ等、観客の目に触れる画面) には出さない — DisplayMode 側で isBrowserSpectator を見て出し分ける
 */
function MuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={muteToggleStyle}>
      {muted ? 'ミュート解除' : 'ミュート'}
    </button>
  );
}

const muteToggleStyle: React.CSSProperties = {
  position: 'fixed', top: 12, right: 12, zIndex: 10000,
  padding: '6px 12px', borderRadius: 999, border: 'none',
  background: 'rgba(0, 0, 0, 0.55)', color: '#fff',
  fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
  cursor: 'pointer',
};

// 場面切り替えの暗転。displayedGroup が裏で入れ替わる間、画面全体を黒で覆う
const curtainStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#000',
  transition: `opacity ${SCENE_FADE_MS}ms ease`,
  pointerEvents: 'none', zIndex: 9999,
};

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

  // 大会運営中は TCP 自己申告名でなく大会登録名を優先する (MainWindow と同じ規則)。
  // これから待つゲーム (currentRound) と、リキャップが指す第1ゲーム (常に round 0) とで
  // COOL/HOT の中身が違う (swapSlotConfigs) ため、round ごとに引き直す
  const tournamentNames = useMemo(
    () => armedMatchNames(tournament, currentRound),
    [tournament, currentRound],
  );
  const recapRound = intermission?.round ?? 0;
  const recapNames = useMemo(
    () => intermission ? armedMatchNames(tournament, recapRound) : null,
    [tournament, intermission, recapRound],
  );
  const recapDisplayNames = intermission ? (recapNames ?? intermission.playerNames) : null;

  // カードの左右は MainWindow と同じく idxForSide で決める。そうしないと swapSlotConfigs 後の
  // 待機画面だけプログラムの左右が入れ替わって見え、第2ゲームが始まるとまた元に戻ってしまう。
  // 第1ゲーム前 (currentRound=0) は恒等写像なので COOL が左・HOT が右になる。
  const leftIdx  = idxForSide(0, currentRound);
  const rightIdx = idxForSide(1, currentRound);

  // 第2ゲームは先攻・後攻が入れ替わるぶん盤面も180°反転する (MainWindow と同じ条件)。
  // 待機中のプレビューも反転させておかないと、開始した瞬間に向きが変わって見える。
  const flip = doubleMode && currentRound === 1;

  // 対戦カードの並びと勝ち上がり表は、画面の残りを分け合って**どちらも**空きいっぱいに拡大する。
  // 片方を自然な大きさのまま置くと、第1ゲームの結果が出ている間だけ勝ち上がり表が潰れてしまう。
  const meeting = (
    <div style={sw.meeting}>
      {/* 第1ゲームの結果 (2ゲーム制のインターミッション中のみ) */}
      {intermission && (
        <div style={sw.recap}>
          <div style={sw.recapTitle}>第1ゲームの結果</div>
          <div style={sw.recapRow}>
            <span style={sw.recapName}>{recapDisplayNames![idxForSide(0, intermission.round)]}</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 0)}</span>
            <span style={sw.recapDash}>—</span>
            <span style={sw.recapScore}>{roundPointsFor(intermission, 1)}</span>
            <span style={sw.recapName}>{recapDisplayNames![idxForSide(1, intermission.round)]}</span>
          </div>
        </div>
      )}

      {/* COOL / マップ / HOT (セットアップ画面と同じ骨格) */}
      <div style={sw.teams}>
        {clients && (
          <TeamCard
            idx={leftIdx} state={clients[leftIdx].state}
            name={tournamentNames?.[leftIdx] ?? (clients[leftIdx].name || '---')}
          />
        )}
        {currentMap
          ? <MapPreview
              map={currentMap} theme={theme} flip={flip}
              label={serverStatus ? sourceLabel(serverStatus.mapSource) : ''}
            />
          : <div style={sw.vs}>VS</div>}
        {clients && (
          <TeamCard
            idx={rightIdx} state={clients[rightIdx].state}
            name={tournamentNames?.[rightIdx] ?? (clients[rightIdx].name || '---')}
          />
        )}
      </div>
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
  const { label, color, dark, pale } = TEAM_PALETTE[idx];
  const badge = stateBadgeStyle(state);
  return (
    <div style={{ ...tc.card, background: pale }}>
      <div style={{ ...tc.header, background: teamGradient(color, dark) }}>
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
  // 左右で幅を揃えて初めて中央の score/dash が動かない。狭すぎると読めないので
  // 160px 確保しつつ、それでも収まらない名前は省略せず折り返す (文字が切り捨てられないように)
  recapName:  {
    fontSize: 18, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center',
    width: 160, flexShrink: 0, lineHeight: 1.25, wordBreak: 'break-word',
  },
  recapScore: { fontSize: 34, fontWeight: 800, color: TEXT_PRIMARY, fontFamily: FONT_NUM },
  recapDash:  { fontSize: 22, color: TEXT_MUTED },
};

// これから戦うマップ (待機画面の中央)
const mp: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '14px 18px', background: BG_CARD,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
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
  // 左右で幅を揃えないと、名前の長さでカードの幅が変わって中央のマップがズレる
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    padding: '0 0 20px',
    borderRadius: RADIUS_MD, overflow: 'hidden',
    boxShadow: SHADOW_MD, width: 220, flexShrink: 0,
  },
  header: {
    width: '100%', textAlign: 'center',
    color: '#fff', fontWeight: 800, fontSize: 20,
    padding: '14px 0', letterSpacing: '0.1em',
    marginBottom: 4,
  },
  name:  {
    width: '100%', boxSizing: 'border-box', padding: '0 12px',
    fontSize: 22, fontWeight: 800, textAlign: 'center',
    minHeight: 32, letterSpacing: '0.02em', wordBreak: 'break-word',
  },
  badge: {
    fontWeight: 700, fontSize: 12,
    padding: '5px 18px', borderRadius: 99, letterSpacing: '0.06em',
  },
};
