import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

const isDev = process.env['NODE_ENV'] === 'development';

let backendProcess: ChildProcess | null = null;

function startBackend(appPath: string): void {
  const backendEntry = isDev
    ? path.join(appPath, '../../../apps/backend/src/index.ts')
    : path.join(process.resourcesPath, 'backend/dist/index.js');

  const [exe, args] = isDev
    ? ['node', [
        path.join(appPath, '../../../apps/backend/node_modules/tsx/dist/cli.cjs'),
        backendEntry,
      ]]
    : [process.execPath, [backendEntry]];

  const backendEnv = isDev
    ? { ...process.env, U15_MODE: 'local' }
    : {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        U15_MODE: 'local',
        U15_PYTHON_EXE: path.join(process.resourcesPath, 'python', 'python.exe'),
      };

  console.log('[main] backend entry:', backendEntry);

  backendProcess = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: backendEnv,
    // インストール済みアプリはショートカット起動時の CWD が不定なため、
    // 本番ではユーザーデータ保存先を明示的に固定する（dev は従来通り workspace 相対）。
    cwd: isDev ? undefined : app.getPath('userData'),
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
  loadUrl(displayWindow, `?room=${roomId}&mode=display`);
  displayWindow.on('closed', () => { displayWindow = null; });
}

// ── コントロールウィンドウ ────────────────────────────────────────────────
let controlWindow: BrowserWindow | null = null;

function createControlWindow(roomId: string): void {
  controlWindow = new BrowserWindow({
    width: 820,
    height: 920,
    title: 'U15 Server Maizuru — コントロール',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), ...WEB_PREFS },
  });
  loadUrl(controlWindow, `?room=${roomId}&mode=control`);

  controlWindow.on('closed', () => {
    controlWindow = null;
    app.quit();
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
        { name: 'Executables', extensions: ['exe'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  startBackend(__dirname);

  // バックエンドが起動してデフォルトルームが作成されるまで待つ
  const roomId = await fetchDefaultRoom();
  console.log('[main] default room:', roomId);

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
