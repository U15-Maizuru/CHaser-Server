import type { ClientType, ProcessConfig, ServerStatusPayload } from '@u15/ws-types';
import { TeamSetupPanel } from './TeamSetupPanel';
import { SetupFooter } from './SetupFooter';
import {
  BG_ROOT, BG_HEADER, BG_CARD,
  BORDER_COLOR, COOL_COLOR, COOL_PALE, COOL_DARK, HOT_COLOR, HOT_PALE, HOT_DARK,
  TURN_BASE, TURN_LIGHT,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

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
const TEAM_BGCOL  = [COOL_PALE, HOT_PALE]   as const;
const TEAM_DARK   = [COOL_DARK, HOT_DARK]   as const;

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
        {status.doubleMode && (
          <div style={s.roundBadge}>
            {status.roundResults?.length === 0
              ? '第1試合'
              : `第${(status.currentRound ?? 0) + 1}試合`}
          </div>
        )}
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
            darkColor={TEAM_DARK[slot]}
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
    background: BG_ROOT,
    color: TEXT_PRIMARY,
    fontFamily: FONT_UI,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 20px',
    background: BG_HEADER,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    flexShrink: 0,
  },
  title:    { fontSize: 16, fontWeight: 800, letterSpacing: '0.04em', color: TEXT_PRIMARY },
  subtitle: { fontSize: 12, color: TEXT_SECONDARY, letterSpacing: 2 },
  ipBox: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '3px 12px',
    background: BG_CARD,
    borderRadius: RADIUS_SM,
    border: `1px solid ${BORDER_COLOR}`,
  },
  ipLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 1 },
  ipValue: { fontSize: 14, fontWeight: 700, fontFamily: FONT_NUM, letterSpacing: 1, color: TEXT_PRIMARY },
  settingsBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: TEXT_MUTED,
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
  },
  roundBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 12px',
    borderRadius: 99,
    background: TURN_LIGHT,
    color: TURN_BASE,
    letterSpacing: 1,
  },
  columns: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    overflow: 'auto',
    padding: '16px 16px 0',
    alignItems: 'stretch',
  },
};
