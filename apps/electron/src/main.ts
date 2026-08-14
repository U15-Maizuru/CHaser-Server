import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { killTree } from './killTree';

const isDev = process.env['NODE_ENV'] === 'development';

let backendProcess: ChildProcess | null = null;

/** dev/パッケージ版それぞれのバックエンド起動設定 (実行ファイル・引数・環境変数・作業ディレクトリ) */
function getBackendLaunchConfig(appPath: string): {
  exe: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string | undefined;
} {
  const backendEntry = isDev
    ? path.join(appPath, '../../../apps/backend/src/index.ts')
    : path.join(process.resourcesPath, 'backend/dist/index.js');

  if (isDev) {
    return {
      exe: 'node',
      args: [
        path.join(appPath, '../../../apps/backend/node_modules/tsx/dist/cli.cjs'),
        backendEntry,
      ],
      env: { ...process.env, U15_MODE: 'local' },
      // ワークスペースルート (プロセスの起動時 cwd) からの相対パス解決を前提にしているため未指定
      cwd: undefined,
    };
  }

  return {
    exe: process.execPath,
    args: [backendEntry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      U15_MODE: 'local',
      U15_PYTHON_EXE: process.platform === 'win32'
        ? path.join(process.resourcesPath, 'python', 'python.exe')
        : path.join(process.resourcesPath, 'python', 'bin', 'python3'),
    },
    // インストール済みアプリはショートカット起動時の CWD が不定なため、
    // ユーザーデータ保存先を明示的に固定する
    cwd: app.getPath('userData'),
  };
}

function startBackend(appPath: string): void {
  const { exe, args, env, cwd } = getBackendLaunchConfig(appPath);
  console.log('[main] backend entry:', args[args.length - 1]);

  backendProcess = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    cwd,
    // Windows には POSIX のプロセスグループが無く killTree() は taskkill /T で
    // 木ごと片付けるが、POSIX では killTree() が `process.kill(-pid, ...)` で
    // プロセスグループごと落とす前提のため、ここでグループ長にしておく必要がある
    detached: process.platform !== 'win32',
  });
  backendProcess.stdout?.on('data', (d: Buffer) =>
    console.log('[backend]', d.toString().trimEnd()),
  );
  backendProcess.stderr?.on('data', (d: Buffer) =>
    console.error('[backend]', d.toString().trimEnd()),
  );
  backendProcess.on('exit', (code) => console.log('[backend] exit:', code));
}

/**
 * バックエンドを木ごと終了させる。
 *
 * dev では tsx の CLI が実体のバックエンドを子プロセスとして起動するため、
 * `backendProcess.kill()` だけでは実体が残って 8765 を握り続ける。
 * 対戦プログラム (python 等) もバックエンドの子なので、木ごと落とせば一緒に片付く。
 */
function stopBackend(): void {
  if (!backendProcess) return;
  killTree(backendProcess.pid);
  backendProcess = null;
}

const WEB_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
};

// ウィンドウとタスクバーのアイコン。dist/main.js から見た相対位置なので、
// dev (apps/electron/dist) でもパッケージ版 (app.asar 内) でも同じ式で解決できる。
// electron-builder には package.json の build.win.icon / build.mac.icon で
// 同じファイルを渡している (mac はアプリバンドルの .icns、dock/タスクバーは OS 側が使う)。
const ICON_PATH = path.join(
  __dirname,
  process.platform === 'darwin' ? '../assets/icon.icns' : '../assets/icon.ico',
);

function loadUrl(win: BrowserWindow, search: string): void {
  if (isDev) {
    // 'localhost' ではなく 127.0.0.1 を使う。Chromium 側の名前解決が詰まると
    // (Docker Desktop 等が DNS に割り込むと起きる) 画面が真っ白のまま返らなくなるため、
    // 自分で起動した dev サーバーには名前解決を介さず直接つなぐ
    void win.loadURL(`http://127.0.0.1:5173/${search}`);
  } else {
    void win.loadFile(
      path.join(process.resourcesPath, 'frontend/dist/index.html'),
      { search },
    );
  }
}

// ── デフォルトルームの roomId を取得 ────────────────────────────────────────
// バックエンドが U15_MODE=local で起動すると roomId='local' が自動作成される。
// /api/default-room から取得して URL パラメータとして使う。
async function fetchDefaultRoom(retries = 20): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      // loadUrl と同じ理由で名前解決を介さない (localhost だと DNS に割り込まれて詰まりうる)
      const res  = await fetch('http://127.0.0.1:8765/api/default-room');
      const data = await res.json() as { roomId?: string };
      if (data.roomId) return data.roomId;
    } catch {
      // バックエンドがまだ起動していない場合は待機
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'local'; // フォールバック
}

// ── ウィンドウ ─────────────────────────────────────────────────────────────
//
// 4種類のウィンドウはサイズ以外ほぼ同じ手順で作る。個別に書くと
// preload の配線や「既に開いていたら focus」のガードが片方だけ抜ける
// (実際、以前は display と control にだけガードが無かった) ため、生成はここに集約する。
//
// `mode` は URL のクエリとしてフロントエンドへ渡り、apps/frontend/src/App.tsx が
// これを見て画面を出し分ける。E2E も `url().includes('mode=...')` でウィンドウを
// 特定しているので、値を変えるときは両方を直すこと。
type WindowMode = 'display' | 'control' | 'manual' | 'tournament';

// ページを読み込むまでの一瞬だけ出るタイトル。用途つきの正式なタイトル
// (「対戦表示 — CHaser Server」等) はフロントエンドが mode から組み立てて
// document.title に入れ、ウィンドウタイトルはそれに追従する。
// 名前を持つのは apps/frontend/src/lib/appMode.ts の appWindowTitle だけ。
const INITIAL_TITLE = 'CHaser Server';

interface WindowSpec {
  width:  number;
  height: number;
  /** 観覧用ウィンドウはネイティブメニューバー (File/Edit/...) を表示しない */
  removeMenu: boolean;
  /** 閉じたらアプリごと終了する (コントロールウィンドウのみ) */
  quitOnClose?: boolean;
  /** `?room=...&mode=...` に続けて足すクエリ */
  extraSearch?: string;
}

// 開いているウィンドウ。キーは mode (手動操作だけはスロットごとに2枚あるので 'manual:0' / 'manual:1')
const openWindows = new Map<string, BrowserWindow>();

function getWindow(key: string): BrowserWindow | null {
  const win = openWindows.get(key);
  return win && !win.isDestroyed() ? win : null;
}

/**
 * 全画面をキーボードだけで解除できるようにする (ESC で解除 / F11 で入り切り)。
 *
 * 全画面にすると、解除する手段が画面上から消えてしまう:
 * 対戦表示ウィンドウはネイティブメニューを外してあり (WindowSpec.removeMenu)、
 * 唯一の切り替え口であるコントロールウィンドウの ⛶ ボタンは全画面の裏に隠れる。
 * Electron のウィンドウ全画面はブラウザの全画面と違って ESC が既定では効かないので、
 * 最後の逃げ道として自分で配線する。F11 でどのウィンドウも全画面にできる以上、
 * 逃げ道も全ウィンドウに要る。生成を集約しているのと同じ理由でここに一本化する。
 *
 * 注意: Playwright の `keyboard.press()` は CDP でレンダラへ直接注入するため
 * `before-input-event` を発火させない。E2E からはここの動作を検証できない。
 */
function enableFullscreenEscape(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;

    const isFullScreen = win.isFullScreen();
    const next = input.key === 'F11'                    ? !isFullScreen
               : input.key === 'Escape' && isFullScreen ? false
               : null;
    if (next === null) return;

    win.setFullScreen(next);
    // 使ったキーはページへ渡さない (ESC でモーダルまで一緒に閉じてしまわないように)
    event.preventDefault();
  });
}

function createAppWindow(key: string, mode: WindowMode, roomId: string, spec: WindowSpec): void {
  const existing = getWindow(key);
  if (existing) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width:  spec.width,
    height: spec.height,
    title:  INITIAL_TITLE,
    icon:   ICON_PATH,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  if (spec.removeMenu) win.removeMenu();
  enableFullscreenEscape(win);

  loadUrl(win, `?room=${roomId}&mode=${mode}${spec.extraSearch ?? ''}`);

  win.on('closed', () => {
    openWindows.delete(key);
    if (spec.quitOnClose) app.quit();
  });
  openWindows.set(key, win);
}

function openDisplayWindow(roomId: string): void {
  createAppWindow('display', 'display', roomId, {
    width: 1280, height: 800, removeMenu: true,
  });
}

function openControlWindow(roomId: string): void {
  createAppWindow('control', 'control', roomId, {
    width: 1280, height: 800, removeMenu: false, quitOnClose: true,
  });
}

function openManualWindow(roomId: string, slot: 0 | 1): void {
  createAppWindow(`manual:${slot}`, 'manual', roomId, {
    width: 360, height: 560, removeMenu: false,
    extraSearch: `&slot=${slot}`,
  });
}

function openTournamentWindow(roomId: string): void {
  createAppWindow('tournament', 'tournament', roomId, {
    width: 1440, height: 900, removeMenu: true,
  });
}

app.whenReady().then(async () => {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Map files', extensions: ['map'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:saveFile', async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Map files', extensions: ['map'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('dialog:openProgramFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [
        { name: 'Python scripts', extensions: ['py'] },
        // .exe は Windows にしかない概念なので mac では出さない
        ...(process.platform === 'win32' ? [{ name: 'Executables', extensions: ['exe'] }] : []),
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:openPythonExe', async () => {
    const result = await dialog.showOpenDialog({
      filters: process.platform === 'win32'
        ? [
            { name: 'Python 実行ファイル', extensions: ['exe'] },
            { name: 'All files', extensions: ['*'] },
          ]
        : [{ name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('display:toggleFullscreen', () => {
    const displayWindow = getWindow('display');
    if (!displayWindow) return false;
    const next = !displayWindow.isFullScreen();
    displayWindow.setFullScreen(next);
    return next;
  });

  startBackend(__dirname);

  // バックエンドが起動してデフォルトルームが作成されるまで待つ
  const roomId = await fetchDefaultRoom();
  console.log('[main] default room:', roomId);

  ipcMain.handle('manual:openWindow', (_e, slot: 0 | 1) => {
    openManualWindow(roomId, slot);
  });

  ipcMain.handle('tournament:openWindow', () => {
    openTournamentWindow(roomId);
  });

  openDisplayWindow(roomId);
  openControlWindow(roomId);

  // 開いていれば focus、閉じていれば作り直す (どちらも createAppWindow が面倒を見る)
  app.on('activate', () => {
    openDisplayWindow(roomId);
    openControlWindow(roomId);
  });
}).catch(console.error);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', stopBackend);
