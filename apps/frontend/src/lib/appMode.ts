/**
 * URL のクエリから「どの画面を出すか」を読む。
 *
 * 読んだ結果はウィンドウ/タブのタイトル (appWindowTitle) にも使う。
 *
 * `mode` の語彙は Electron 側 (apps/electron/src/main.ts の WindowMode) が組み立てて渡す。
 * E2E も `url().includes('mode=...')` でウィンドウを特定しているので、値を変えるときは
 * その3箇所を揃えること。
 *
 * モジュールのトップレベルで読むとテストから差し替えられないため、関数にしてある。
 */
export type AppMode = 'display' | 'control' | 'manual' | 'tournament' | 'mapEditor';

const MODES: readonly AppMode[] = ['display', 'control', 'manual', 'tournament', 'mapEditor'];

export interface AppLocation {
  /** ルーム指定なし = ロビー (Web サービスモード) */
  roomId: string | null;
  mode:   AppMode;
  slot:   0 | 1;
  /** mode='mapEditor' のとき、マップ管理の「編集」から開いた場合のライブラリ ID (「新規作成」なら null) */
  mapId:  string | null;
}

export function readAppLocation(search: string): AppLocation {
  const params = new URLSearchParams(search);
  const mode   = params.get('mode');
  return {
    roomId: params.get('room'),
    mode:   MODES.includes(mode as AppMode) ? mode as AppMode : 'display',
    slot:   params.get('slot') === '1' ? 1 : 0,
    mapId:  params.get('mapId'),
  };
}

// index.html の <title> と Electron の INITIAL_TITLE (apps/electron/src/main.ts) も同じ名前を持つが、
// どちらもページが表示されるまでの繋ぎなので、そちらとは共有しない
const APP_NAME = 'CHaser Server';

/** 画面の用途を表す名前。ドキュメント (docs/user-manual.md) と同じ語を使う */
const MODE_LABEL: Record<AppMode, string> = {
  display:    '対戦表示',
  control:    'コントロール',
  manual:     '手動操作',
  tournament: '大会運営',
  mapEditor:  'マップエディタ',
};

const MANUAL_SLOT_LABEL = ['COOL', 'HOT'] as const;

/**
 * ウィンドウ (Electron) / タブ (ブラウザ) のタイトル。
 *
 * **用途を先頭に置く。** タスクバーもブラウザのタブも幅が足りなければ末尾から削るので、
 * `CHaser Server — 対戦表示` の順にすると3枚とも「CHaser Server」までしか見えず、
 * 並べたときに区別できない。
 *
 * Electron 側はここで入れた `document.title` をそのままウィンドウタイトルにする
 * (`BrowserWindow` の `title` はページ読込前の一瞬しか出ない)。両側で名前を持つと必ず
 * ずれるので、用途の名前はここだけが決める。
 */
export function appWindowTitle(loc: AppLocation): string {
  if (!loc.roomId) return `ロビー — ${APP_NAME}`;
  const label = loc.mode === 'manual'
    ? `${MODE_LABEL.manual} (${MANUAL_SLOT_LABEL[loc.slot]})`
    : MODE_LABEL[loc.mode];
  return `${label} — ${APP_NAME}`;
}
