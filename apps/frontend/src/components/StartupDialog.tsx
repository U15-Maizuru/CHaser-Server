import type { ClientType, ProcessConfig, ServerStatusPayload } from '@u15/ws-types';
import { TeamSetupPanel } from './TeamSetupPanel';
import { SetupFooter } from './SetupFooter';
import { BG_PANEL, BORDER_COLOR, COOL_COLOR, HOT_COLOR, TEXT_SECONDARY, FONT_MONO } from '../styles/tokens';

interface Props {
  status:          ServerStatusPayload;
  httpBase:        string;
  onSetClient:     (slot: 0 | 1, type: ClientType, cfg?: ProcessConfig) => void;
  onDeleteProgram: (slot: 0 | 1) => void;
  onStart:         () => void;
  onLoadMap:       () => void;
  onOpenEditor:    () => void;
  onOpenSettings:  () => void;
}

const TEAM_LABEL  = ['COOL', 'HOT']        as const;
const TEAM_COLOR  = [COOL_COLOR, HOT_COLOR] as const;
const TEAM_BGCOL  = ['#0d1520', '#1a0d0d'] as const;

export function StartupDialog({
  status, httpBase,
  onSetClient, onDeleteProgram,
  onStart, onLoadMap, onOpenEditor, onOpenSettings,
}: Props) {
  const allReady = status.clients.every(c => c.state === 'ready');

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>U15 Server Maizuru</span>
        <span style={s.subtitle}>セットアップ</span>
        <div style={s.ipBox}>
          <span style={s.ipLabel}>IP</span>
          <span style={s.ipValue}>{status.localIP}</span>
        </div>
        <button style={s.settingsBtn} onClick={onOpenSettings} title="設定">⚙</button>
      </div>

      {/* Two-column team panels */}
      <div style={s.columns}>
        {([0, 1] as const).map(slot => (
          <TeamSetupPanel
            key={slot}
            slot={slot}
            label={TEAM_LABEL[slot]}
            color={TEAM_COLOR[slot]}
            bgColor={TEAM_BGCOL[slot]}
            info={status.clients[slot]}
            httpBase={httpBase}
            onSetType={(type, cfg) => onSetClient(slot, type, cfg)}
            onDeleteProgram={() => onDeleteProgram(slot)}
          />
        ))}
      </div>

      {/* Footer */}
      <SetupFooter
        allReady={allReady}
        onStart={onStart}
        onLoadMap={onLoadMap}
        onOpenEditor={onOpenEditor}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0d1117',
    color: '#eee',
    fontFamily: FONT_MONO,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    background: BG_PANEL,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    flexShrink: 0,
  },
  title:    { fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  subtitle: { fontSize: 12, color: TEXT_SECONDARY, letterSpacing: 2 },
  ipBox: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '3px 12px',
    background: '#0d1117',
    borderRadius: 4,
    border: `1px solid ${BORDER_COLOR}`,
  },
  ipLabel: { fontSize: 10, color: TEXT_SECONDARY, letterSpacing: 1 },
  ipValue: { fontSize: 14, fontWeight: 'bold', fontFamily: FONT_MONO, letterSpacing: 2 },
  settingsBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: TEXT_SECONDARY,
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
  },
  columns: {
    flex: 1,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    overflow: 'auto',
    padding: '16px 16px 0',
    alignItems: 'stretch',
  },
};
