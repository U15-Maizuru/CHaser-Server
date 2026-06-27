import { BG_PANEL, BORDER_COLOR, TEXT_SECONDARY } from '../styles/tokens';

interface Props {
  allReady:     boolean;
  onStart:      () => void;
  onLoadMap:    () => void;
  onOpenEditor: () => void;
}

export function SetupFooter({ allReady, onStart, onLoadMap, onOpenEditor }: Props) {
  return (
    <div style={s.footer}>
      <div style={s.mapControls}>
        <span style={s.mapLabel}>マップ</span>
        <button style={s.btnSecondary} onClick={onLoadMap}>アップロード...</button>
        <button style={s.btnSecondary} onClick={onOpenEditor}>エディタ...</button>
      </div>

      <div style={s.startArea}>
        <button
          style={{ ...s.btnStart, opacity: allReady ? 1 : 0.4 }}
          disabled={!allReady}
          onClick={onStart}
        >
          ゲームスタート
        </button>
        {!allReady && (
          <span style={s.hint}>両チームが「準備完了」になるとスタートできます</span>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    padding: '12px 24px',
    background: BG_PANEL,
    borderTop: `1px solid ${BORDER_COLOR}`,
    flexWrap: 'wrap',
  },
  mapControls: { display: 'flex', alignItems: 'center', gap: 8 },
  mapLabel:    { fontSize: 11, color: TEXT_SECONDARY, letterSpacing: 1, marginRight: 4 },
  btnSecondary: {
    padding: '6px 14px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 4,
    background: 'transparent',
    color: '#ccc',
    fontSize: 12,
    cursor: 'pointer',
  },
  startArea: { display: 'flex', alignItems: 'center', gap: 12 },
  btnStart: {
    padding: '10px 40px',
    border: 'none',
    borderRadius: 8,
    background: '#238636',
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer',
    letterSpacing: 1,
  },
  hint: { fontSize: 11, color: '#555' },
};
