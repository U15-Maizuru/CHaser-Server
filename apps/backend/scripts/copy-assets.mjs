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

copyDir('src/assets', 'dist/assets');
