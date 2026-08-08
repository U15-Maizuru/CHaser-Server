// 画面全体で共有する色・角丸・影・フォント。個々のコンポーネントは生の値を持たない。

// 背景
export const BG_ROOT   = '#faf7ff';
export const BG_CARD   = '#ffffff';
export const BG_HEADER = 'linear-gradient(135deg, #f0eeff 0%, #fff0f6 100%)';
/** ダイアログの背後を覆う幕 */
export const BG_SCRIM  = 'rgba(30,24,48,0.45)';

// COOL プレイヤー (パステルブルー系)
export const COOL_COLOR = '#3d88e8';
export const COOL_LIGHT = '#ddeeff';
export const COOL_PALE  = '#f0f7ff';
export const COOL_DARK  = '#1a55bb';

// HOT プレイヤー (パステルローズ系)
export const HOT_COLOR = '#ee4477';
export const HOT_LIGHT = '#ffd0e0';
export const HOT_PALE  = '#fff0f5';
export const HOT_DARK  = '#bb1144';

// ターン (パステルパープル)
export const TURN_BASE  = '#9966dd';
export const TURN_LIGHT = '#eee0ff';
export const TURN_PALE  = '#f8f4ff';

// 総合・勝利 (パステルミント)
export const WIN_BASE  = '#33aa77';
export const WIN_LIGHT = '#ccf0e0';
export const WIN_PALE  = '#f0fbf5';

// ゴールド (引き分け・アイテム・勝利演出)
export const GOLD_BASE  = '#ddaa22';
export const GOLD_LIGHT = '#fff3cc';

// 減点 (マイナスの一撃ボーナス)。盤面の自滅演出 (GameBoardCanvas の warn) と同じオレンジ
export const PENALTY_COLOR = '#ff7a1a';
export const PENALTY_PALE  = '#fff3ea';

/** エラー表示 (アップロード失敗・プログラム起動失敗) */
export const ERROR_COLOR = '#c43a3a';
/** バックエンドとの接続が切れていることを示すバッジ */
export const DISCONNECTED_COLOR = '#cc4455';

// テキスト
export const TEXT_PRIMARY   = '#1e1830';
export const TEXT_SECONDARY = '#6e5e88';
export const TEXT_MUTED     = '#a898ba';

// 接続状態バッジ
export const STATE_READY     = '#33aa77';
export const STATE_CONNECTED = '#55bb88';
export const STATE_WAITING   = '#9966dd';

// シャドウ・ボーダー・角丸
export const SHADOW_SM    = '0 2px 8px rgba(120,90,200,0.10)';
export const SHADOW_MD    = '0 4px 20px rgba(120,90,200,0.12)';
export const BORDER_COLOR = 'rgba(140,120,210,0.18)';
export const RADIUS_SM    = '12px';
export const RADIUS_MD    = '20px';
export const RADIUS_LG    = '28px';
/** 丸ボタン・バッジ */
export const RADIUS_PILL  = 999;

// フォント
export const FONT_UI  = '-apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';
export const FONT_NUM = '"SF Mono", Menlo, "Courier New", monospace';

/**
 * team-index (0=COOL / 1=HOT) ごとの配色一式。
 * 「0 なら COOL の色、1 なら HOT の色」という対応を画面ごとに書き起こさないための表。
 */
export const TEAM_PALETTE = [
  { label: 'COOL', color: COOL_COLOR, light: COOL_LIGHT, pale: COOL_PALE, dark: COOL_DARK },
  { label: 'HOT',  color: HOT_COLOR,  light: HOT_LIGHT,  pale: HOT_PALE,  dark: HOT_DARK  },
] as const;

/** プレイヤーパネルのヘッダに使う斜めグラデーション */
export function teamGradient(color: string, dark: string): string {
  return `linear-gradient(135deg, ${color}, ${dark})`;
}
