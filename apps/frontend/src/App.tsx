import { useEffect, useRef, useState } from 'react';
import { useGameState }    from './hooks/useGameState';
import { useSettings }     from './hooks/useSettings';
import { useSound, useScoreSound } from './hooks/useSound';
import { StartupDialog }   from './components/StartupDialog';
import { MainWindow }      from './components/MainWindow';
import { SettingDialog }   from './components/SettingDialog';
import { MapEditorDialog } from './components/MapEditorDialog';
import { DisplayMode }     from './components/DisplayMode';
import type { ClientStatusPayload } from '@u15/ws-types';
import { MapObject, Winner } from '@u15/ws-types';
import type { EditableMap } from './components/MapEditorDialog';

const WS_URL    = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL ?? 'ws://localhost:8765';
const HTTP_BASE = WS_URL.replace(/^ws/, 'http');

// ?mode=display → 対戦表示専用ウィンドウ
// ?mode=control (or none) → セットアップ・コントロールウィンドウ
const MODE = new URLSearchParams(window.location.search).get('mode') ?? 'control';

export default function App() {
  if (MODE === 'display') return <DisplayMode />;
  return <ControlApp />;
}

function ControlApp() {
  const state = useGameState(WS_URL);
  const { settings, update: updateSettings } = useSettings();
  const { serverStatus, isConnected, gameEnd, snapshot } = state;
  const { play } = useSound();

  useScoreSound(snapshot, settings.muted, play);

  const [showSettings,  setShowSettings]  = useState(false);
  const [showMapEditor, setShowMapEditor] = useState(false);

  const prevPhase = useRef(serverStatus?.phase);

  useEffect(() => {
    if (settings.muted) return;
    const phase = serverStatus?.phase;
    if (prevPhase.current !== 'playing' && phase === 'playing') play('go');
    if (phase === 'finished' && gameEnd) {
      play('finish');
      if (gameEnd.winner === Winner.COOL || gameEnd.winner === Winner.HOT)
        setTimeout(() => play('win'), 800);
    }
    prevPhase.current = phase;
  }, [serverStatus?.phase, gameEnd, play, settings.muted]);

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

  // doubleMode / turnDelay 設定をバックエンドへ同期
  useEffect(() => {
    if (serverStatus?.phase === 'setup') {
      state.setDoubleMode(settings.doubleMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.doubleMode, serverStatus?.phase]);

  // turnDelay: 接続時 + 設定変更時に同期 (接続前に呼ぶと WS が未オープンで無視される)
  useEffect(() => {
    if (isConnected) state.setTurnDelay(settings.turnDelay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.turnDelay, isConnected]);

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
          httpBase={HTTP_BASE}
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
