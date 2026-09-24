import { useMemo } from 'react';
import type {
  AnnouncementState, DisplayPrefs, InlineMapData, RoundResult, ServerPhase, ServerStatusPayload,
  SoloScoringMode, TournamentStatePayload,
} from '@u15/ws-types';
import {
  DEFAULT_DISPLAY_PREFS, hasQualifying, idxForSide, NO_ANNOUNCEMENT, roundWonBy, SCENE_FADE_MS, Winner,
} from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { useMuteOverride } from '../hooks/useMuteOverride';
import { useGamePhaseSound } from '../hooks/useGamePhaseSound';
import { useStartCountdown } from '../hooks/useStartCountdown';
import { useBgm } from '../hooks/useBgm';
import { useSceneTransition } from '../hooks/useSceneTransition';
import { useFrozenTournamentState } from '../hooks/useFrozenTournamentState';
import { useCurrentMap } from '../hooks/useCurrentMap';
import { useMapCatalogPreview } from '../hooks/useMapCatalogPreview';
import { MainWindow } from './MainWindow';
import { MultiLaneDisplay } from './MultiLaneDisplay';
import { FitArea } from './FitArea';
import { MapPreview } from './MapPreview';
import { AnnouncementScreen } from './AnnouncementScreen';
import { BracketView } from './tournament/board/BracketView';
import { QualifyingView, displayQualifyingPhase } from './tournament/board/QualifyingView';
import type { QualifyingPhase } from './tournament/board/QualifyingView';
import { LeagueTable } from './tournament/board/LeagueTable';
import { TournamentFinale } from './tournament/board/TournamentFinale';
import { TournamentStandby } from './tournament/board/TournamentStandby';
import { armedMatchNames, isTournamentComplete } from '../lib/tournamentResult';
import { roundDisplayScore, scoringContextOf, type ScoringContext } from '../lib/koryuDisplay';
import {
  BG_ROOT, BG_CARD,
  TURN_BASE, TURN_LIGHT, TURN_PALE,
  WIN_BASE, WIN_LIGHT, WIN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_MD, SHADOW_SM,
  RADIUS_MD, RADIUS_LG,
  FONT_UI, FONT_NUM,
  TEAM_PALETTE, teamGradient, Splash, winLoseTextStyle,
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

type DisplayScene =
  'award' | 'standby' | 'waiting' | 'playing' | 'result' | 'preview' | 'announce' | 'lanes';

/** 並列実行中か (レーンが2本以上あり、どれかが対戦を抱えている) */
function isRunningParallel(t: TournamentStatePayload | null | undefined): boolean {
  return !!t && t.lanes.length > 1 && t.lanes.some(l => l.armedMatchId !== null);
}

function displayScene(
  phase:         ServerPhase,
  tournament:    TournamentStatePayload | null | undefined,
  groupPhase:    QualifyingPhase,
  previewMapId:  string | null,
  announcement:  AnnouncementState,
): DisplayScene {
  // **並列実行中は分割画面がすべてに優先する。**
  //
  // このとき主レーンの phase / armedMatchId だけを見ても正しい場面にならない —
  // 主レーンが空いていて副レーンだけが戦っている、という状態が普通に起きるため。
  // 空き時間の割り込み (アナウンス・マッププレビュー) も、全レーンが空くまで出さない
  // (どこかで対戦が走っている間に観戦画面を差し替えると、その対戦が見えなくなる)
  if (isRunningParallel(tournament)) return 'lanes';

  const base = baseDisplayScene(phase, tournament, groupPhase);
  // 運営が出している割り込み (アナウンス / 手動マッププレビュー) は、対戦の空き時間
  // (waiting/standby) だけを置き換える。対戦中・結果表示・表彰中は割り込まない
  if (base !== 'waiting' && base !== 'standby') return base;
  // アナウンスのほうが強い。休憩の案内を出したいのに、消し忘れたプレビューが
  // 残っているせいで出ない、という取りこぼしを作らない。
  // 文面が空なら出さない (真っ白な画面になる)
  if (announcement.visible && (announcement.title !== '' || announcement.body !== '')) {
    return 'announce';
  }
  if (previewMapId) return 'preview';
  return base;
}

export function baseDisplayScene(
  phase:      ServerPhase,
  tournament: TournamentStatePayload | null | undefined,
  groupPhase: QualifyingPhase,
): Exclude<DisplayScene, 'preview'> {
  // 両ゲーム終了・確定待ち (awaiting_confirm) の間も armedMatchId は残ったままだが、
  // トーナメント表 (standby) へは進めない。運営が「この結果で確定」を押す前の状態を
  // 観客に見せると、運営が裁定で結果を変える可能性のある間に確定済みのような表示を
  // 出すことになる。確定を押すまでは盤面の結果画面 (result) を見せ続け、
  // armedMatchId が外れた瞬間 (= 確定した瞬間) にだけトーナメント表へ切り替える。
  //
  // ただし同点は確定できない (再試合か審判裁定が要る) ので、armedMatchId は
  // すぐには外れない。運営が「この結果で確定」で同点を認めた (tieAcknowledged) 時点で、
  // このあと再試合/裁定のどちらを選ぶかを待つ間も、トーナメント表 (スコアと「引き分け」)
  // へ進めてよい — 盤面に留め置く理由はもう無い
  if (tournament && phase !== 'playing') {
    if (groupPhase === 'bracket' && isTournamentComplete(tournament)) return 'award';
    if (!tournament.armedMatchId)                                     return 'standby';
    const armed = tournament.matches.find(m => m.id === tournament.armedMatchId);
    if (armed?.status === 'awaiting_confirm' && armed.tieAcknowledged) return 'standby';
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
  preview: p => p.bgmTrackWait,
  // 運営アナウンス中も「次の対戦を待つ場面」なので待機中と同じ曲
  announce: p => p.bgmTrackWait,
  // 並列実行中は対戦曲。レーンごとに第1/第2ゲームがばらけるので、常に第1ゲームの曲にする
  lanes:   p => p.bgmTrack0,
};

// 画面の暗転はこの単位で判定する。playing と result は同じ MainWindow をそのまま出し続ける
// (盤面の上に結果を重ねるだけ) ので、両者の間に切り替えは無く暗転もしない。
type VisualGroup =
  'award' | 'standby' | 'waiting' | 'match' | 'preview' | 'announce' | 'lanes';

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

  // 運営がマップ管理画面から手動プレビューを出しているか (ServerManager 側で対戦開始時に
  // 自動で null に戻る、永続化しない一時状態)
  const previewMapId = serverStatus?.previewMapId ?? null;

  // 運営が観戦画面へ出している休憩・再開時刻などの案内 (文面は残したまま出し入れできる)
  const announcement = serverStatus?.announcement ?? NO_ANNOUNCEMENT;

  // いま観客に出すべき画面。BGM の曲選び (BGM_OF_SCENE) と awarding 判定は、鳴らす音を
  // 即座に切り替えるためこの値をそのまま見る。描画だけは下の displayedGroup (暗転を挟んで
  // 遅れて切り替わる方) を見る — 条件を増やすと画面と音の食い違いが起きるので、
  // 「画面用に何を出すか」と「音用に何を鳴らすか」は常にこの scene 一つから決める
  const scene = displayScene(phase, tournamentState, groupView.phase, previewMapId, announcement);

  // 画面の切り替え自体は即座にせず、BGM のクロスフェードと同じ長さの暗転を挟む
  // (useSceneTransition のコメント参照)。以下の出し分けは displayedGroup だけを見る
  const currentGroup = visualGroupOf(scene);
  const { displayed: displayedGroup, curtain } = useSceneTransition(currentGroup);

  // 試合結果を確定した瞬間、tournamentState は (armedMatchId=null, 該当試合 status='done') に
  // 即座に更新される。この変化そのものは正しいが、暗転が閉じ切って画面を隠す前に
  // MainWindow が再描画されると、大会登録名からプログラム自己申告名への切り替わりや、
  // BOT予選の合計得点が決勝の獲得アイテム数表示に戻る切り替わりが暗転前に一瞬見えてしまう。
  // displayedGroup がまだ切り替わっていない (= 暗転が閉じていない) 間は、MainWindow に渡す
  // tournamentState (と、それに依存する得点表示の文脈) を直前の値のまま凍結する
  const tournamentForMatch = useFrozenTournamentState(tournamentState, currentGroup === displayedGroup);
  const scoring = useMemo(
    () => scoringContextOf(tournamentForMatch, prefs.scoreDisplayMode),
    [tournamentForMatch, prefs.scoreDisplayMode],
  );

  // 対戦画面がマウントされた瞬間 (暗転が閉じきった瞬間) から開始カウントダウンを進める。
  // ServerManager の startDelayMs 側に暗転ぶん (SCENE_FADE_MS) の余裕を足してあるので、
  // 最初の目盛り (1秒後) が来るより前に明転が終わり、観客には常に "3" から見える
  const countdown = useStartCountdown(displayedGroup === 'match', turnInfo);

  // 並列実行中は SE を鳴らさない。N面ぶんの決着音・ターン音が重なると何も聞き取れず、
  // どれか1面だけ鳴らしても他の面と食い違って見える。音は BGM 1本に絞る
  useGamePhaseSound({
    httpBase, snapshot, serverStatus, gameEnd, turnInfo, countdown,
    awarding: scene === 'award',
    muted: effectiveMuted, enabled: scene !== 'lanes',
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
  // 手動プレビュー中のマップ本体 (ライブラリの1件、room には触れない)
  const manualPreview = useMapCatalogPreview(httpBase, previewMapId);

  if (!isConnected) {
    return (
      <Splash title={prefs.displayTitle} sub="バックエンドに接続中...">
        {isBrowserSpectator && (
          <MuteToggle muted={effectiveMuted} onToggle={() => setMuteOverride(!effectiveMuted)} />
        )}
      </Splash>
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
  } else if (displayedGroup === 'lanes' && tournamentState) {
    content = (
      <MultiLaneDisplay wsUrl={wsUrl} lanes={tournamentState.lanes} prefs={prefs} />
    );
  } else if (displayedGroup === 'announce') {
    content = <AnnouncementScreen announcement={announcement} displayTitle={prefs.displayTitle} />;
  } else if (displayedGroup === 'preview') {
    content = manualPreview ? (
      <div style={sw.previewRoot}>
        <FitArea maxScale={3}>
          <MapPreview map={manualPreview.data} theme={prefs.theme} flip={false} label={manualPreview.displayName} />
        </FitArea>
      </div>
    ) : null;
  } else if (displayedGroup === 'waiting') {
    content = (
      <SetupWaiting
        serverStatus={serverStatus}
        displayTitle={prefs.displayTitle}
        tournament={tournamentState}
        groupPhase={groupView.phase}
        currentMap={currentMap}
        theme={prefs.theme}
        soloScoringMode={prefs.scoreDisplayMode}
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
          scoring={scoring}
          tournament={tournamentForMatch}
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


/** 第1ゲームのリキャップに出す得点の文字列。舞鶴大会は pt 表示、交流大会は素の数値 */
function recapScore(rr: RoundResult, side: 0 | 1, ctx: ScoringContext): string {
  const value = roundDisplayScore(rr, side, ctx);
  return ctx.ruleSet === 'koryu' ? `${value}` : `${value}pt`;
}

export function SetupWaiting({
  serverStatus, displayTitle, tournament, groupPhase, currentMap, theme, soloScoringMode,
}: {
  serverStatus: ServerStatusPayload | null;
  displayTitle: string;
  /** 大会運営中なら、待機中にトーナメント表 / リーグ表を見せる */
  tournament?: TournamentStatePayload | null;
  /** 予選ありのとき、いま出すもの */
  groupPhase?: QualifyingPhase;
  /** これから戦うマップ。取得前は null */
  currentMap?: InlineMapData | null;
  theme: string;
  /** 大会に紐付かないとき (tournament が null) に使う得点表示モード */
  soloScoringMode: SoloScoringMode;
}) {
  const clients      = serverStatus?.clients;
  const doubleMode   = serverStatus?.doubleMode ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;
  const roundResults = serverStatus?.roundResults ?? [];
  const scoring      = scoringContextOf(tournament, soloScoringMode);

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

  // 第1ゲームの勝者 (引き分けなら null)。点数の並びだけでは見比べないと勝敗が分からないので、
  // 勝った側を色で浮かせ、負けた側を沈める (winLoseTextStyle)
  const gameWinnerSide: 0 | 1 | null = intermission && intermission.winner !== Winner.DRAW
    ? (roundWonBy(intermission, 0) ? 0 : 1)
    : null;

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
  //
  // リキャップ (終わったゲーム) と対戦カード (これから始まるゲーム) は文で説明せず、
  // 大小・色の沈み/浮き・枠の有無で読み分けさせる。リキャップは「済んだ記録」なので
  // 小さく沈んだ色調の付箋のように、対戦カードは「これからの主役」なので一段大きく
  // 金枠 (= このアプリ全体で「次に行う」を表す色) で囲む
  const teamsRow = (
    <div style={sw.teams}>
      {clients && (
        <TeamCard
          idx={leftIdx} state={clients[leftIdx].state}
          name={tournamentNames?.[leftIdx] ?? (clients[leftIdx].name || '---')}
          large={!!intermission}
        />
      )}
      {/* マップ名・ターン数/アイテム数・盤面反転バッジは省く (compact) —
          運営はコントロールパネルで同じ情報を確認できるうえ、この画面は縦の余白が
          リキャップと取り合いになる。手動プレビュー (画面いっぱいに使う) では出したままにする */}
      {currentMap
        ? <MapPreview map={currentMap} theme={theme} flip={flip} label="" compact />
        : <div style={{ ...sw.vs, ...(intermission ? sw.vsLg : null) }}>VS</div>}
      {clients && (
        <TeamCard
          idx={rightIdx} state={clients[rightIdx].state}
          name={tournamentNames?.[rightIdx] ?? (clients[rightIdx].name || '---')}
          large={!!intermission}
        />
      )}
    </div>
  );

  const meeting = (
    <div style={{ ...sw.meeting, ...(intermission ? sw.meetingGapWide : null) }}>
      {/* 第1ゲームの結果 (2ゲーム制のインターミッション中のみ)。小さな付箋として上に置く —
          TournamentStandby の「たった今終わった試合」カードとは違い、ここでは主役ではない */}
      {intermission && (
        <div style={sw.recap}>
          <div style={sw.recapHead}>
            <span style={sw.recapTitle}>第1ゲームの結果</span>
            {/* 点数の並びだけでは、観客が2つの数字を見比べないと勝敗が分からない。
                一文で結果を言い切る (引き分けは「勝った」わけではないので地の色のまま) */}
            <span style={{
              ...sw.recapWinner,
              ...(intermission.winner === Winner.DRAW ? sw.recapWinnerDraw : null),
            }}>
              {intermission.winner === Winner.DRAW
                ? '引き分け'
                : `${recapDisplayNames![gameWinnerSide!]} の勝ち`}
            </span>
          </div>
          <div style={sw.recapDivider} />
          <div style={sw.recapRow}>
            <span style={{ ...sw.recapName, ...winLoseTextStyle(gameWinnerSide, 0) }}>
              {recapDisplayNames![idxForSide(0, intermission.round)]}
            </span>
            <span style={{ ...sw.recapScore, ...winLoseTextStyle(gameWinnerSide, 0) }}>
              {recapScore(intermission, 0, scoring)}
            </span>
            <span style={sw.recapDash}>—</span>
            <span style={{ ...sw.recapScore, ...winLoseTextStyle(gameWinnerSide, 1) }}>
              {recapScore(intermission, 1, scoring)}
            </span>
            <span style={{ ...sw.recapName, ...winLoseTextStyle(gameWinnerSide, 1) }}>
              {recapDisplayNames![idxForSide(1, intermission.round)]}
            </span>
          </div>
        </div>
      )}

      {/* これから戦うカード。リキャップと見分けがつくよう、インターミッション中だけ
          金枠のフレームに収めて主役として浮かせる (フレーム無しの通常時と地続きにしない)。
          枠の中にも「第◯ゲーム」を小さく置く — リキャップの見出し (第1ゲームの結果) と
          対になる位置 (マップの真上) に置くことで、対戦カード・マップがどちらのゲームの
          ものかを、文で説明せずカードの構造の対称性だけで読み取れるようにする */}
      {intermission ? (
        <div style={sw.teamsFrame}>
          <div style={sw.teamsFrameLabel}>{`第${currentRound + 1}ゲーム`}</div>
          {teamsRow}
        </div>
      ) : teamsRow}
    </div>
  );

  return (
    <div style={sw.root}>
      {/* タイトル */}
      <div style={sw.titleWrap}>
        <div style={sw.title}>{displayTitle}</div>
        <div style={sw.sub}>
          {/* インターミッション中は「第◯ゲーム」を下の金枠側 (マップの真上) で言うので、
              ここでは重ねて言わない (第1ゲーム開始前など、金枠がまだ無い間だけここで言う) */}
          {doubleMode && !intermission ? `第${currentRound + 1}ゲーム — ` : ''}対戦開始をお待ちください
        </div>
      </div>

      {/* リキャップが出ている間は勝ち上がり表を出さない (下の分岐) ので、その分の高さを
          そのままリキャップ側に渡せる。第1ゲームの結果は観客に見せたい情報の主役で、
          縮んだ勝ち上がり表と場所を取り合わせる理由が無い */}
      <FitArea
        maxScale={1.4}
        style={!tournament || intermission ? sw.meetingAreaAlone : sw.meetingArea}
      >
        {meeting}
      </FitArea>

      {/* 大会運営中は勝ち上がりを観客に見せる (待機中の間だけ)。
          第1ゲームの結果を見せている間は出さない (上の理由) */}
      {tournament && !intermission && (
        <div style={sw.bracket}>
          {hasQualifying(tournament.stage.format) ? (
            <QualifyingView
              state={tournament} phase={groupPhase} bracketView={tournament.bracketView}
              groupView={tournament.groupView}
            />
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
              focusId={tournament.armedMatchId}
              view={tournament.bracketView}
              fit
            />
          )}
        </div>
      )}
    </div>
  );
}

function TeamCard({
  idx, name, state, large = false,
}: { idx: 0 | 1; name: string; state: string; large?: boolean }) {
  const { label, color, dark, pale } = TEAM_PALETTE[idx];
  const badge = stateBadgeStyle(state);
  return (
    <div style={{ ...tc.card, ...(large ? tc.cardLg : null), background: pale }}>
      <div style={{ ...tc.header, ...(large ? tc.headerLg : null), background: teamGradient(color, dark) }}>
        {label}
      </div>
      <div style={{ ...tc.name, ...(large ? tc.nameLg : null), color: dark }}>{name}</div>
      <div style={{ ...tc.badge, ...(large ? tc.badgeLg : null), ...badge }}>{STATE_LABEL[state] ?? state}</div>
    </div>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const sw: Record<string, React.CSSProperties> = {
  root: {
    // 画面から出さない縦フレックス。中の2つの領域が、割り当てられた高さに合わせて自分で拡大・縮小する
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16, padding: '20px 16px',
    boxSizing: 'border-box', overflow: 'hidden',
  },
  // 手動プレビュー中。タイトルやチームカードは出さず、マップだけを画面いっぱいに表示する
  previewRoot: {
    height: '100vh', boxSizing: 'border-box', padding: '20px 16px',
    background: BG_ROOT,
  },
  // 対戦カード + マップ。大会運営中は画面を勝ち上がり表と分け合う
  meeting: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
  },
  // リキャップ (済んだゲーム) と対戦カード (次のゲーム) の間の余白を広く取る。
  // 隙間の大きさそのものを「別の場面」の合図にする — 文で「次は」と言わずに済む
  meetingGapWide: { gap: 40 },
  meetingArea:      { flex: '0 0 45%' },
  // 勝ち上がり表と場所を分け合わない場合 (大会に紐付かない / リキャップ表示中)。
  // 残りの高さを丸ごと渡す
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
  // インターミッション中は下のプレイヤーカードも一段大きくするので、VS も釣り合わせる
  vsLg: { fontSize: 34 },

  // これから戦うカードを収める枠。**インターミッション中だけ**使う。
  //
  // 金 (GOLD_BASE) は「準備完了だが運営の対応待ち」(結果確認・同点裁定) を表す色として
  // このアプリ全体で使っており、ここに使うと観客に「運営の対応待ち」の誤信号になりかねない。
  // カードの中身の COOL/HOT バッジがすでに「準備完了」を緑 (WIN) で示しているので、枠の色は
  // 状態を表す必要が無い。代わりに、この画面の「対戦カード」自体が使う中立の紫
  // (MATCH_STATUS_COLOR の ready = TURN_BASE、「対戦カード決定」= 対戦の準備が整った状態) を
  // 枠にも使い、上の緑カード (済んだ記録) と対になる「もう1枚のカード」として並べる
  teamsFrame: {
    padding: '24px 32px', borderRadius: RADIUS_LG,
    border: `2px solid ${TURN_LIGHT}`, background: TURN_PALE, boxShadow: SHADOW_MD,
  },
  // 枠の見出し。リキャップの見出し (recapTitle) と全く同じ大きさ・色にそろえる —
  // 同じ「カードの見出し」の形にすることで、2枚が対の関係だと伝わる
  teamsFrameLabel: {
    textAlign: 'center', fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY,
    marginBottom: 14,
  },

  // 第1ゲームの結果 (2ゲーム制のインターミッション)。TournamentStandby の
  // 「たった今終わった試合」カード (matchResultCard) と同じ緑の骨格 (決着済みの色) に
  // 揃える — 振り返りとして観客がきちんと読める大きさ・濃さのまま出す。
  // 下の対戦カード (金枠) との違いは大きさではなく枠の色と並び順で付ける
  recap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    padding: '14px 32px 20px',
    background: WIN_PALE, border: `2px solid ${WIN_LIGHT}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM,
  },
  recapHead: { display: 'flex', alignItems: 'center', gap: 14 },
  recapTitle: { fontSize: 14, fontWeight: 600, color: TEXT_SECONDARY },
  recapDivider: { width: '100%', borderTop: `1px solid ${WIN_LIGHT}` },
  recapRow:   { display: 'flex', alignItems: 'baseline', gap: 16 },
  // 左右で幅を揃えて初めて中央の score/dash が動かない。狭すぎると読めないので
  // 160px 確保しつつ、それでも収まらない名前は省略せず折り返す (文字が切り捨てられないように)
  recapName:  {
    fontSize: 20, fontWeight: 700, color: TEXT_SECONDARY, textAlign: 'center',
    width: 160, flexShrink: 0, lineHeight: 1.25, wordBreak: 'break-word',
  },
  recapScore: { fontSize: 30, fontWeight: 800, color: TEXT_SECONDARY, fontFamily: FONT_NUM },
  recapDash:  { fontSize: 20, color: TEXT_MUTED },
  // 「勝った」という結論そのものが観客に一番伝えたい情報なので、点数の内訳より小さくしすぎない
  recapWinner: { fontSize: 24, fontWeight: 800, color: WIN_BASE },
  // 引き分けは「勝った」わけではないので、勝者と同じ緑にはしない
  recapWinnerDraw: { color: TEXT_PRIMARY },
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

  // インターミッション中 (金枠フレームの中) だけ使う一段大きいサイズ。
  // リキャップの付箋より確実に大きくして、「こちらが主役」を大きさだけで伝える
  cardLg:   { width: 250 },
  headerLg: { fontSize: 23, padding: '16px 0' },
  nameLg:   { fontSize: 25 },
  badgeLg:  { fontSize: 13, padding: '6px 20px' },
};
