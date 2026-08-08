import { useEffect, useState } from 'react';
import { Action, Rote } from '@u15/ws-types';
import {
  BG_CARD,
  COOL_COLOR, COOL_LIGHT, COOL_PALE, COOL_DARK,
  HOT_COLOR,  HOT_LIGHT,  HOT_PALE,  HOT_DARK,
  WIN_BASE, WIN_LIGHT,
  TEXT_SECONDARY, TEXT_MUTED, BORDER_COLOR,
  SHADOW_MD, RADIUS_SM, RADIUS_MD,
  FONT_UI,
} from '../ui';

interface Props {
  slot:          0 | 1;
  manualRequest: { slot: 0 | 1; aroundData: number[] } | null;
  onAction:      (slot: 0 | 1, action: number, rote: number) => void;
}

export function ManualControls({ slot, manualRequest, onAction }: Props) {
  const [selectedAction, setSelectedAction] = useState<Action>(Action.WALK);

  const isWaiting  = manualRequest?.slot === slot;

  const send = (rote: number) => {
    if (!isWaiting) return;
    onAction(slot, selectedAction, rote);
  };

  useEffect(() => {
    if (!isWaiting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')    { e.preventDefault(); send(Rote.UP); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); send(Rote.DOWN); }
      if (e.key === 'ArrowRight') { e.preventDefault(); send(Rote.RIGHT); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); send(Rote.LEFT); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWaiting, selectedAction, slot]);

  const base  = slot === 0 ? COOL_COLOR : HOT_COLOR;
  const light = slot === 0 ? COOL_LIGHT : HOT_LIGHT;
  const pale  = slot === 0 ? COOL_PALE  : HOT_PALE;
  const dark  = slot === 0 ? COOL_DARK  : HOT_DARK;
  const label = slot === 0 ? 'COOL' : 'HOT';

  return (
    <>
      {/* 手番のときにボタンを脈打たせる */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ ...s.card, borderColor: light }}>
        {/* ヘッダー */}
        <div style={{ ...s.header, background: `linear-gradient(135deg, ${base}, ${dark})` }}>
          <span style={s.icon}>🕹</span>
          <span style={s.headerText}>手動操作 — {label}</span>
          {isWaiting
            ? <span style={{ ...s.badge, background: WIN_LIGHT, color: WIN_BASE,
                animation: 'pulse 1.2s ease-in-out infinite' }}>入力待ち</span>
            : <span style={{ ...s.badge, background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}>待機中</span>
          }
        </div>

        {/* アクション選択 */}
        <div style={s.row}>
          <span style={s.label}>アクション</span>
          <select
            style={{ ...s.select, borderColor: BORDER_COLOR, background: pale }}
            value={selectedAction}
            onChange={e => setSelectedAction(Number(e.target.value))}
          >
            <option value={Action.WALK}>移動 (WALK)</option>
            <option value={Action.LOOK}>観察 (LOOK)</option>
            <option value={Action.SEARCH}>探索 (SEARCH)</option>
            <option value={Action.PUT}>設置 (PUT)</option>
          </select>
        </div>

        {/* 方向パッド */}
        <div style={s.dpad}>
          <div style={s.dpadRow}>
            <DPadBtn disabled={!isWaiting} color={base} light={light} onClick={() => send(Rote.UP)}>↑</DPadBtn>
          </div>
          <div style={s.dpadRow}>
            <DPadBtn disabled={!isWaiting} color={base} light={light} onClick={() => send(Rote.LEFT)}>←</DPadBtn>
            <DPadBtn disabled={!isWaiting} color={base} light={light} onClick={() => send(Rote.DOWN)}>↓</DPadBtn>
            <DPadBtn disabled={!isWaiting} color={base} light={light} onClick={() => send(Rote.RIGHT)}>→</DPadBtn>
          </div>
        </div>

        <div style={s.hint}>⌨ 矢印キーでも操作できます</div>
      </div>
    </>
  );
}

function DPadBtn({ disabled, onClick, color, light, children }: {
  disabled: boolean; onClick: () => void; color: string; light: string; children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      style={{
        ...s.dpadBtn,
        background: hover && !disabled ? color : light,
        color:      hover && !disabled ? '#fff' : color,
        opacity:    disabled ? 0.35 : 1,
        transform:  hover && !disabled ? 'scale(1.05)' : 'scale(1)',
      }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: BG_CARD, border: '2px solid', borderRadius: RADIUS_MD,
    overflow: 'hidden', boxShadow: SHADOW_MD,
    display: 'flex', flexDirection: 'column', gap: 0,
    userSelect: 'none', fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', color: '#fff',
  },
  icon:       { fontSize: 16 },
  headerText: { flex: 1, fontWeight: 700, fontSize: 12, letterSpacing: '0.06em' },
  badge: {
    fontSize: 10, padding: '2px 8px', borderRadius: 99,
    fontWeight: 600, letterSpacing: '0.04em',
  },
  row:   { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 0' },
  label: { fontSize: 11, color: TEXT_SECONDARY, minWidth: 56 },
  select: {
    flex: 1, padding: '5px 8px', border: '1px solid',
    borderRadius: RADIUS_SM, fontSize: 11, cursor: 'pointer',
    fontFamily: FONT_UI,
  },
  dpad:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 0 4px' },
  dpadRow: { display: 'flex', gap: 4 },
  dpadBtn: {
    width: 44, height: 44, border: 'none',
    borderRadius: RADIUS_SM, fontSize: 18, cursor: 'pointer',
    fontWeight: 700, transition: 'all 0.15s ease',
  },
  hint: {
    fontSize: 10, color: TEXT_MUTED, textAlign: 'center',
    padding: '0 0 12px', letterSpacing: '0.02em',
  },
};
