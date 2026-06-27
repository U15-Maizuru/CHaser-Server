import { useState } from 'react';
import type { ClientStatusPayload, ClientType, ServerStatusPayload } from '../types/ws-types';

interface ProcessConfig {
  programType: 'python' | 'bot';
  programPath: string;
  runtimeCommand: string;
}

interface Props {
  status:        ServerStatusPayload;
  onSetClient:   (slot: 0 | 1, type: ClientType, cfg?: ProcessConfig) => void;
  onStart:       () => void;
  onLoadMap:     () => void;
  onOpenEditor:  () => void;
  onOpenSettings:() => void;
}

const TEAM_LABEL = ['COOL', 'HOT'] as const;
const TEAM_COLOR = ['#3a82c4', '#c43a3a'] as const;

export function StartupDialog({ status, onSetClient, onStart, onLoadMap, onOpenEditor, onOpenSettings }: Props) {
  const allReady = status.clients.every(c => c.state === 'ready');

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.title}>U15 Server Maizuru</span>
        <span style={s.subtitle}>セットアップ</span>
        <button style={s.settingsBtn} onClick={onOpenSettings} title="設定">⚙</button>
      </div>

      <div style={s.body}>
        {/* IP 表示 */}
        <div style={s.ipBox}>
          <span style={s.ipLabel}>ローカル IP</span>
          <span style={s.ipValue}>{status.localIP}</span>
        </div>

        {/* クライアント設定 */}
        <div style={s.clients}>
          {([0, 1] as const).map((slot) => (
            <ClientPanel
              key={slot}
              slot={slot}
              label={TEAM_LABEL[slot]}
              color={TEAM_COLOR[slot]}
              info={status.clients[slot]}
              onSetType={(type, cfg) => onSetClient(slot, type, cfg)}
            />
          ))}
        </div>

        {/* マップ */}
        <div style={s.mapRow}>
          <span style={s.mapLabel}>マップ</span>
          <button style={s.btnSecondary} onClick={onLoadMap}>ファイルを開く...</button>
          <button style={s.btnSecondary} onClick={onOpenEditor}>エディタ...</button>
        </div>

        {/* スタートボタン */}
        <button
          style={{ ...s.btnStart, opacity: allReady ? 1 : 0.4 }}
          disabled={!allReady}
          onClick={onStart}
        >
          ゲームスタート
        </button>
        {!allReady && (
          <p style={s.hint}>両チームが「準備完了」になるとスタートできます</p>
        )}
      </div>
    </div>
  );
}

// ── ClientPanel ───────────────────────────────────────────────────────────────

interface PanelProps {
  slot:      0 | 1;
  label:     string;
  color:     string;
  info:      ClientStatusPayload;
  onSetType: (type: ClientType, cfg?: ProcessConfig) => void;
}

function ClientPanel({ label, color, info, onSetType }: PanelProps) {
  const [progType, setProgType]    = useState<'python' | 'bot'>('python');
  const [progPath, setProgPath]    = useState('');
  const [runtime,  setRuntime]     = useState('python');

  const stateText  = STATE_LABEL[info.state];
  const stateColor = info.state === 'ready'     ? '#2d6a4f'
                   : info.state === 'connected' ? '#5a8a3a'
                   : '#555';

  const handleSelectProgram = async () => {
    const path = await window.electronAPI?.openProgramFile?.();
    if (!path) return;
    setProgPath(path);
    const isPy = path.endsWith('.py');
    const newType: 'python' | 'bot' = isPy ? 'python' : 'bot';
    setProgType(newType);
    if (isPy && runtime === 'python') setRuntime('python');
    onSetType('process', { programType: newType, programPath: path, runtimeCommand: runtime });
  };

  const handleTypeChange = (type: ClientType) => {
    if (type === 'process') {
      onSetType('process', progPath ? { programType: progType, programPath: progPath, runtimeCommand: runtime } : undefined);
    } else {
      onSetType(type);
    }
  };

  return (
    <div style={{ ...s.panel, borderColor: color }}>
      <div style={{ ...s.panelTitle, color }}>{label}</div>

      {/* TCP / CPU / プログラム toggle */}
      <div style={s.typeRow}>
        <TypeButton active={info.type === 'tcp'}     onClick={() => handleTypeChange('tcp')}>TCP接続</TypeButton>
        <TypeButton active={info.type === 'cpu'}     onClick={() => handleTypeChange('cpu')}>CPU</TypeButton>
        <TypeButton active={info.type === 'process'} onClick={() => handleTypeChange('process')}>プログラム</TypeButton>
      </div>

      {/* プログラム選択 UI */}
      {info.type === 'process' && (
        <div style={s.progSection}>
          <div style={s.progRow}>
            <input
              style={s.progInput}
              value={progPath}
              readOnly
              placeholder="プログラムファイルを選択..."
            />
            <button style={s.btnTiny} onClick={handleSelectProgram}>参照</button>
          </div>
          <div style={s.progRow}>
            <span style={s.progLabel}>実行コマンド</span>
            <input
              style={{ ...s.progInput, flex: 1 }}
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              placeholder="python / python3 / Bot.exe"
            />
          </div>
        </div>
      )}

      {/* Status */}
      <div style={s.statusRow}>
        <span style={{ ...s.stateBadge, background: stateColor }}>{stateText}</span>
        {info.state !== 'waiting' && (
          <span style={s.nameText}>{info.name || '—'}</span>
        )}
      </div>

      {info.type === 'tcp' && (
        <div style={s.portRow}>
          <span style={s.portLabel}>ポート</span>
          <span style={s.portValue}>{info.port}</span>
        </div>
      )}
      {info.ip && <div style={s.ipSmall}>{info.ip}</div>}
    </div>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button style={{ ...s.typeBtn, ...(active ? s.typeBtnActive : {}) }} onClick={onClick}>
      {children}
    </button>
  );
}

const STATE_LABEL: Record<string, string> = {
  waiting:   'TCP 接続待ち',
  connected: '接続中...',
  ready:     '準備完了',
};

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: '#0d1117', color: '#eee', fontFamily: 'monospace',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 20px', background: '#161b22', borderBottom: '1px solid #30363d',
  },
  title:    { fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
  subtitle: { fontSize: 12, color: '#888', letterSpacing: 2 },
  settingsBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: '#888', fontSize: 18, cursor: 'pointer', padding: '0 4px',
  },
  body: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24,
  },
  ipBox: {
    display: 'flex', gap: 12, alignItems: 'center',
    padding: '8px 20px', background: '#161b22',
    borderRadius: 6, border: '1px solid #30363d',
  },
  ipLabel: { fontSize: 11, color: '#888', letterSpacing: 1 },
  ipValue: { fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace', letterSpacing: 2 },
  clients: { display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' },
  panel: {
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '16px 20px', border: '2px solid', borderRadius: 8,
    background: '#161b22', minWidth: 240,
  },
  panelTitle: { fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
  typeRow:    { display: 'flex', gap: 6 },
  typeBtn: {
    flex: 1, padding: '5px 0', border: '1px solid #444', borderRadius: 4,
    background: 'transparent', color: '#888', fontSize: 11, cursor: 'pointer',
  },
  typeBtnActive: { border: '1px solid #58a6ff', background: '#1f3a5f', color: '#58a6ff' },
  progSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  progRow:     { display: 'flex', alignItems: 'center', gap: 6 },
  progLabel:   { fontSize: 10, color: '#666', whiteSpace: 'nowrap' },
  progInput: {
    flex: 1, padding: '3px 6px', background: '#0d1117',
    border: '1px solid #333', borderRadius: 3, color: '#ccc',
    fontSize: 11, fontFamily: 'monospace',
  },
  btnTiny: {
    padding: '3px 8px', border: '1px solid #444', borderRadius: 3,
    background: 'transparent', color: '#aaa', fontSize: 11, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
  stateBadge: {
    fontSize: 10, padding: '2px 7px', borderRadius: 4, color: '#fff', letterSpacing: 1,
  },
  nameText: { fontSize: 13, fontWeight: 'bold' },
  portRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  portLabel: { fontSize: 11, color: '#666' },
  portValue: { fontSize: 14, fontFamily: 'monospace' },
  ipSmall:   { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  mapRow:  { display: 'flex', gap: 10, alignItems: 'center' },
  mapLabel: { fontSize: 12, color: '#888', letterSpacing: 1, marginRight: 4 },
  btnSecondary: {
    padding: '6px 14px', border: '1px solid #444', borderRadius: 4,
    background: 'transparent', color: '#ccc', fontSize: 12, cursor: 'pointer',
  },
  btnStart: {
    padding: '12px 48px', border: 'none', borderRadius: 8,
    background: '#238636', color: '#fff', fontSize: 16,
    fontWeight: 'bold', cursor: 'pointer', letterSpacing: 1,
  },
  hint: { fontSize: 11, color: '#555', margin: 0 },
};
