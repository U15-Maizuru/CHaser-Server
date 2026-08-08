'use strict';
// Dev launcher: Vite を起動してポート 5173 が準備完了してから Electron を起動する。
// pnpm が ELECTRON_RUN_AS_NODE=1 を残す場合があるため削除してから electron を起動する。
const { spawn, execSync } = require('child_process');
const path     = require('path');
const electron = require('electron');
const { killTree } = require('./dist/killTree.js');
const { VITE_PORT, isPortBusy, spawnVite, waitForPort } = require('./viteLauncher.cjs');

const BACKEND_PORT = 8765;

// Windows のコンソールコードページが UTF-8 (65001) でないと、Node/Electron が
// 出力する日本語ログが文字化けするため、起動時にコンソール側を UTF-8 に切り替える。
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // コンソールにアタッチしていない環境などでは失敗しても無視してよい
  }
}

// Vite/Electron の stdin は継承しない (stdout/stderr のみ継承してログは表示する)。
// Vite の CLI はインタラクティブショートカット (r/u/o/q 等) のために stdin を raw
// mode にするが、Windows のコンソールモードはプロセス終了時に自動復元されないため、
// 強制終了 (kill) すると起動元ターミナルのキー入力が壊れたまま残ってしまう。
const CHILD_STDIO = ['ignore', 'inherit', 'inherit'];

let electronProcess = null;
let vite            = null;
let cleaningUp      = false;

/**
 * 子を **木ごと** 片付けてから終了する。
 *
 * Windows の child.kill() は直接の子しか殺さないため、Vite (esbuild を従える) や
 * バックエンド (Electron → tsx → 実体) が残ってポートを握り続ける。
 * Ctrl+C でもコントロール画面を閉じた場合でも、必ずここを通す。
 */
function cleanupAndExit(code) {
  if (cleaningUp) return;
  cleaningUp = true;

  // 万一 stdin が raw mode のままになっていた場合に備えた防御的な復元
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false);
  }
  killAllChildren();
  process.exit(code ?? 0);
}

function killAllChildren() {
  // Electron を先に落とす (バックエンドは Electron の子なので木ごと片付く)
  if (electronProcess) killTree(electronProcess.pid);
  if (vite)            killTree(vite.pid);
  electronProcess = null;
  vite = null;
}

// ── 起動前の点検 ─────────────────────────────────────────────────────────────
// 前回の残骸がポートを握っていると、Vite は別ポートへ逃げ、Electron は**前回の**
// バックエンドにつながってしまう (前の対戦状態が見える・変更が反映されない)。
// 黙って壊れた状態で立ち上がるより、原因を示して止めるほうがよい。

async function preflight() {
  const busy = [];
  if (await isPortBusy(VITE_PORT))    busy.push(`${VITE_PORT} (Vite)`);
  if (await isPortBusy(BACKEND_PORT)) busy.push(`${BACKEND_PORT} (バックエンド)`);
  if (busy.length === 0) return true;

  console.error(`[dev] ポート ${busy.join(' / ')} が既に使われています。`);
  console.error('[dev] 前回の dev が残っている可能性があります。終了させてから再実行してください:');
  console.error(process.platform === 'win32'
    ? '[dev]   Get-NetTCPConnection -LocalPort 5173,8765 -State Listen | '
      + 'ForEach-Object { taskkill /pid $_.OwningProcess /T /F }'
    : '[dev]   lsof -ti:5173,8765 | xargs kill');
  return false;
}

// ── Vite ─────────────────────────────────────────────────────────────────────
// 起動そのものは viteLauncher.cjs に置いてある (E2E と共有するため)。
function startVite() {
  vite = spawnVite(CHILD_STDIO);

  vite.on('error', (err) => {
    console.error('[dev] Vite の起動に失敗しました:', err.message);
    cleanupAndExit(1);
  });

  vite.on('exit', (code) => {
    // Electron を出す前に Vite が落ちたら、待ち続けても意味がないので終わる
    if (!electronProcess && !cleaningUp) {
      console.error(`[dev] Vite が終了しました (code ${code})`);
      cleanupAndExit(code ?? 1);
    }
  });
}

function launchElectron() {
  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.ELECTRON_RUN_AS_NODE;

  // electron パッケージが解決する実行ファイルへの絶対パスを直接起動するため shell は不要
  // (pnpm 経由の起動と異なり、コマンド名からの PATH 解決は発生しない)
  electronProcess = spawn(String(electron), [path.resolve(__dirname)], {
    stdio: CHILD_STDIO,
    env,
    shell: false,
  });

  electronProcess.on('close', (code) => {
    // コントロール画面を閉じたときもここに来る。Vite を残さず一緒に片付ける
    cleanupAndExit(code);
  });
}

process.on('SIGINT',  () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
// ターミナルごと閉じられた場合など、シグナル以外の経路で落ちるときも子を残さない
process.on('exit', killAllChildren);

preflight().then(async (ok) => {
  if (!ok) { process.exit(1); return; }
  startVite();
  // Vite が受け付けるようになってから Electron を出す (先に出すと白画面のまま固まる)
  await waitForPort(VITE_PORT);
  launchElectron();
}).catch((err) => {
  console.error(`[dev] ${err.message}`);
  cleanupAndExit(1);
});
