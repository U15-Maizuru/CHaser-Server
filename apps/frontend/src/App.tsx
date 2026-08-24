import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameState }      from './hooks/useGameState';
import { useMatchConfig }    from './hooks/useMatchConfig';
import { useMapGenParams, toMapParams } from './hooks/useMapGenParams';
import { useCurrentMap } from './hooks/useCurrentMap';
import { downloadMapFile, deleteMusicFile, deleteSoundFile, fetchCurrentMap, saveMapToLibrary, uploadMusic, uploadSound } from './lib/api';
import { readAppLocation } from './lib/appMode';
import { useEnvConfig }      from './hooks/useEnvConfig';
import { useGamePhaseSound } from './hooks/useGamePhaseSound';
import { useStartCountdown } from './hooks/useStartCountdown';
import { StartupDialog }   from './components/StartupDialog';
import { MainWindow }      from './components/MainWindow';
import { BottomBar }       from './components/BottomBar';
import { SettingDialog }   from './components/SettingDialog';
import { MapEditorDialog, defaultEditableMap, toInlineMapData } from './components/MapEditorDialog';
import { MapEditorMode }   from './components/MapEditorMode';
import { MapLibraryDialog } from './components/MapLibraryDialog';
import { ProgramLibraryDialog } from './components/ProgramLibraryDialog';
import { TournamentMode }  from './components/tournament/TournamentMode';
import { DisplayMode }     from './components/DisplayMode';
import { ManualMode }      from './components/ManualMode';
import { ErrorBoundary }   from './components/ErrorBoundary';
import { Lobby }           from './components/Lobby';
import type { ClientStatusPayload, InlineMapData, MapCatalogEntry, SoundKey } from '@u15/ws-types';
import { DEFAULT_DISPLAY_PREFS, MapObject } from '@u15/ws-types';
import type { EditableMap } from './components/MapEditorDialog';

// WS URL: 環境変数 > window.location.hostname (自動検出) の優先順位
// file:// で読み込む Electron 本番ビルドでは hostname が空文字になるため localhost にフォールバック
const WS_URL    = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? `ws://${window.location.hostname || 'localhost'}:8765`;
const HTTP_BASE = WS_URL.replace(/^ws/, 'http');

export default function App() {
  const { roomId, mode, slot, mapId } = readAppLocation(window.location.search);

  // room パラメータなし → ロビー (Web サービスモード)
  if (!roomId) return <Lobby wsUrl={WS_URL} />;

  switch (mode) {
    case 'display':
      return <ErrorBoundary><DisplayMode wsUrl={WS_URL} roomId={roomId} httpBase={HTTP_BASE} /></ErrorBoundary>;
    case 'manual':
      return <ErrorBoundary><ManualMode wsUrl={WS_URL} roomId={roomId} slot={slot} /></ErrorBoundary>;
    case 'tournament':
      return <ErrorBoundary><TournamentMode wsUrl={WS_URL} roomId={roomId} httpBase={HTTP_BASE} /></ErrorBoundary>;
    case 'mapEditor':
      return <ErrorBoundary><MapEditorMode httpBase={HTTP_BASE} roomId={roomId} mapId={mapId} /></ErrorBoundary>;
    case 'control':
      return <ErrorBoundary><ControlApp roomId={roomId} /></ErrorBoundary>;
  }
}

function ControlApp({ roomId }: { roomId: string }) {
  const state = useGameState(WS_URL, roomId);
  const { config: matchConfig, update: updateMatchConfig } = useMatchConfig();
  const { params: mapGenParams }               = useMapGenParams();
  const { envConfig, update: updateEnvConfig } = useEnvConfig();
  const { serverStatus, isConnected, gameEnd, snapshot } = state;
  const displayPrefs = serverStatus?.displayPrefs ?? DEFAULT_DISPLAY_PREFS;

  // 「接続中...」の全画面差し替えは初回接続前だけにする。一度繋がったあとの瞬断
  // (例: window.confirm() でレンダラーが一瞬ブロックされる間の再接続) のたびに
  // 全部差し替えると、開いていたダイアログ (マップ管理など) ごと消えて「一旦閉じる」
  // ように見えてしまう。再接続中かどうかは BottomBar の CONNECTED/DISCONNECTED
  // バッジで十分に伝わるので、初回接続後は UI を保ったまま裏で再接続させる。
  const hasConnectedOnce = useRef(false);
  if (isConnected) hasConnectedOnce.current = true;

  // コントロール窓には場面転換の暗転が無いので、phase の変化がそのままカウントダウン開始の合図
  const countdown = useStartCountdown(serverStatus?.phase === 'playing', state.turnInfo);

  // コントロール窓では SE を鳴らさない (観戦窓との二重再生を防ぐため)
  useGamePhaseSound({
    httpBase: HTTP_BASE,
    snapshot, serverStatus, gameEnd, turnInfo: state.turnInfo, countdown,
    awarding: false, muted: displayPrefs.muted, enabled: false,
  });

  const [showSettings,       setShowSettings]       = useState(false);
  const [showMapLibrary,     setShowMapLibrary]     = useState(false);
  const [showMapEditor,      setShowMapEditor]      = useState(false);
  const [showProgramLibrary, setShowProgramLibrary] = useState(false);
  const [editorSeed,         setEditorSeed]         = useState<EditableMap | null>(null);

  // 今出ているマップ (観戦窓の待機画面と同じフックを使う)
  const { currentMap, refresh: refreshCurrentMap } = useCurrentMap(
    HTTP_BASE, roomId, isConnected, serverStatus);

  const phase        = serverStatus?.phase ?? 'setup';
  const roundResults = serverStatus?.roundResults ?? [];
  // マップを差し替えてよいか (バックエンドの RoundController.canEditMap と同じ条件)
  const canEditMap   = phase === 'setup' && roundResults.length === 0;

  // 2ゲーム制/リピート/デモはサーバーが真実を持つ状態 (ServerStatusPayload) なので、
  // クライアントにキャッシュを持たず、そのまま表示してそのまま送る。ローカルに下書きを
  // 溜めると、コントロール窓を複数開いたときに互いの古い値で上書きし合う。

  // 手動操作コントローラー: スロットが「手動」に設定されたら独立ウィンドウを自動で開く
  useEffect(() => {
    serverStatus?.clients.forEach((c, i) => {
      if (c.type === 'manual') void window.electronAPI?.openManualWindow(i as 0 | 1);
    });
  }, [serverStatus?.clients]);

  // ターン表示時間 / TCP タイムアウトは ServerStatusPayload に含まれない (サーバーが
  // 返してこない) ため、接続後に一度だけ保存値を送って同期させる。以降は設定ダイアログ
  // 「対戦」タブでの明示的な編集時 (blur) にのみ送る。
  const didCommitMatchConfig = useRef(false);
  useEffect(() => {
    if (!isConnected) { didCommitMatchConfig.current = false; return; }
    if (didCommitMatchConfig.current) return;
    didCommitMatchConfig.current = true;
    state.setTurnDelay(matchConfig.turnDelay);
    state.setTcpTimeout(matchConfig.timeout * 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const commitMatchConfig = () => {
    state.setTurnDelay(matchConfig.turnDelay);
    state.setTcpTimeout(matchConfig.timeout * 1000);
  };

  // マップ生成パラメータも ServerStatusPayload に含まれない。サーバーは受け取った値を
  // 覚えてリセット・リピート時の再生成にも使うので、送らないと初期マップだけが
  // ハードコードの既定値 (15×17 / ブロック20 / アイテム51 / ターン100) のままになる。
  // そのため接続後に一度だけ push する。
  //
  // 受け取ったサーバーはその場でマップを作り直すため、ライブラリ・エディタ由来の
  // マップが選ばれている間 (mapSource.kind !== 'random') は送らない。コントロール窓を
  // 後から開いたときに選択済みのマップを黙って捨ててしまうのを防ぐ。
  const didCommitMapParams = useRef(false);
  useEffect(() => {
    if (!isConnected) { didCommitMapParams.current = false; return; }
    if (didCommitMapParams.current) return;
    if (!serverStatus) return;
    // 対戦中・2ゲーム制で試合の途中のときは canEditMap ゲートで黙って捨てられるので、
    // 送れる状態になるまで待ってから一度だけ送る
    if (!canEditMap) return;
    if (serverStatus.mapSource.kind !== 'random') return;
    didCommitMapParams.current = true;
    state.setMapParams(toMapParams(mapGenParams));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, serverStatus, canEditMap]);

  const handleApplyMapParams = () => {
    state.setMapParams(toMapParams(mapGenParams));
  };

  // 環境設定 (ログ保存先・Pythonコマンド): Electron ローカル起動時のみ意味を持つ
  // (バックエンド側も U15_MODE!=='local' なら無視するが、そもそも空文字なら送らない)
  useEffect(() => {
    if (isConnected && envConfig.logDir) state.setLogDir(envConfig.logDir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig.logDir, isConnected]);

  useEffect(() => {
    if (isConnected && window.electronAPI) state.setPythonCommand(envConfig.pythonCommand);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig.pythonCommand, isConnected]);

  // 大会運営の入口は ?mode=tournament の1つだけ。Electron は専用ウィンドウ、
  // ブラウザは別タブで同じ画面を開く
  const openTournamentWindow = () => {
    if (window.electronAPI) {
      void window.electronAPI.openTournamentWindow();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.set('mode', 'tournament');
    window.open(url.toString(), `tournament-${roomId}`);
  };

  const handleUploadMusic = (file: File) => uploadMusic(HTTP_BASE, file);
  const handleDeleteMusic = (filename: string) => deleteMusicFile(HTTP_BASE, filename);
  const handleUploadSound = (key: SoundKey, file: File) => uploadSound(HTTP_BASE, key, file);
  const handleDeleteSound = (filename: string) => deleteSoundFile(HTTP_BASE, filename);

  const openMapEditor = async () => {
    const data = await fetchCurrentMap(HTTP_BASE, roomId);
    setEditorSeed(data
      ? { field: data.field as MapObject[][], size: data.size, turn: data.turn, teamFirstPoint: data.teamFirstPoint }
      : defaultEditableMap);
    setShowMapEditor(true);
  };

  // マップ管理からの入口。room の対戦状態とは無関係なので、モーダルではなく独立ウィンドウ/タブで開く
  // (Electron: 専用ウィンドウ、ブラウザ: 別タブ)。openTournamentWindow と同じ分岐パターン
  const openMapEditorWindow = (entry: MapCatalogEntry | null) => {
    const mapId = entry?.id ?? null;
    if (window.electronAPI) {
      void window.electronAPI.openMapEditorWindow(mapId);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.set('mode', 'mapEditor');
    if (mapId) url.searchParams.set('mapId', mapId); else url.searchParams.delete('mapId');
    window.open(url.toString(), `mapEditor-${roomId}-${mapId ?? 'new'}`);
  };

  const handleApplyMapEntry = (entry: MapCatalogEntry) => {
    state.loadMap(entry.id);
    void refreshCurrentMap();
  };

  const handleMapEditorApply = (map: EditableMap) => {
    state.loadMapData(toInlineMapData(map));
    void refreshCurrentMap();
  };

  // ランダム生成・エディタ由来のマップを残す手段。ライブラリ保存もダウンロードも
  // 「今出ているマップ」に対して働くので、エディタとマップ列の両方から同じものを使う。
  // 成功したかどうかは呼び出し元 (マップエディタ) が画面に出すので、そのまま返す。
  const saveMap = (data: InlineMapData, displayName: string) => saveMapToLibrary(HTTP_BASE, displayName, data);
  const downloadMap = (data: InlineMapData, displayName: string) => downloadMapFile(HTTP_BASE, displayName, data);

  if (!isConnected && !hasConnectedOnce.current) {
    return <div style={connecting}>バックエンドに接続中...</div>;
  }

  return (
    <>
      {showSettings && (
        <SettingDialog
          displayPrefs={displayPrefs}
          envConfig={envConfig}
          status={serverStatus ?? defaultStatus}
          matchConfig={matchConfig}
          darkMode={serverStatus?.darkMode ?? false}
          httpBase={HTTP_BASE}
          onSetDisplayPrefs={state.setDisplayPrefs}
          onSaveEnv={updateEnvConfig}
          onSetDarkMode={state.setDarkMode}
          onSetDoubleMode={state.setDoubleMode}
          onSetRepeatMode={state.setRepeatMode}
          onSetDemoMode={state.setDemoMode}
          onChangeMatchConfig={updateMatchConfig}
          onCommitMatchConfig={commitMatchConfig}
          onSetPorts={state.setPorts}
          onUploadMusic={handleUploadMusic}
          onDeleteMusic={handleDeleteMusic}
          onUploadSound={handleUploadSound}
          onDeleteSound={handleDeleteSound}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showMapLibrary && (
        <MapLibraryDialog
          httpBase={HTTP_BASE}
          onClose={() => setShowMapLibrary(false)}
          previewMapId={state.serverStatus?.previewMapId ?? null}
          onPreviewMap={state.previewMap}
          onOpenEditor={openMapEditorWindow}
        />
      )}

      {showMapEditor && editorSeed && (
        <MapEditorDialog
          initialMap={editorSeed}
          theme={displayPrefs.theme}
          httpBase={HTTP_BASE}
          onApply={handleMapEditorApply}
          onSaveToLibrary={(map, name) => saveMap(toInlineMapData(map), name)}
          onDownload={(map, name) => downloadMap(toInlineMapData(map), name)}
          onClose={() => setShowMapEditor(false)}
        />
      )}

      {showProgramLibrary && (
        <ProgramLibraryDialog
          httpBase={HTTP_BASE}
          onClose={() => setShowProgramLibrary(false)}
        />
      )}

      <div style={controlLayout}>
        <div style={controlContent}>
          {phase === 'setup' ? (
            <StartupDialog
              status={serverStatus ?? defaultStatus}
              httpBase={HTTP_BASE}
              roomId={roomId}
              displayTitle={displayPrefs.displayTitle}
              theme={displayPrefs.theme}
              currentMap={currentMap}
              canEditMap={canEditMap}
              onSetClient={state.setClient}
              onDeleteProgram={state.deleteProgram}
              onOpenLibraryManager={() => setShowProgramLibrary(true)}
              onApplyMapEntry={handleApplyMapEntry}
              onApplyMapParams={handleApplyMapParams}
              onOpenMapEditor={() => void openMapEditor()}
              onSaveCurrentMap={name => { if (currentMap) void saveMap(currentMap, name); }}
              onDownloadCurrentMap={name => { if (currentMap) void downloadMap(currentMap, name); }}
              onOpenMapLibrary={() => setShowMapLibrary(true)}
            />
          ) : (
            <MainWindow
              snapshot={state.snapshot}
              turnInfo={state.turnInfo}
              gameEnd={state.gameEnd}
              serverStatus={serverStatus}
              isConnected={isConnected}
              phase={phase}
              theme={displayPrefs.theme}
              veilAlpha={displayPrefs.veilAlpha}
              variant="control"
              countdown={countdown}
              displayTitle={displayPrefs.displayTitle}
              tournament={state.tournamentState}
            />
          )}
        </div>

        <BottomBar
          isConnected={isConnected}
          status={serverStatus ?? defaultStatus}
          onStart={state.requestStart}
          onNextRound={state.requestNextRound}
          onRepeat={state.requestRepeat}
          onReset={state.requestReset}
          onOpenMapLibrary={() => setShowMapLibrary(true)}
          onOpenProgramLibrary={() => setShowProgramLibrary(true)}
          onOpenTournament={openTournamentWindow}
          tournamentName={state.tournamentState?.name ?? null}
          onOpenSettings={() => setShowSettings(true)}
          onToggleFullscreen={window.electronAPI
            ? () => void window.electronAPI?.toggleDisplayFullscreen()
            : undefined}
        />
      </div>
    </>
  );
}

const controlLayout: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100vh',
};

const controlContent: React.CSSProperties = {
  flex: 1, minHeight: 0, overflow: 'hidden',
};

const connecting: React.CSSProperties = {
  display: 'flex', height: '100vh',
  alignItems: 'center', justifyContent: 'center',
  background: '#0d1117', color: '#666', fontFamily: 'monospace', fontSize: 16,
};

const defaultStatus = {
  phase:        'setup' as const,
  localIP:      '...',
  clients: [
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 2009 },
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 2010 },
  ] as [ClientStatusPayload, ClientStatusPayload],
  doubleMode:   false,
  repeatMode:   false,
  demoMode:     false,
  currentRound: 0 as const,
  roundResults: [],
  darkMode:     false,
  mapSource:    { kind: 'random' as const },
  displayPrefs: DEFAULT_DISPLAY_PREFS,
  previewMapId: null,
};
