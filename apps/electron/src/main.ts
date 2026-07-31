import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

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
      U15_PYTHON_EXE: path.join(process.resourcesPath, 'python', 'python.exe'),
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
  });
  backendProcess.stdout?.on('data', (d: Buffer) =>
    console.log('[backend]', d.toString().trimEnd()),
  );
  backendProcess.stderr?.on('data', (d: Buffer) =>
    console.error('[backend]', d.toString().trimEnd()),
  );
  backendProcess.on('exit', (code) => console.log('[backend] exit:', code));
}

function stopBackend(): void {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

const WEB_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
};

function loadUrl(win: BrowserWindow, search: string): void {
  if (isDev) {
    void win.loadURL(`http://localhost:5173/${search}`);
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
      const res  = await fetch('http://localhost:8765/api/default-room');
      const data = await res.json() as { roomId?: string };
      if (data.roomId) return data.roomId;
    } catch {
      // バックエンドがまだ起動していない場合は待機
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return 'local'; // フォールバック
}

// ── 対戦表示ウィンドウ ─────────────────────────────────────────────────────
let displayWindow: BrowserWindow | null = null;

function createDisplayWindow(roomId: string): void {
  displayWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'U15 Server Maizuru — 対戦画面',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  displayWindow.removeMenu(); // 観覧用ウィンドウはネイティブメニューバー (File/Edit/...) を表示しない
  loadUrl(displayWindow, `?room=${roomId}&mode=display`);
  displayWindow.on('closed', () => { displayWindow = null; });
}

// ── コントロールウィンドウ ────────────────────────────────────────────────
let controlWindow: BrowserWindow | null = null;

function createControlWindow(roomId: string): void {
  controlWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'U15 Server Maizuru — コントロール',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  loadUrl(controlWindow, `?room=${roomId}&mode=control`);

  controlWindow.on('closed', () => {
    controlWindow = null;
    app.quit();
  });
}

// ── 手動操作ウィンドウ (COOL / HOT 独立) ────────────────────────────────────
const manualWindows: [BrowserWindow | null, BrowserWindow | null] = [null, null];
const MANUAL_LABEL = ['COOL', 'HOT'] as const;

function createManualWindow(roomId: string, slot: 0 | 1): void {
  const existing = manualWindows[slot];
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 360,
    height: 560,
    title: `U15 Server Maizuru — 手動操作 (${MANUAL_LABEL[slot]})`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  loadUrl(win, `?room=${roomId}&mode=manual&slot=${slot}`);
  win.on('closed', () => { manualWindows[slot] = null; });
  manualWindows[slot] = win;
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
        { name: 'Executables', extensions: ['exe'] },
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
      filters: [
        { name: 'Python 実行ファイル', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('display:toggleFullscreen', () => {
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
    createManualWindow(roomId, slot);
  });

  createDisplayWindow(roomId);
  createControlWindow(roomId);

  app.on('activate', () => {
    if (!displayWindow) createDisplayWindow(roomId);
    if (!controlWindow) createControlWindow(roomId);
  });
}).catch(console.error);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', stopBackend);
