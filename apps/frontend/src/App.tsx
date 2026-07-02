import { useEffect, useRef, useState } from 'react';
import { useGameState }      from './hooks/useGameState';
import { useSettings }       from './hooks/useSettings';
import { useGamePhaseSound } from './hooks/useGamePhaseSound';
import { StartupDialog }   from './components/StartupDialog';
import { MainWindow }      from './components/MainWindow';
import { SettingDialog }   from './components/SettingDialog';
import { MapEditorDialog } from './components/MapEditorDialog';
import { DisplayMode }     from './components/DisplayMode';
import { Lobby }           from './components/Lobby';
import type { ClientStatusPayload } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import type { EditableMap } from './components/MapEditorDialog';

// WS URL: 環境変数 > window.location.hostname (自動検出) の優先順位
const WS_URL    = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? `ws://${window.location.hostname}:8765`;
const HTTP_BASE = WS_URL.replace(/^ws/, 'http');

const params  = new URLSearchParams(window.location.search);
const ROOM_ID = params.get('room');
const MODE    = params.get('mode') ?? 'display';

export default function App() {
  // room パラメータなし → ロビー (Web サービスモード)
  if (!ROOM_ID) return <Lobby wsUrl={WS_URL} />;
  if (MODE === 'display') return <DisplayMode wsUrl={WS_URL} roomId={ROOM_ID} />;
  return <ControlApp roomId={ROOM_ID} />;
}

function ControlApp({ roomId }: { roomId: string }) {
  const state = useGameState(WS_URL, roomId);
  const { settings, update: updateSettings } = useSettings();
  const { serverStatus, isConnected, gameEnd, snapshot } = state;

  useGamePhaseSound(snapshot, serverStatus, gameEnd, settings.muted);

  const [showSettings,  setShowSettings]  = useState(false);
  const [showMapEditor, setShowMapEditor] = useState(false);

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

  // turnDelay: 接続時 + 設定変更時に同期
  useEffect(() => {
    if (isConnected) state.setTurnDelay(settings.turnDelay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.turnDelay, isConnected]);

  // アップロード URL に roomId を含める
  const httpBaseRoom = `${HTTP_BASE}?room=${roomId}`;

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
      {showSettings && (
        <SettingDialog
          settings={settings}
          onSave={updateSettings}
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
          httpBase={httpBaseRoom}
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
          manualRequest={state.manualRequest}
          onReset={state.requestReset}
          onNextRound={state.requestNextRound}
          onManualAction={state.sendManualAction}
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

const defaultStatus = {
  phase:        'setup' as const,
  localIP:      '...',
  clients: [
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 12031 },
    { type: 'process' as const, state: 'waiting' as const, name: '', ip: '', port: 12032 },
  ] as [ClientStatusPayload, ClientStatusPayload],
  doubleMode:   false,
  currentRound: 0 as const,
  roundResults: [],
};

const defaultEditableMap: EditableMap = {
  field: Array.from({ length: 17 }, () => Array(15).fill(MapObject.NOTHING)),
  size:  { x: 15, y: 17 },
  turn:  100,
  teamFirstPoint: [{ x: 1, y: 8 }, { x: 13, y: 8 }],
};
