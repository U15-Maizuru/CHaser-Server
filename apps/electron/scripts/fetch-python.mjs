// 配布用アプリに同梱する Python を取得するスクリプト。
// 対戦プログラムは単体 .py ファイルのみ対応（pip/numpy 等は不要）なので、素の
// 実行環境を展開するだけでよい。取得物は apps/electron/vendor/ 配下（.gitignore 済み）に置く。
//
// Windows: python.org の embeddable package (zip)。
// macOS  : python-build-standalone (https://github.com/astral-sh/python-build-standalone) の
//          install_only tarball。python.org は macOS 向けに embeddable 相当の配布物を
//          提供していないため、こちらを使う。Apple Silicon (arm64) のみ対応。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_VERSION = '3.11.9';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.join(__dirname, '..');
const VENDOR_DIR    = path.join(ELECTRON_DIR, 'vendor');

async function download(url, destPath) {
  console.log(`[fetch-python] downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

// ── Windows: embeddable package (zip) ────────────────────────────────────────

const WIN_ZIP_NAME     = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const WIN_DOWNLOAD_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${WIN_ZIP_NAME}`;
const WIN_PYTHON_DIR   = path.join(VENDOR_DIR, 'python');

/**
 * embeddable package に同梱される `python311._pth` を取り除く。
 *
 * `._pth` が存在すると Python は「隔離モード」で起動し、sys.path がそのファイルの
 * 記述だけで決まる。つまり PYTHONPATH も、スクリプト自身のディレクトリも一切
 * 無視される。対戦プログラムの `from lib.pyCHaser import *` は
 * ProcessClient.buildEnv() が渡す PYTHONPATH に依存しているため、`._pth` を
 * 残したままだと配布版でのみ ModuleNotFoundError: No module named 'lib' になる
 * (開発時は PATH の通常インストール版 Python が使われるので再現しない)。
 *
 * 削除すると通常の path 解決に戻り、同梱の python311.zip (標準ライブラリ) は
 * exe と同じ階層から従来どおり読まれる。
 */
function stripIsolationPth(pythonDir) {
  for (const entry of fs.readdirSync(pythonDir)) {
    if (!entry.endsWith('._pth')) continue;
    fs.rmSync(path.join(pythonDir, entry));
    console.log(`[fetch-python] removed ${entry} (PYTHONPATH を有効にするため)`);
  }
}

async function fetchWindows() {
  if (fs.existsSync(path.join(WIN_PYTHON_DIR, 'python.exe'))) {
    console.log(`[fetch-python] already present: ${WIN_PYTHON_DIR}`);
    // 取得済みの vendor に対しても毎回適用する (旧バージョンで取得したものを救済する)
    stripIsolationPth(WIN_PYTHON_DIR);
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  const zipPath = path.join(VENDOR_DIR, WIN_ZIP_NAME);
  await download(WIN_DOWNLOAD_URL, zipPath);

  console.log(`[fetch-python] extracting to ${WIN_PYTHON_DIR}`);
  fs.mkdirSync(WIN_PYTHON_DIR, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${WIN_PYTHON_DIR}' -Force`,
  ]);

  fs.rmSync(zipPath);
  stripIsolationPth(WIN_PYTHON_DIR);
  console.log('[fetch-python] done');
}

// ── macOS: python-build-standalone (tar.gz、arm64 のみ) ──────────────────────

// リリースは日付タグ。3.11.9 を含む同リリースで固定する (Windows 版とバージョンを揃える)。
const MAC_RELEASE_TAG  = '20240415';
const MAC_TAR_NAME      = `cpython-${PYTHON_VERSION}+${MAC_RELEASE_TAG}-aarch64-apple-darwin-install_only.tar.gz`;
const MAC_DOWNLOAD_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${MAC_RELEASE_TAG}/${MAC_TAR_NAME}`;
const MAC_PYTHON_DIR    = path.join(VENDOR_DIR, 'python-mac');

async function fetchMac() {
  if (fs.existsSync(path.join(MAC_PYTHON_DIR, 'bin', 'python3'))) {
    console.log(`[fetch-python] already present: ${MAC_PYTHON_DIR}`);
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  const tarPath = path.join(VENDOR_DIR, MAC_TAR_NAME);
  await download(MAC_DOWNLOAD_URL, tarPath);

  console.log(`[fetch-python] extracting to ${MAC_PYTHON_DIR}`);
  // アーカイブは展開すると単一のトップレベルディレクトリ `python/` を作る仕様なので、
  // vendor/ 直下に展開してから vendor/python-mac へリネームする。
  execFileSync('tar', ['xzf', tarPath, '-C', VENDOR_DIR]);
  fs.rmSync(MAC_PYTHON_DIR, { recursive: true, force: true });
  fs.renameSync(path.join(VENDOR_DIR, 'python'), MAC_PYTHON_DIR);

  fs.rmSync(tarPath);
  console.log('[fetch-python] done');
}

async function main() {
  if (process.platform === 'win32') {
    await fetchWindows();
  } else if (process.platform === 'darwin') {
    await fetchMac();
  } else {
    throw new Error(`unsupported platform: ${process.platform}`);
  }
}

main().catch((err) => {
  console.error('[fetch-python] failed:', err);
  process.exit(1);
});
