import type { ServerStatusPayload } from '@u15/ws-types';
import { confirmDialog } from '../lib/nativeDialog';
import {
  BG_CARD, BORDER_COLOR, RADIUS_PILL, TEXT_MUTED,
  Button, BUTTON_BAR_HEIGHT,
  WIN_BASE, DISCONNECTED_COLOR,
} from '../ui';

interface Props {
  isConnected:          boolean;
  status:               ServerStatusPayload;
  onStart:              () => void;
  onNextRound:          () => void;
  onRepeat:             () => void;
  onReset:              () => void;
  onOpenMapLibrary:     () => void;
  onOpenProgramLibrary: () => void;
  onOpenTournament:     () => void;
  onOpenSettings:       () => void;
  /** 大会運営中はバッジを出す */
  tournamentName?:      string | null;
  onToggleFullscreen?:  () => void;  // Electron ローカル起動時のみ
}

// コントロール画面下部に常駐する操作バー (フェーズ問わず常時マウント)。
//
// 3つのクラスタで役割を分ける:
//   左   = 対戦の「準備」   — マップ/プログラムの用意。準備が意味を持つ間だけ表示する
//   中央 = 「次の一手」     — 状況に応じて常に1つだけ排他的に表示する
//   右   = 常時使えるもの   — 大会運営・設定・全画面・リセット・接続状態
//
// リセットを右クラスタに常設しているのは、これが唯一フェーズゲートの無いコマンドであり、
// リピートモードの再戦ループ・デモモードの自動進行・進行中の対戦から抜け出す唯一の出口だから。
export function BottomBar({
  isConnected, status,
  onStart, onNextRound, onRepeat, onReset,
  onOpenMapLibrary, onOpenProgramLibrary, onOpenTournament,
  onOpenSettings, onToggleFullscreen, tournamentName,
}: Props) {
  const allReady = status.clients.every(c => c.state === 'ready');
  const { phase, doubleMode, repeatMode, roundResults } = status;

  const showStart     = phase === 'setup';
  const showNextRound = phase === 'finished' && doubleMode && roundResults.length === 1;
  const matchFinished = phase === 'finished' && (!doubleMode || roundResults.length >= 2);
  const showRepeat    = matchFinished && repeatMode;

  // 対戦が完全に終わっていてリピートもしない場合、「セットアップに戻る」こそが次の一手なので
  // 中央に主ボタンとして出す。その場合は右クラスタのリセットを重複表示しない。
  const resetIsPrimary = matchFinished && !repeatMode;

  const handleSecondaryReset = () => {
    const message = phase === 'playing'
      ? '対戦を中断してセットアップに戻ります。よろしいですか？'
      : '対戦の設定をリセットしてセットアップに戻ります。よろしいですか？';
    // 進行中、または途中結果がある (2ゲーム制の試合放棄) 場合のみ確認する
    if ((phase === 'playing' || roundResults.length > 0) && !confirmDialog(message)) return;
    onReset();
  };

  return (
    <div style={s.footer}>
      {/* 左: ライブラリの整理。対戦で使うものの「選択」はセットアップ画面側にある */}
      <div style={s.leftCluster}>
        {phase === 'setup' && (
          <>
            <Button onClick={onOpenMapLibrary}>マップ管理...</Button>
            <Button onClick={onOpenProgramLibrary}>プログラム管理...</Button>
          </>
        )}
      </div>

      {/* 中央: 次の一手 */}
      <div style={s.startArea}>
        {showStart && (
          <>
            <Button variant="primary" size="lg" disabled={!allReady} onClick={onStart}>
              ゲームスタート
            </Button>
            {!allReady && (
              <span style={s.hint}>両プレイヤーが「準備完了」になるとスタートできます</span>
            )}
          </>
        )}
        {showNextRound && (
          <Button variant="primary" size="lg" onClick={onNextRound}>第2ゲームへ ▶</Button>
        )}
        {showRepeat && (
          <Button variant="primary" size="lg" onClick={onRepeat}>もう一度対戦 ▶</Button>
        )}
        {resetIsPrimary && (
          <Button size="lg" onClick={onReset}>セットアップに戻る</Button>
        )}
      </div>

      {/* 右: フェーズに関係なく常に使えるもの */}
      <div style={s.rightCluster}>
        <Button
          onClick={onOpenTournament}
          title={tournamentName ? `運営中: ${tournamentName}` : '大会運営ウィンドウを開く'}
        >
          大会運営...{tournamentName ? ' ●' : ''}
        </Button>
        <Button onClick={onOpenSettings}>設定</Button>
        {onToggleFullscreen && (
          <Button
            variant="icon"
            title="観戦画面を全画面化 (解除は観戦画面で ESC / F11)"
            onClick={onToggleFullscreen}
          >⛶</Button>
        )}
        {!resetIsPrimary && (
          <Button title="対戦をリセットしてセットアップに戻る" onClick={handleSecondaryReset}>
            {phase === 'playing' ? '中断' : 'リセット'}
          </Button>
        )}
        <span style={{ ...s.badge, background: isConnected ? WIN_BASE : DISCONNECTED_COLOR }}>
          {isConnected ? '● CONNECTED' : '○ DISCONNECTED'}
        </span>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 20, padding: '12px 24px', flexWrap: 'wrap',
    background: BG_CARD, borderTop: `1px solid ${BORDER_COLOR}`,
  },
  // 左右のクラスタに flex:1 を与えることで、中央の「次の一手」が常に画面中央に来る
  leftCluster:  { flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' },
  rightCluster: { flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  startArea:    { display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 },
  hint:  { fontSize: 11, color: TEXT_MUTED },
  badge: {
    height: BUTTON_BAR_HEIGHT, boxSizing: 'border-box', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 10px', borderRadius: RADIUS_PILL,
    fontSize: 'clamp(0.5rem, 0.85vw, 0.85rem)', fontWeight: 600,
    letterSpacing: 1, color: '#fff', whiteSpace: 'nowrap',
  },
};
