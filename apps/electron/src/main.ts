import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

const isDev = process.env['NODE_ENV'] === 'development';

let backendProcess: ChildProcess | null = null;

function startBackend(appPath: string): void {
  // Dev: run TypeScript source directly via tsx CLI (node tsx-cli.cjs entry.ts).
  // Spawning node directly avoids .cmd shell-escaping issues on Windows with non-ASCII paths.
  // Prod: electron binary acts as Node.js runtime with ELECTRON_RUN_AS_NODE=1.

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
    ? { ...process.env }
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

  console.log('[main] backend entry:', backendEntry);

  backendProcess = spawn(exe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: backendEnv,
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

type BW = InstanceType<typeof BrowserWindow>;
let mainWindow: BW | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'U15 Server Maizuru',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(
      path.join(process.resourcesPath, 'frontend/dist/index.html'),
    );
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(console.error);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', stopBackend);
