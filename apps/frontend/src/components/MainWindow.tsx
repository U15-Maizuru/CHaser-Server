import type {
  GameEndPayload, GameStateSnapshot, TurnStartPayload,
  ServerPhase, ServerStatusPayload,
} from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { GameBoardCanvas } from './GameBoardCanvas';
import { PlayerSidePanel } from './PlayerSidePanel';
import { ManualControls } from './ManualControls';

/**
 * 対戦中メイン画面
 * 参照: U15-server-maizuru mainwindow.ui
 *
 * レイアウト:
 *   [上部バー: HOT得点 | 残りターン | COOL得点]
 *   [左パネル(COOL)] | [ボード] | [右パネル(HOT)]
 *   [下部バー: 結果 | 残りアイテム | ラベル]
 */
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

// 上部スコアピルの色
const HOT_COLOR  = '#EE2266';
const COOL_COLOR = '#2266EE';
const TURN_COLOR = '#444444';

// ゲーム結果の色マッピング
function resultStyle(gameEnd: GameEndPayload | null) {
  if (!gameEnd) return { background: '#888', text: '---' };
  switch (gameEnd.winner) {
    case Winner.COOL: return { background: COOL_COLOR, text: `${gameEnd.playerNames[0]} WIN!` };
    case Winner.HOT:  return { background: HOT_COLOR,  text: `${gameEnd.playerNames[1]} WIN!` };
    case Winner.DRAW: return { background: '#228B22',   text: 'DRAW' };
    default:          return { background: '#888',      text: '---' };
  }
}

export function MainWindow({
  snapshot, turnInfo, gameEnd, serverStatus, isConnected, phase,
  theme = 'Jewel', manualRequest,
  onReset, onNextRound, onManualAction, onOpenSettings,
}: Props) {
  const hasManualSlot = serverStatus?.clients.some(c => c.type === 'manual') ?? false;

  const hotScore  = snapshot?.teamScore[1]   ?? 0;
  const coolScore = snapshot?.teamScore[0]   ?? 0;
  const turnCount = snapshot?.turnCount      ?? 0;
  const leaveItems = snapshot?.leaveItems    ?? 0;
  const names     = snapshot?.playerNames    ?? ['COOL', 'HOT'];

  const resStyle = resultStyle(gameEnd);
  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const roundResults = serverStatus?.roundResults ?? [];

  // 次戦スタート: 2試合制かつ1試合目終了後
  const showNextRound = phase === 'finished' && doubleMode && roundResults.length === 1;
  const showReset     = phase === 'finished' && (!doubleMode || roundResults.length >= 2);

  return (
    <div style={s.root}>
      {/* ── ヘッダーバー ────────────────────────────────────────── */}
      <div style={s.headerBar}>
        <button style={s.settingsBtn} onClick={onOpenSettings} title="設定">⚙</button>
        <span style={{ ...s.badge, background: isConnected ? '#2d6a4f' : '#7b2d2d' }}>
          {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <span style={s.title}>U15 Server Maizuru</span>
      </div>

      {/* ── 上部スコアバー ──────────────────────────────────────── */}
      {snapshot && (
        <div style={s.topBar}>
          {/* HOT名 */}
          <span style={{ ...s.namePill, background: HOT_COLOR }}>{names[1]}</span>
          {/* スコアピル: HOT | ターン | COOL */}
          <div style={s.scorePills}>
            <span style={{ ...s.scorePill, background: HOT_COLOR }}>{hotScore}</span>
            <span style={{ ...s.scorePill, background: TURN_COLOR }}>
              {turnInfo ? turnCount : turnCount}
            </span>
            <span style={{ ...s.scorePill, background: COOL_COLOR }}>{coolScore}</span>
          </div>
          {/* COOL名 */}
          <span style={{ ...s.namePill, background: COOL_COLOR }}>{names[0]}</span>
        </div>
      )}

      {/* ── メイン3カラム ──────────────────────────────────────── */}
      <div style={s.main}>
        {snapshot ? (
          <>
            {/* 左パネル (COOL視点) */}
            <PlayerSidePanel side={0} snapshot={snapshot} serverStatus={serverStatus} />

            {/* 中央ボード */}
            <div style={s.center}>
              <div style={s.boardWrap}>
                <GameBoardCanvas snapshot={snapshot} theme={theme} />
              </div>
              {phase === 'playing' && hasManualSlot && (
                <ManualControls
                  serverStatus={serverStatus}
                  manualRequest={manualRequest}
                  onAction={onManualAction}
                />
              )}
            </div>

            {/* 右パネル (HOT視点) */}
            <PlayerSidePanel side={1} snapshot={snapshot} serverStatus={serverStatus} />
          </>
        ) : (
          <div style={s.waiting}>
            {isConnected ? 'ゲーム開始を待っています...' : 'バックエンドに接続中...'}
          </div>
        )}
      </div>

      {/* ── 下部結果バー ────────────────────────────────────────── */}
      {snapshot && (
        <div style={s.bottomBar}>
          {/* 結果ピル */}
          <span style={{ ...s.resultPill, background: resStyle.background }}>
            {gameEnd ? resStyle.text : (turnInfo ? `行動中: ${turnInfo.player === 0 ? 'COOL' : 'HOT'}` : '...')}
          </span>

          {/* 残りアイテム */}
          <span style={s.itemsCenter}>{leaveItems}</span>

          {/* ラベル / ボタン */}
          {showNextRound ? (
            <button style={s.nextBtn} onClick={onNextRound}>次戦スタート</button>
          ) : showReset ? (
            <button style={s.resetBtn} onClick={onReset}>セットアップに戻る</button>
          ) : (
            <span style={{ ...s.resultPill, background: HOT_COLOR }}>アイテム数</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: '#f0f0d8',   // クリーム背景 (参照デザインに合わせる)
    color: '#111', fontFamily: 'monospace',
  },

  // ヘッダーバー
  headerBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 12px',
    background: '#e0e0c8', borderBottom: '1px solid #c8c8a0',
    flexShrink: 0,
  },
  title:       { fontSize: 13, fontWeight: 'bold', letterSpacing: 1, color: '#333', marginLeft: 'auto' },
  settingsBtn: { background: 'none', border: 'none', color: '#555', fontSize: 18, cursor: 'pointer', padding: '0 4px' },
  badge:       { fontSize: 10, padding: '2px 8px', borderRadius: 4, letterSpacing: 1, color: '#fff' },

  // 上部スコアバー
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 20, padding: '6px 16px',
    background: '#e8e8c8', borderBottom: '1px solid #c8c8a0',
    flexShrink: 0,
  },
  namePill: {
    color: '#fff', fontWeight: 'bold', fontSize: 13,
    padding: '4px 20px', borderRadius: 20, letterSpacing: 1,
  },
  scorePills: { display: 'flex', gap: 6, alignItems: 'center' },
  scorePill: {
    color: '#fff', fontWeight: 'bold', fontSize: 18,
    padding: '4px 18px', borderRadius: 20, minWidth: 60, textAlign: 'center',
  },

  // メイン3カラム
  main: {
    flex: 1, display: 'flex', alignItems: 'flex-start',
    justifyContent: 'center', gap: 12, padding: '10px 12px',
    overflow: 'auto',
  },
  center: {
    display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
  },
  boardWrap: {
    border: '3px solid #888880', borderRadius: 4, overflow: 'hidden',
    boxShadow: '2px 2px 6px rgba(0,0,0,0.2)',
  },

  // 下部結果バー
  bottomBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, padding: '6px 16px',
    background: '#e0e0c8', borderTop: '1px solid #c8c8a0',
    flexShrink: 0,
  },
  resultPill: {
    flex: 1, textAlign: 'center',
    color: '#fff', fontWeight: 'bold', fontSize: 14,
    padding: '6px 0', borderRadius: 20, letterSpacing: 1,
  },
  itemsCenter: {
    fontSize: 20, fontWeight: 'bold',
    padding: '3px 20px', border: '2px solid #888', borderRadius: 20,
    background: '#fff', textAlign: 'center', minWidth: 60,
  },
  nextBtn: {
    flex: 1, padding: '6px 0', border: 'none', borderRadius: 20,
    background: '#1f6feb', color: '#fff', fontSize: 14,
    fontWeight: 'bold', cursor: 'pointer', textAlign: 'center',
  },
  resetBtn: {
    flex: 1, padding: '6px 0', border: 'none', borderRadius: 20,
    background: '#888', color: '#fff', fontSize: 13,
    cursor: 'pointer', textAlign: 'center',
  },

  waiting: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, fontSize: 18, color: '#555',
  },
};
