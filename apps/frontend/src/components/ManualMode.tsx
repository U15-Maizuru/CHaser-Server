import { useGameState } from '../hooks/useGameState';
import { ManualControls } from './ManualControls';
import { BG_ROOT, TEXT_MUTED, FONT_UI } from '../ui';

export function ManualMode({ wsUrl, roomId, slot }: { wsUrl: string; roomId: string; slot: 0 | 1 }) {
  const state = useGameState(wsUrl, roomId);
  const { isConnected, manualRequest, sendManualAction } = state;

  return (
    <div style={root}>
      {isConnected ? (
        <ManualControls slot={slot} manualRequest={manualRequest} onAction={sendManualAction} />
      ) : (
        <div style={sub}>バックエンドに接続中...</div>
      )}
    </div>
  );
}

const root: React.CSSProperties = {
  height: '100vh', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  background: BG_ROOT, fontFamily: FONT_UI, padding: 16,
};

const sub: React.CSSProperties = { fontSize: 14, color: TEXT_MUTED };
