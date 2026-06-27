import type { GameEndPayload, GameStateSnapshot, TurnStartPayload, ServerPhase } from '@u15/ws-types';
import { useGameState } from '../hooks/useGameState';
import { GameBoardCanvas } from './GameBoardCanvas';
import { ScorePanel } from './ScorePanel';

const WS_URL = 'ws://localhost:8765';

interface Props {
  snapshot:       GameStateSnapshot | null;
  turnInfo:       TurnStartPayload  | null;
  gameEnd:        GameEndPayload    | null;
  isConnected:    boolean;
  phase:          ServerPhase;
  theme?:         string;
  onReset:        () => void;
  onOpenSettings: () => void;
}

export function MainWindow({ snapshot, turnInfo, gameEnd, isConnected, phase, theme = 'Jewel', onReset, onOpenSettings }: Props) {
  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>U15 Server Maizuru</span>
        <span style={{ ...styles.badge, background: isConnected ? '#2d6a4f' : '#7b2d2d' }}>
          {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <button style={styles.settingsBtn} onClick={onOpenSettings} title="設定">⚙</button>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        {snapshot ? (
          <>
            <div style={styles.boardWrap}>
              <GameBoardCanvas snapshot={snapshot} theme={theme} />
            </div>
            <ScorePanel
              snapshot={snapshot}
              turnInfo={turnInfo}
              gameEnd={gameEnd}
              phase={phase}
              onReset={onReset}
            />
          </>
        ) : (
          <div style={styles.waiting}>
            {isConnected
              ? 'ゲーム開始を待っています...'
              : 'バックエンドに接続中...'}
          </div>
        )}
      </div>
    </div>
  );
}

// スタンドアロン (WS を自前で接続) で使う場合のエクスポート
export function MainWindowStandalone() {
  const { snapshot, turnInfo, gameEnd, serverStatus, isConnected, requestReset } = useGameState(WS_URL);
  return (
    <MainWindow
      snapshot={snapshot}
      turnInfo={turnInfo}
      gameEnd={gameEnd}
      isConnected={isConnected}
      phase={serverStatus?.phase ?? 'playing'}
      onReset={requestReset}
      onOpenSettings={() => {}}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0d1117',
    color: '#eee',
    fontFamily: 'monospace',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
  },
  title:       { fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  settingsBtn: { marginLeft: 'auto', background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
  badge: {
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
    letterSpacing: 1,
  },
  main: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 16,
    padding: 16,
    overflow: 'auto',
  },
  boardWrap: {
    border: '2px solid #30363d',
    borderRadius: 4,
    overflow: 'hidden',
    flexShrink: 0,
  },
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    fontSize: 18,
    color: '#888',
  },
};
