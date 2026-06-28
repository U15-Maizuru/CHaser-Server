import { useLayoutEffect, useRef, useState } from 'react';
import type {
  GameEndPayload, GameStateSnapshot, TurnStartPayload,
  ServerPhase, ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { GameBoardCanvas } from './GameBoardCanvas';
import { PlayerSidePanel } from './PlayerSidePanel';
import { ManualControls } from './ManualControls';
import {
  BG_ROOT, BG_CARD, BG_HEADER,
  COOL_COLOR, COOL_LIGHT, COOL_DARK, COOL_PALE,
  HOT_COLOR,  HOT_LIGHT,  HOT_DARK,  HOT_PALE,
  TURN_BASE,  TURN_LIGHT,
  WIN_BASE,   WIN_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  SHADOW_SM, SHADOW_MD, BORDER_COLOR,
  RADIUS_SM, RADIUS_LG,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  snapshot:        GameStateSnapshot   | null;
  turnInfo:        TurnStartPayload    | null;
  gameEnd:         GameEndPayload      | null;
  serverStatus:    ServerStatusPayload | null;
  isConnected:     boolean;
  phase:           ServerPhase;
  theme?:          string;
  manualRequest:   { slot: 0 | 1; aroundData: number[] } | null;
  onReset:         () => void;
  onNextRound:     () => void;
  onManualAction:  (slot: 0 | 1, action: number, rote: number) => void;
  onOpenSettings:  () => void;
}

function resultPillStyle(gameEnd: GameEndPayload | null): { bg: string; text: string } {
  if (!gameEnd) return { bg: TURN_LIGHT, text: '---' };
  switch (gameEnd.winner) {
    case Winner.COOL: return { bg: COOL_LIGHT, text: `⭐ ${gameEnd.playerNames[0]} の勝ち！` };
    case Winner.HOT:  return { bg: HOT_LIGHT,  text: `⭐ ${gameEnd.playerNames[1]} の勝ち！` };
    case Winner.DRAW: return { bg: WIN_PALE,   text: '🤝 引き分け' };
    default:          return { bg: TURN_LIGHT, text: '---' };
  }
}

export function MainWindow({
  snapshot, turnInfo, gameEnd, serverStatus, isConnected, phase,
  theme = 'Jewel', manualRequest,
  onReset, onNextRound, onManualAction, onOpenSettings,
}: Props) {
  const hasManualSlot = serverStatus?.clients.some(c => c.type === 'manual') ?? false;

  const hotScore   = snapshot?.teamScore[1]  ?? 0;
  const coolScore  = snapshot?.teamScore[0]  ?? 0;
  const turnCount  = snapshot?.turnCount     ?? 0;
  const leaveItems = snapshot?.leaveItems    ?? 0;
  const names      = snapshot?.playerNames   ?? ['COOL', 'HOT'];

  const res         = resultPillStyle(gameEnd);
  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const roundResults = serverStatus?.roundResults ?? [];

  const showNextRound = phase === 'finished' && doubleMode && roundResults.length === 1;
  const showReset     = phase === 'finished' && (!doubleMode || roundResults.length >= 2);

  const actingText = turnInfo
    ? (turnInfo.player === 0 ? `🔵 ${names[0]} の番` : `🔴 ${names[1]} の番`)
    : '...';
  const actingBg = turnInfo
    ? (turnInfo.player === 0 ? COOL_PALE : HOT_PALE)
    : TURN_LIGHT;

  // ── ResizeObserver でメインエリアのサイズからセルサイズを計算 ──────────
  const mainRef   = useRef<HTMLDivElement>(null);
  const probeRef  = useRef<HTMLDivElement>(null);   // ボード配置列の実サイズを計測
  const [cellSize, setCellSize] = useState(28);

  useLayoutEffect(() => {
    if (!probeRef.current || !snapshot) return;
    const mapW = snapshot.size.x;
    const mapH = snapshot.size.y;

    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      // probe はボード列を占める div なのでそのままセルサイズを計算
      const byW = Math.floor(width  / mapW);
      const byH = Math.floor(height / mapH);
      setCellSize(Math.max(10, Math.min(byW, byH, 60)));
    });

    obs.observe(probeRef.current);
    return () => obs.disconnect();
  }, [snapshot?.size.x, snapshot?.size.y]);

  return (
    <div style={s.root}>
      {/* ── ヘッダーバー ──────────────────────────────────────── */}
      <div style={s.headerBar}>
        <button style={s.settingsBtn} onClick={onOpenSettings} title="設定">⚙</button>
        <span style={s.title}>U15 Server Maizuru</span>
        <span style={{ ...s.badge, background: isConnected ? '#33aa77' : '#cc4455' }}>
          {isConnected ? '● CONNECTED' : '○ DISCONNECTED'}
        </span>
      </div>

      {/* ── スコアバー ─────────────────────────────────────────── */}
      {snapshot && (
        <div style={s.scorePad}>
          <div style={s.scoreCard}>
            <span style={{ ...s.namePill, background: HOT_LIGHT, color: HOT_DARK }}>
              🔴 {names[1]}
            </span>
            <span style={{ ...s.scoreNum, color: HOT_COLOR }}>{hotScore}</span>
            <span style={s.scoreDivider} />
            <span style={s.turnPill}>残 {turnCount}T</span>
            <span style={s.scoreDivider} />
            <span style={{ ...s.scoreNum, color: COOL_COLOR }}>{coolScore}</span>
            <span style={{ ...s.namePill, background: COOL_LIGHT, color: COOL_DARK }}>
              🔵 {names[0]}
            </span>
          </div>
        </div>
      )}

      {/* ── メイン3カラム ─────────────────────────────────────── */}
      <div ref={mainRef} style={s.main}>
        {snapshot ? (
          <>
            <PlayerSidePanel side={0} snapshot={snapshot} serverStatus={serverStatus} />

            {/* 中央列: probe div で実サイズを計測し board を中央に置く */}
            <div ref={probeRef} style={s.centerProbe}>
              <div style={s.center}>
                <div style={s.boardWrap}>
                  <GameBoardCanvas snapshot={snapshot} theme={theme} cellSize={cellSize} />
                </div>
                {phase === 'playing' && hasManualSlot && (
                  <ManualControls
                    serverStatus={serverStatus}
                    manualRequest={manualRequest}
                    onAction={onManualAction}
                  />
                )}
              </div>
            </div>

            <PlayerSidePanel side={1} snapshot={snapshot} serverStatus={serverStatus} />
          </>
        ) : (
          <div style={s.waiting}>
            {isConnected ? 'ゲーム開始を待っています...' : 'バックエンドに接続中...'}
          </div>
        )}
      </div>

      {/* ── ボトムバー ─────────────────────────────────────────── */}
      {snapshot && (
        <div style={s.bottomPad}>
          <div style={s.bottomCard}>
            <span style={{
              ...s.resultPill,
              background: gameEnd ? res.bg : actingBg,
              color: gameEnd ? TEXT_PRIMARY : TEXT_SECONDARY,
            }}>
              {gameEnd ? res.text : actingText}
            </span>
            <span style={s.itemsBadge}>🎯 残り {leaveItems} 個</span>
            {showNextRound ? (
              <button style={s.nextBtn} onClick={onNextRound}>次戦スタート ▶</button>
            ) : showReset ? (
              <button style={s.resetBtn} onClick={onReset}>セットアップに戻る</button>
            ) : (
              <span style={{ visibility: 'hidden', ...s.itemsBadge }}>-</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── スタイル ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden',
    background: BG_ROOT, color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },

  // ヘッダーバー
  headerBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '0.4vh 14px', background: BG_HEADER, flexShrink: 0,
    borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  title: {
    flex: 1, textAlign: 'center',
    fontSize: 'clamp(0.65rem, 1.1vw, 1rem)',
    fontWeight: 700, letterSpacing: '0.06em', color: TEXT_SECONDARY,
  },
  settingsBtn: {
    background: 'none', border: 'none', color: TEXT_MUTED,
    fontSize: 'clamp(14px, 1.4vw, 22px)', cursor: 'pointer', padding: '0 4px',
  },
  badge: {
    fontSize: 'clamp(0.5rem, 0.85vw, 0.85rem)',
    padding: '2px 10px', borderRadius: 99,
    letterSpacing: 1, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
  },

  // スコアバー
  scorePad: {
    padding: '0.5vh 14px 0', flexShrink: 0,
  },
  scoreCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 'clamp(6px, 1.5vw, 20px)',
    padding: '0.6vh clamp(10px, 2vw, 28px)',
    background: BG_CARD, borderRadius: RADIUS_LG, boxShadow: SHADOW_MD,
  },
  namePill: {
    fontWeight: 700, fontSize: 'clamp(0.55rem, 1vw, 1rem)',
    padding: 'clamp(3px, 0.5vh, 7px) clamp(8px, 1.4vw, 18px)',
    borderRadius: 99, letterSpacing: '0.04em', whiteSpace: 'nowrap',
  },
  scoreNum: {
    fontFamily: FONT_NUM, fontWeight: 800,
    fontSize: 'clamp(1.2rem, 3.2vw, 4rem)', lineHeight: 1,
  },
  scoreDivider: {
    width: 1, height: 'clamp(20px, 3vh, 36px)', background: BORDER_COLOR, flexShrink: 0,
  },
  turnPill: {
    background: TURN_LIGHT, color: TURN_BASE,
    fontWeight: 700, fontSize: 'clamp(0.55rem, 1vw, 1rem)',
    padding: 'clamp(3px, 0.5vh, 7px) clamp(8px, 1.4vw, 16px)', borderRadius: 99,
    whiteSpace: 'nowrap',
  },

  // メイン3カラム
  main: {
    flex: 1, display: 'flex', alignItems: 'stretch',
    gap: 12, padding: '0.8vh 12px',
    overflow: 'hidden', minHeight: 0,
  },
  // 中央のサイズプローブ: パネル間の残りスペースを全て取る
  centerProbe: {
    flex: 1, minWidth: 0, minHeight: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  center: {
    display: 'flex', flexDirection: 'column',
    gap: '0.8vh', flexShrink: 0, alignItems: 'center',
  },
  boardWrap: {
    borderRadius: RADIUS_SM, overflow: 'hidden', boxShadow: SHADOW_MD,
  },

  // ボトムバー
  bottomPad: {
    padding: '0 14px 0.6vh', flexShrink: 0,
  },
  bottomCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, padding: '0.6vh 16px',
    background: BG_CARD, borderRadius: RADIUS_LG, boxShadow: SHADOW_SM,
  },
  resultPill: {
    flex: 1, textAlign: 'center', fontWeight: 700,
    fontSize: 'clamp(0.6rem, 1.1vw, 1.1rem)',
    padding: 'clamp(4px, 0.7vh, 9px) 12px', borderRadius: 99, letterSpacing: '0.02em',
  },
  itemsBadge: {
    fontWeight: 600, fontSize: 'clamp(0.6rem, 1.1vw, 1.1rem)',
    padding: 'clamp(4px, 0.7vh, 9px) 14px',
    background: WIN_PALE, color: WIN_BASE,
    borderRadius: 99, whiteSpace: 'nowrap',
  },
  nextBtn: {
    padding: 'clamp(4px, 0.7vh, 9px) 18px', border: 'none', borderRadius: 99,
    background: WIN_BASE, color: '#fff',
    fontSize: 'clamp(0.6rem, 1.1vw, 1.1rem)',
    fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  resetBtn: {
    padding: 'clamp(4px, 0.7vh, 9px) 18px', borderRadius: 99,
    border: `1px solid ${BORDER_COLOR}`, background: 'transparent',
    color: TEXT_SECONDARY,
    fontSize: 'clamp(0.6rem, 1.1vw, 1.1rem)',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },

  waiting: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, fontSize: 'clamp(0.9rem, 1.8vw, 1.4rem)', color: TEXT_MUTED,
  },
};
