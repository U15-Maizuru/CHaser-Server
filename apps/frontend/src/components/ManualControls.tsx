import { useEffect, useState } from 'react';
import type { ServerStatusPayload } from '@u15/ws-types';
import { BORDER_COLOR, BG_PANEL, TEXT_SECONDARY, COOL_COLOR, HOT_COLOR } from '../styles/tokens';

// Action enum values (must match backend Action enum)
const ACTION_WALK   = 0;
const ACTION_LOOK   = 1;
const ACTION_SEARCH = 2;
const ACTION_PUT    = 3;

// Rote enum values (must match backend Rote enum)
const ROTE_UP    = 0;
const ROTE_DOWN  = 1;
const ROTE_RIGHT = 2;
const ROTE_LEFT  = 3;

interface Props {
  serverStatus:  ServerStatusPayload | null;
  manualRequest: { slot: 0 | 1; aroundData: number[] } | null;
  onAction:      (slot: 0 | 1, action: number, rote: number) => void;
}

export function ManualControls({ serverStatus, manualRequest, onAction }: Props) {
  const [selectedAction, setSelectedAction] = useState(ACTION_WALK);

  // manualSlot: どちらのスロットが manual か
  const manualSlots = (serverStatus?.clients ?? [])
    .map((c, i) => ({ slot: i as 0 | 1, type: c.type }))
    .filter(x => x.type === 'manual');

  const activeSlot = manualRequest?.slot ?? manualSlots[0]?.slot ?? 0;
  const isWaiting  = manualRequest !== null;

  const send = (rote: number) => {
    if (!isWaiting) return;
    onAction(activeSlot, selectedAction, rote);
  };

  // キーボードショートカット
  useEffect(() => {
    if (!isWaiting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')    { e.preventDefault(); send(ROTE_UP); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); send(ROTE_DOWN); }
      if (e.key === 'ArrowRight') { e.preventDefault(); send(ROTE_RIGHT); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); send(ROTE_LEFT); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isWaiting, selectedAction, activeSlot]);

  if (manualSlots.length === 0) return null;

  const teamColor = activeSlot === 0 ? COOL_COLOR : HOT_COLOR;
  const teamLabel = activeSlot === 0 ? 'COOL' : 'HOT';

  return (
    <div style={{ ...s.root, borderColor: teamColor }}>
      <div style={{ ...s.header, color: teamColor }}>
        手動操作 ({teamLabel})
        {isWaiting
          ? <span style={s.waitingBadge}>入力待ち</span>
          : <span style={s.idleBadge}>待機中</span>}
      </div>

      {/* アクション選択 */}
      <div style={s.row}>
        <span style={s.label}>アクション</span>
        <select
          style={s.select}
          value={selectedAction}
          onChange={e => setSelectedAction(Number(e.target.value))}
        >
          <option value={ACTION_WALK}>WALK (移動)</option>
          <option value={ACTION_LOOK}>LOOK (観察)</option>
          <option value={ACTION_SEARCH}>SEARCH (探索)</option>
          <option value={ACTION_PUT}>PUT (ブロック設置)</option>
        </select>
      </div>

      {/* 方向パッド */}
      <div style={s.dpad}>
        <div style={s.dpadRow}>
          <DPadBtn disabled={!isWaiting} onClick={() => send(ROTE_UP)}>↑</DPadBtn>
        </div>
        <div style={s.dpadRow}>
          <DPadBtn disabled={!isWaiting} onClick={() => send(ROTE_LEFT)}>←</DPadBtn>
          <DPadBtn disabled={!isWaiting} onClick={() => send(ROTE_DOWN)}>↓</DPadBtn>
          <DPadBtn disabled={!isWaiting} onClick={() => send(ROTE_RIGHT)}>→</DPadBtn>
        </div>
      </div>
      <div style={s.hint}>キーボード: ↑↓←→</div>
    </div>
  );
}

function DPadBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      style={{ ...s.dpadBtn, opacity: disabled ? 0.35 : 1 }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    background: BG_PANEL,
    border: '2px solid',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  waitingBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    background: '#2d6a4f',
    color: '#fff',
  },
  idleBadge: {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 3,
    background: '#444',
    color: '#aaa',
  },
  row:   { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 11, color: TEXT_SECONDARY, minWidth: 60 },
  select: {
    padding: '3px 6px',
    background: '#0d1117',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 4,
    color: '#eee',
    fontSize: 11,
    cursor: 'pointer',
  },
  dpad:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  dpadRow: { display: 'flex', gap: 4 },
  dpadBtn: {
    width: 40, height: 40,
    background: '#1a1f2b',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 6,
    color: '#eee',
    fontSize: 18,
    cursor: 'pointer',
    transition: 'opacity 0.1s',
  },
  hint: { fontSize: 10, color: '#555', textAlign: 'center' },
};
