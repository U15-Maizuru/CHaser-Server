// fs.cpSync({ recursive: true }) はこの環境の Node v22 でセグフォルトするため、
// 手動で再帰コピーする (esbuild ビルド後、dist/assets/ にテンプレート類を配置する)。
import fs from 'node:fs';
import path from 'node:path';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Windows の copyFileSync は大文字小文字を区別しないため、既存の dist に
// 旧名 (例: pyChaser.py) が残っていると中身だけ上書きされてファイル名の
// 大文字小文字が古いままになる。Python の import は大文字小文字を厳密に
// 区別するので、配布物に旧名が紛れ込むと `from lib.pyCHaser import *` が
// 失敗する。毎回作り直して名前のズレを持ち越さない。
fs.rmSync('dist/assets', { recursive: true, force: true });
copyDir('src/assets', 'dist/assets');
