import { useState } from 'react';
import type { ClientStatusPayload, ClientType, ProcessConfig } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { LibrarySection } from './LibrarySection';
import {
  BG_CARD, BORDER_COLOR, TEXT_SECONDARY, TEXT_MUTED, TEXT_PRIMARY,
  STATE_READY, STATE_CONNECTED, STATE_WAITING,
  SHADOW_SM, RADIUS_MD,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  slot:            0 | 1;
  label:           'COOL' | 'HOT';
  color:           string;
  bgColor:         string;
  darkColor:       string;
  info:            ClientStatusPayload;
  httpBase:        string;
  onSetType:       (type: ClientType, cfg?: ProcessConfig) => void;
  onDeleteProgram: () => void;
}

const STATE_LABEL: Record<string, string> = {
  waiting:   'プログラム待ち',
  connected: '接続中...',
  ready:     '準備完了',
};

const TYPE_LABELS: { type: ClientType; label: string }[] = [
  { type: 'process', label: 'プログラム' },
  { type: 'tcp',     label: 'TCP接続'   },
  { type: 'cpu',     label: 'CPU'        },
  { type: 'manual',  label: '手動操作'  },
];

export function TeamSetupPanel({ slot, label, color, bgColor, darkColor, info, httpBase, onSetType, onDeleteProgram }: Props) {
  const [tcpRuntime, setTcpRuntime] = useState('python');

  const stateColor = info.state === 'ready'     ? STATE_READY
                   : info.state === 'connected' ? STATE_CONNECTED
                   : STATE_WAITING;

  const progEndpoint = `${httpBase}/api/upload/program?slot=${slot}`;

  const handleTypeChange = (type: ClientType) => {
    if (type === 'cpu' || type === 'manual' || type === 'tcp') {
      onSetType(type);
    } else {
      onSetType('process');
    }
  };

  const handleProgramUploaded = (serverPath: string) => {
    const libPath = `server/libs/${slot === 0 ? 'cool' : 'hot'}`;
    onSetType('process', {
      programType:    'python',
      programPath:    serverPath,
      runtimeCommand: tcpRuntime,
      libPath,
    });
  };

  const handleDeleteProgram = () => {
    onDeleteProgram();
  };

  const activeTypeBtn = { background: color, borderColor: color, color: '#fff' };

  return (
    <div style={s.panel}>
      <div style={{ ...s.header, background: `linear-gradient(135deg, ${color}, ${darkColor})` }}>
        {label}
      </div>
      <div style={{ ...s.body, background: bgColor }}>
        {/* Mode selector */}
        <div style={s.typeRow}>
          {TYPE_LABELS.map(({ type, label: lbl }) => (
            <button
              key={type}
              style={{ ...s.typeBtn, ...(info.type === type ? activeTypeBtn : {}) }}
              onClick={() => handleTypeChange(type)}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Program upload area */}
        {info.type === 'process' && (
          <div style={s.uploadSection}>
            <FileDropZone
              endpoint={progEndpoint}
              accept={['.py', '.exe']}
              label="プログラムファイルをドロップ"
              onUploaded={handleProgramUploaded}
            />
            {info.state === 'ready' && (
              <button style={s.resetBtn} onClick={handleDeleteProgram}>
                プログラムを削除
              </button>
            )}
          </div>
        )}

        {/* TCP mode: show port */}
        {info.type === 'tcp' && (
          <div style={s.tcpInfo}>
            <span style={s.portLabel}>ポート</span>
            <span style={s.portValue}>{info.port}</span>
          </div>
        )}

        {/* Status badge */}
        <div style={s.statusRow}>
          <span style={{ ...s.badge, background: stateColor }}>
            {STATE_LABEL[info.state] ?? info.state}
          </span>
          {info.state !== 'waiting' && info.name && (
            <span style={s.playerName}>{info.name}</span>
          )}
          {info.error && (
            <span style={s.errorText} title={info.error}>⚠ エラー</span>
          )}
        </div>
        {info.ip && <div style={s.ipSmall}>{info.ip}</div>}

        {/* Library management */}
        {info.type === 'process' && (
          <LibrarySection slot={slot} httpBase={httpBase} />
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: RADIUS_MD,
    overflow: 'hidden',
    boxShadow: SHADOW_SM,
    minWidth: 280,
    minHeight: 300,
    background: BG_CARD,
    fontFamily: FONT_UI,
  },
  header: {
    padding: '14px 18px',
    color: '#fff',
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: '0.1em',
  },
  body: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '16px 18px',
  },
  typeRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 },
  typeBtn: {
    minWidth: 0,
    padding: '6px 4px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  uploadSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  resetBtn: {
    padding: '3px 10px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_MUTED,
    fontSize: 10,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  tcpInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  portLabel: { fontSize: 11, color: TEXT_MUTED },
  portValue: { fontSize: 14, fontFamily: FONT_NUM, color: TEXT_PRIMARY },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 9px',
    borderRadius: 99,
    color: '#fff',
    letterSpacing: 1,
  },
  playerName: { fontSize: 13, fontWeight: 700, fontFamily: FONT_NUM, color: TEXT_PRIMARY },
  errorText:  { fontSize: 11, color: '#c43a3a', cursor: 'help' },
  ipSmall:    { fontSize: 10, color: TEXT_MUTED, fontFamily: FONT_NUM },
};
