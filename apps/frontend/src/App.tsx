import { useEffect, useRef, useState } from 'react';
import { useGameState }      from './hooks/useGameState';
import { useSettings }       from './hooks/useSettings';
import { useGamePhaseSound } from './hooks/useGamePhaseSound';
import { useStartCountdown } from './hooks/useStartCountdown';
import { StartupDialog }   from './components/StartupDialog';
import { MainWindow }      from './components/MainWindow';
import { SettingDialog }   from './components/SettingDialog';
import { MapEditorDialog } from './components/MapEditorDialog';
import { DisplayMode }     from './components/DisplayMode';
import { ManualMode }      from './components/ManualMode';
import { ErrorBoundary }   from './components/ErrorBoundary';
import { Lobby }           from './components/Lobby';
import type { ClientStatusPayload } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import type { EditableMap } from './components/MapEditorDialog';

// WS URL: 環境変数 > window.location.hostname (自動検出) の優先順位
// file:// で読み込む Electron 本番ビルドでは hostname が空文字になるため localhost にフォールバック
const WS_URL    = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? `ws://${window.location.hostname || 'localhost'}:8765`;
const HTTP_BASE = WS_URL.replace(/^ws/, 'http');

const params  = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('room');
const MODE    = params.get('mode') ?? 'display';
const SLOT    = params.get('slot') === '1' ? 1 : 0;

export default function App() {
  // room パラメータなし → ロビー (Web サービスモード)
  if (!ROOM_ID) return <Lobby wsUrl={WS_URL} />;
  if (MODE === 'display') {
    return <ErrorBoundary><DisplayMode wsUrl={WS_URL} roomId={ROOM_ID} httpBase={HTTP_BASE} /></ErrorBoundary>;
  }
  if (MODE === 'manual') {
    return <ErrorBoundary><ManualMode wsUrl={WS_URL} roomId={ROOM_ID} slot={SLOT} /></ErrorBoundary>;
  }
  return <ErrorBoundary><ControlApp roomId={ROOM_ID} /></ErrorBoundary>;
}

function ControlApp({ roomId }: { roomId: string }) {
  const state = useGameState(WS_URL, roomId);
  const { settings, update: updateSettings } = useSettings();
  const { serverStatus, isConnected, gameEnd, snapshot } = state;

  // コントロール窓では SE を鳴らさない (観戦窓との二重再生を防ぐため)
  useGamePhaseSound(snapshot, serverStatus, gameEnd, state.turnInfo, settings.muted, false);
  const countdown = useStartCountdown(serverStatus?.phase, state.turnInfo);

  const [showSettings,  setShowSettings]  = useState(false);
  const [showMapEditor, setShowMapEditor] = useState(false);

  // 初回マウント時はスキップする: settings に保存されているマップ生成パラメータ
  // (ランダムマップの既定値) を、アップロード済み/読み込み済みのマップに上書きしないため
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    state.setMapParams({
      itemNum:  settings.itemNum,
      blockNum: settings.blockNum,
      turnNum:  settings.turnNum,
      mirror:   settings.mirror,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.itemNum, settings.blockNum, settings.turnNum, settings.mirror]);

  useEffect(() => {
    if (serverStatus?.phase === 'setup') {
      state.setDoubleMode(settings.doubleMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.doubleMode, serverStatus?.phase]);

  useEffect(() => {
    if (serverStatus?.phase === 'setup') {
      state.setRepeatMode(settings.repeatMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.repeatMode, serverStatus?.phase]);

  useEffect(() => {
    if (serverStatus?.phase === 'setup') {
      state.setDemoMode(settings.demoMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.demoMode, serverStatus?.phase]);

  // 手動操作コントローラー: スロットが「手動」に設定されたら独立ウィンドウを自動で開く
  useEffect(() => {
    serverStatus?.clients.forEach((c, i) => {
      if (c.type === 'manual') void window.electronAPI?.openManualWindow(i as 0 | 1);
    });
  }, [serverStatus?.clients]);

  // turnDelay: 接続時 + 設定変更時に同期
  useEffect(() => {
    if (isConnected) state.setTurnDelay(settings.turnDelay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.turnDelay, isConnected]);

  // TCP タイムアウト (秒→ミリ秒): 接続時 + 設定変更時に同期
  useEffect(() => {
    if (isConnected) state.setTcpTimeout(settings.timeout * 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.timeout, isConnected]);

  // 環境設定 (ログ保存先・Pythonコマンド): Electron ローカル起動時のみ意味を持つ
  // (バックエンド側も U15_MODE!=='local' なら無視するが、そもそも空文字なら送らない)
  useEffect(() => {
    if (isConnected && settings.logDir) state.setLogDir(settings.logDir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.logDir, isConnected]);

  useEffect(() => {
    if (isConnected && window.electronAPI) state.setPythonCommand(settings.pythonCommand);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.pythonCommand, isConnected]);

  const handleLoadMap = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.map';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${HTTP_BASE}/api/upload/map`, { method: 'POST', body: fd });
      if (res.ok) {
        const { serverPath } = await res.json() as { serverPath: string };
        state.loadMap(serverPath);
      }
    };
    input.click();
  };

  const handleUploadMusic = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await fetch(`${HTTP_BASE}/api/upload/music`, { method: 'POST', body: fd });
  };

  const handleMapEditorSave = (map: EditableMap) => {
    state.loadMapData({
      field: map.field,
      size:  map.size,
      turn:  map.turn,
      teamFirstPoint: map.teamFirstPoint,
    });
  };

  if (!isConnected) {
    return <div style={connecting}>バックエンドに接続中...</div>;
  }

  const phase = serverStatus?.phase ?? 'setup';

  return (
    <>
      {window.electronAPI && (
        <button
          style={fullscreenBtn}
          title="観戦画面を全画面化"
          onClick={() => void window.electronAPI?.toggleDisplayFullscreen()}
        >
          ⛶ 観戦画面を全画面化
        </button>
      )}

      {showSettings && (
        <SettingDialog
          settings={settings}
          darkMode={serverStatus?.darkMode ?? false}
          httpBase={HTTP_BASE}
          onSave={updateSettings}
          onSetDarkMode={state.setDarkMode}
          onUploadMusic={handleUploadMusic}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showMapEditor && (
        <MapEditorDialog
          initialMap={defaultEditableMap}
          theme={settings.theme}
          onSave={handleMapEditorSave}
          onClose={() => setShowMapEditor(false)}
        />
      )}

      {phase === 'setup' ? (
        <StartupDialog
          status={serverStatus ?? defaultStatus}
          httpBase={HTTP_BASE}
          roomId={roomId}
          onSetClient={state.setClient}
          onDeleteProgram={state.deleteProgram}
          onStart={state.requestStart}
          onLoadMap={handleLoadMap}
          onOpenEditor={() => setShowMapEditor(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <MainWindow
          snapshot={state.snapshot}
          turnInfo={state.turnInfo}
          gameEnd={state.gameEnd}
          serverStatus={serverStatus}
          isConnected={isConnected}
          phase={phase}
          theme={settings.theme}
          variant="control"
          countdown={countdown}
          onReset={state.requestReset}
          onNextRound={state.requestNextRound}
          onRepeat={state.requestRepeat}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}
    </>
  );
}

const connecting: React.CSSProperties = {
  display: 'flex', height: '100vh',
  alignItems: 'center', justifyContent: 'center',
  background: '#0d1117', color: '#666', fontFamily: 'monospace', fontSize: 16,
};

const fullscreenBtn: React.CSSProperties = {
  position: 'fixed', top: 8, right: 8, zIndex: 200,
  padding: '5px 12px', border: '1px solid #ccc', borderRadius: 99,
  background: '#ffffffdd', color: '#333', fontSize: 11, cursor: 'pointer',
};

const defaultStatus = {
  phase:        'setup' as const,
  localIP:      '...',
  clients: [
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 12031 },
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 12032 },
  ] as [ClientStatusPayload, ClientStatusPayload],
  doubleMode:   false,
  repeatMode:   false,
  demoMode:     false,
  currentRound: 0 as const,
  roundResults: [],
  darkMode:     false,
};

const defaultEditableMap: EditableMap = {
  field: Array.from({ length: 17 }, () => Array(15).fill(MapObject.NOTHING)),
  size:  { x: 15, y: 17 },
  turn:  100,
  teamFirstPoint: [{ x: 1, y: 8 }, { x: 13, y: 8 }],
};
