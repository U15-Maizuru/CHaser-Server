import type { ServerStatusPayload } from '@u15/ws-types';
import { BG_CARD, BORDER_COLOR, TEXT_SECONDARY, TEXT_MUTED, WIN_BASE, SHADOW_SM } from '../styles/tokens';

interface Props {
  isConnected:          boolean;
  status:               ServerStatusPayload;
  onStart:              () => void;
  onNextRound:          () => void;
  onRepeat:             () => void;
  onReset:              () => void;
  onOpenMapLibrary:  () => void;
  onOpenProgramLibrary: () => void;
  onOpenSettings:       () => void;
  onToggleFullscreen?:  () => void;  // Electron ローカル起動時のみ
}

// コントロール画面下部に常駐する操作バー (フェーズ問わず常時マウント)。
//
// 3つのクラスタで役割を分ける:
//   左   = 対戦の「準備」   — マップ/プログラムの用意。準備が意味を持つ間だけ表示する
//   中央 = 「次の一手」     — 状況に応じて常に1つだけ排他的に表示する
//   右   = 常時使えるもの   — 表示設定・全画面・リセット・接続状態
//
// リセットを右クラスタに常設しているのは、これが唯一フェーズゲートの無いコマンド
// (ServerManager.requestReset) であり、リピートモードの再戦ループ・デモモードの
// 自動進行・進行中の対戦から抜け出す唯一の出口になっているため。
export function BottomBar({
  isConnected, status,
  onStart, onNextRound, onRepeat, onReset,
  onOpenMapLibrary, onOpenProgramLibrary, onOpenSettings, onToggleFullscreen,
}: Props) {
  const allReady = status.clients.every(c => c.state === 'ready');
  const { phase, doubleMode, repeatMode, roundResults } = status;

  const showStart      = phase === 'setup';
  const showNextRound  = phase === 'finished' && doubleMode && roundResults.length === 1;
  const matchFinished  = phase === 'finished' && (!doubleMode || roundResults.length >= 2);
  const showRepeat     = matchFinished && repeatMode;

  // 対戦が完全に終わっていてリピートもしない場合、「セットアップに戻る」こそが次の一手なので
  // 中央に主ボタンとして出す。その場合は右クラスタのリセットを重複表示しない。
  const showResetAsPrimary   = matchFinished && !repeatMode;
  const showResetAsSecondary = !showResetAsPrimary;

  const handleSecondaryReset = () => {
    const message = phase === 'playing'
      ? '対戦を中断してセットアップに戻ります。よろしいですか？'
      : '対戦の設定をリセットしてセットアップに戻ります。よろしいですか？';
    // 進行中、または途中結果がある (2ゲーム制の試合放棄) 場合のみ確認する
    if (phase === 'playing' || roundResults.length > 0) {
      if (!window.confirm(message)) return;
    }
    onReset();
  };

  return (
    <div style={s.footer}>
      {/* 左: ライブラリの管理 (アップロード・削除)。対戦で使うマップ・プログラムの
          「選択」はセットアップ画面側にあるので、ここは setup 中なら常に開ける */}
      <div style={s.leftCluster}>
        {phase === 'setup' && (
          <button style={s.btnSecondary} onClick={onOpenMapLibrary}>マップ管理...</button>
        )}
        {phase === 'setup' && (
          <button style={s.btnSecondary} onClick={onOpenProgramLibrary}>プログラム管理...</button>
        )}
      </div>

      {/* 中央: 次の一手 */}
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
          <button style={s.btnStart} onClick={onNextRound}>第2ゲームへ ▶</button>
        )}
        {showRepeat && (
          <button style={s.btnStart} onClick={onRepeat}>もう一度対戦 ▶</button>
        )}
        {showResetAsPrimary && (
          <button style={s.btnReset} onClick={onReset}>セットアップに戻る</button>
        )}
      </div>

      {/* 右: フェーズに関係なく常に使えるもの */}
      <div style={s.rightCluster}>
        <button style={s.btnSecondary} onClick={onOpenSettings}>設定</button>
        {onToggleFullscreen && (
          <button style={s.btnIcon} title="観戦画面を全画面化" onClick={onToggleFullscreen}>⛶</button>
        )}
        {showResetAsSecondary && (
          <button
            style={s.btnSecondary}
            title="対戦をリセットしてセットアップに戻る"
            onClick={handleSecondaryReset}
          >
            {phase === 'playing' ? '中断' : 'リセット'}
          </button>
        )}
        <span style={{ ...s.badge, background: isConnected ? '#33aa77' : '#cc4455' }}>
          {isConnected ? '● CONNECTED' : '○ DISCONNECTED'}
        </span>
      </div>
    </div>
  );
}

// フッター内のボタン/バッジの高さ (border-box で統一し、縦の見た目をそろえる)
const BAR_ITEM_H = 36;

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
  // 左右のクラスタに flex:1 を与えることで、中央の「次の一手」が常に画面中央に来る
  leftCluster:  { flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' },
  rightCluster: { flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  btnSecondary: {
    height: BAR_ITEM_H,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 14px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_SECONDARY,
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnIcon: {
    height: BAR_ITEM_H,
    width: BAR_ITEM_H,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_SECONDARY,
    fontSize: 14,
    cursor: 'pointer',
    flexShrink: 0,
  },
  startArea: { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  btnStart: {
    height: BAR_ITEM_H,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 40px',
    border: 'none',
    borderRadius: 99,
    background: WIN_BASE,
    color: '#fff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    letterSpacing: 1,
    boxShadow: SHADOW_SM,
    whiteSpace: 'nowrap',
  },
  btnReset: {
    height: BAR_ITEM_H,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 40px',
    borderRadius: 99,
    border: `1px solid ${BORDER_COLOR}`,
    background: 'transparent',
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 1,
    whiteSpace: 'nowrap',
  },
  hint: { fontSize: 11, color: TEXT_MUTED },
  badge: {
    height: BAR_ITEM_H,
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'clamp(0.5rem, 0.85vw, 0.85rem)',
    padding: '0 10px', borderRadius: 99,
    letterSpacing: 1, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
    flexShrink: 0,
  },
};
