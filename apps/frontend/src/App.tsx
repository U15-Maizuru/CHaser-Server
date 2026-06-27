import { useEffect, useRef, useState } from 'react';
import { useGameState }    from './hooks/useGameState';
import { useSettings }     from './hooks/useSettings';
import { useSound }        from './hooks/useSound';
import { StartupDialog }   from './components/StartupDialog';
import { MainWindow }      from './components/MainWindow';
import { SettingDialog }   from './components/SettingDialog';
import { MapEditorDialog } from './components/MapEditorDialog';
import type { ClientStatusPayload } from './types/ws-types';
import { MapObject, Winner } from './types/ws-types';
import type { EditableMap } from './components/MapEditorDialog';

const WS_URL = 'ws://localhost:8765';

export default function App() {
  const state = useGameState(WS_URL);
  const { settings, update: updateSettings } = useSettings();
  const { serverStatus, isConnected, gameEnd, snapshot } = state;
  const { play } = useSound();

  const [showSettings,  setShowSettings]  = useState(false);
  const [showMapEditor, setShowMapEditor] = useState(false);

  // Track previous state for sound triggers
  const prevPhase  = useRef(serverStatus?.phase);
  const prevScoreC = useRef(0);
  const prevScoreH = useRef(0);

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

  useEffect(() => {
    if (settings.muted) return;
    const sc = snapshot?.teamScore;
    if (!sc) return;
    if (sc[0] > prevScoreC.current) play('get_C');
    if (sc[1] > prevScoreH.current) play('get_H');
    prevScoreC.current = sc[0];
    prevScoreH.current = sc[1];
  }, [snapshot?.teamScore, play, settings.muted]);

  // --- Sync map params to backend whenever settings change ---
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

  // --- Handlers ---
  const handleLoadMap = async () => {
    const filePath = await window.electronAPI?.openMapFile?.();
    if (filePath) state.loadMap(filePath);
  };

  const handleMapEditorSave = (map: EditableMap, filePath?: string) => {
    state.loadMapData({
      field: map.field,
      size:  map.size,
      turn:  map.turn,
      teamFirstPoint: map.teamFirstPoint,
    });
    if (filePath) {
      // also tell backend to load the saved file (it'll re-import)
      state.loadMap(filePath);
    }
  };

  // --- Render ---
  if (!isConnected) {
    return <div style={connecting}>バックエンドに接続中...</div>;
  }

  const phase = serverStatus?.phase ?? 'setup';

  return (
    <>
      {/* 設定ダイアログ */}
      {showSettings && (
        <SettingDialog
          settings={settings}
          onSave={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* マップエディタ */}
      {showMapEditor && (
        <MapEditorDialog
          initialMap={defaultEditableMap}
          theme={settings.theme}
          onSave={handleMapEditorSave}
          onClose={() => setShowMapEditor(false)}
        />
      )}

      {/* メイン UI */}
      {phase === 'setup' ? (
        <StartupDialog
          status={serverStatus ?? defaultStatus}
          onSetClient={state.setClient}
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
          isConnected={isConnected}
          phase={phase}
          theme={settings.theme}
          onReset={state.requestReset}
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
  phase: 'setup' as const,
  localIP: '...',
  clients: [
    { type: 'tcp' as const, state: 'waiting' as const, name: '', ip: '', port: 12031 },
    { type: 'tcp' as const, state: 'waiting' as const, name: '', ip: '', port: 12032 },
  ] as [ClientStatusPayload, ClientStatusPayload],
};

const defaultEditableMap: EditableMap = {
  field: Array.from({ length: 17 }, () => Array(15).fill(MapObject.NOTHING)),
  size:  { x: 15, y: 17 },
  turn:  100,
  teamFirstPoint: [{ x: 1, y: 8 }, { x: 13, y: 8 }],
};
