import type { ServerStatusPayload } from '@u15/ws-types';
import { BG_CARD, BORDER_COLOR, TEXT_SECONDARY, TEXT_MUTED, WIN_BASE, SHADOW_SM } from '../styles/tokens';

interface Props {
  isConnected:    boolean;
  status:         ServerStatusPayload;
  onStart:        () => void;
  onNextRound:    () => void;
  onRepeat:       () => void;
  onReset:        () => void;
  onOpenMapManagement: () => void;
  onOpenProgramLibrary: () => void;
  onOpenSettings: () => void;
}

// コントロール画面下部に常駐する操作バー (フェーズ問わず常時マウント)。
// スタート系ボタンは常に同じ枠 (startArea) の中で、状況に応じて1つだけ排他的に表示する。
export function BottomBar({
  isConnected, status,
  onStart, onNextRound, onRepeat, onReset,
  onOpenMapManagement, onOpenProgramLibrary, onOpenSettings,
}: Props) {
  const allReady = status.clients.every(c => c.state === 'ready');
  const { phase, doubleMode, repeatMode, roundResults } = status;

  const showStart      = phase === 'setup';
  const showNextRound  = phase === 'finished' && doubleMode && roundResults.length === 1;
  const matchFinished  = phase === 'finished' && (!doubleMode || roundResults.length >= 2);
  const showRepeat     = matchFinished && repeatMode;
  const showReset      = matchFinished && !repeatMode;

  return (
    <div style={s.footer}>
      <div style={s.mapControls}>
        {/* マップ変更は setup フェーズでのみ意味を持つため、それ以外は表示しない */}
        {phase === 'setup' && (
          <button style={s.btnSecondary} onClick={onOpenMapManagement}>マップ設定...</button>
        )}
        <button style={s.btnSecondary} onClick={onOpenProgramLibrary}>プログラム管理...</button>
        <button style={s.btnSecondary} onClick={onOpenSettings}>設定</button>
      </div>

      <div style={s.startArea}>
        {showStart && (
          <>
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
          </>
        )}
        {showNextRound && (
          <button style={s.btnStart} onClick={onNextRound}>次戦スタート ▶</button>
        )}
        {showRepeat && (
          <button style={s.btnStart} onClick={onRepeat}>もう一度対戦 ▶</button>
        )}
        {showReset && (
          <button style={s.btnReset} onClick={onReset}>セットアップに戻る</button>
        )}
      </div>

      <span style={{ ...s.badge, background: isConnected ? '#33aa77' : '#cc4455' }}>
        {isConnected ? '● CONNECTED' : '○ DISCONNECTED'}
      </span>
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
    background: BG_CARD,
    borderTop: `1px solid ${BORDER_COLOR}`,
    flexWrap: 'wrap',
  },
  mapControls: { display: 'flex', alignItems: 'center', gap: 8 },
  btnSecondary: {
    padding: '6px 14px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_SECONDARY,
    fontSize: 12,
    cursor: 'pointer',
  },
  startArea: { display: 'flex', alignItems: 'center', gap: 12 },
  btnStart: {
    padding: '10px 40px',
    border: 'none',
    borderRadius: 99,
    background: WIN_BASE,
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    letterSpacing: 1,
    boxShadow: SHADOW_SM,
  },
  btnReset: {
    padding: '10px 40px',
    borderRadius: 99,
    border: `1px solid ${BORDER_COLOR}`,
    background: 'transparent',
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 1,
  },
  hint: { fontSize: 11, color: TEXT_MUTED },
  badge: {
    fontSize: 'clamp(0.5rem, 0.85vw, 0.85rem)',
    padding: '2px 10px', borderRadius: 99,
    letterSpacing: 1, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
  },
};
