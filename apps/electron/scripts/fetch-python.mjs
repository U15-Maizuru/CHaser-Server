// 配布用アプリに同梱する Python embeddable package (Windows x64) を取得するスクリプト。
// 対戦プログラムは単体 .py ファイルのみ対応（pip/numpy 等は不要）なので、素の embeddable
// zip を展開するだけでよい。取得物は apps/electron/vendor/ 配下（.gitignore 済み）に置く。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_VERSION = '3.11.9';
const ZIP_NAME       = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const DOWNLOAD_URL    = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${ZIP_NAME}`;

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.join(__dirname, '..');
const VENDOR_DIR    = path.join(ELECTRON_DIR, 'vendor');
const PYTHON_DIR    = path.join(VENDOR_DIR, 'python');
const ZIP_PATH       = path.join(VENDOR_DIR, ZIP_NAME);

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
function stripIsolationPth() {
  for (const entry of fs.readdirSync(PYTHON_DIR)) {
    if (!entry.endsWith('._pth')) continue;
    fs.rmSync(path.join(PYTHON_DIR, entry));
    console.log(`[fetch-python] removed ${entry} (PYTHONPATH を有効にするため)`);
  }
}

async function main() {
  if (fs.existsSync(path.join(PYTHON_DIR, 'python.exe'))) {
    console.log(`[fetch-python] already present: ${PYTHON_DIR}`);
    // 取得済みの vendor に対しても毎回適用する (旧バージョンで取得したものを救済する)
    stripIsolationPth();
    return;
  }

  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  console.log(`[fetch-python] downloading ${DOWNLOAD_URL}`);
  const res = await fetch(DOWNLOAD_URL);
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  fs.writeFileSync(ZIP_PATH, Buffer.from(await res.arrayBuffer()));

  console.log(`[fetch-python] extracting to ${PYTHON_DIR}`);
  fs.mkdirSync(PYTHON_DIR, { recursive: true });
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${PYTHON_DIR}' -Force`,
  ]);

  fs.rmSync(ZIP_PATH);
  stripIsolationPth();
  console.log('[fetch-python] done');
}

main().catch((err) => {
  console.error('[fetch-python] failed:', err);
  process.exit(1);
});
