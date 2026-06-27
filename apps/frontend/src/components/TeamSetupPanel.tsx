import { useState } from 'react';
import type { ClientStatusPayload, ClientType, ProcessConfig } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { LibrarySection } from './LibrarySection';
import {
  BG_PANEL, BORDER_COLOR, TEXT_SECONDARY, TEXT_DIM,
  STATE_READY, STATE_CONNECTED, STATE_WAITING, ACCENT_BLUE,
} from '../styles/tokens';

interface Props {
  slot:            0 | 1;
  label:           'COOL' | 'HOT';
  color:           string;
  bgColor:         string;
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

export function TeamSetupPanel({ slot, label, color, bgColor, info, httpBase, onSetType, onDeleteProgram }: Props) {
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

  return (
    <div style={{ ...s.panel, borderColor: color, background: bgColor }}>
      <div style={{ ...s.title, color }}>{label}</div>

      {/* Mode selector */}
      <div style={s.typeRow}>
        {TYPE_LABELS.map(({ type, label: lbl }) => (
          <button
            key={type}
            style={{ ...s.typeBtn, ...(info.type === type ? s.typeBtnActive : {}) }}
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
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '20px 18px',
    border: '2px solid',
    borderRadius: 8,
    minWidth: 280,
    minHeight: 300,
  },
  title:  { fontSize: 14, fontWeight: 'bold', letterSpacing: 3 },
  typeRow: { display: 'flex', gap: 6 },
  typeBtn: {
    flex: 1,
    padding: '5px 0',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 4,
    background: 'transparent',
    color: TEXT_SECONDARY,
    fontSize: 11,
    cursor: 'pointer',
  },
  typeBtnActive: {
    border: `1px solid ${ACCENT_BLUE}`,
    background: '#1f3a5f',
    color: ACCENT_BLUE,
  },
  uploadSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  resetBtn: {
    padding: '3px 10px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 3,
    background: 'transparent',
    color: TEXT_DIM,
    fontSize: 10,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  tcpInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  portLabel: { fontSize: 11, color: TEXT_DIM },
  portValue: { fontSize: 14, fontFamily: 'monospace' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
  badge: {
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    color: '#fff',
    letterSpacing: 1,
  },
  playerName: { fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace' },
  errorText:  { fontSize: 11, color: '#c43a3a', cursor: 'help' },
  ipSmall:    { fontSize: 10, color: TEXT_DIM, fontFamily: 'monospace' },
};
