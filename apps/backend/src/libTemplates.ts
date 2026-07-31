import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dev (tsx: src/libTemplates.ts) でも本番 (esbuild bundle: dist/index.js) でも、
// このファイルの実行時ロケーションと同じ階層に assets/lib-templates を置く運用にすることで、
// resourcesPath 等を意識せず一貫して解決できる。
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'lib-templates');

/**
 * 指定した lib ディレクトリを作成し、既定ライブラリ (pyCHaser など) が
 * まだ無ければテンプレートから配置する。ユーザーがアップロードした
 * カスタムライブラリや、既に配置済みの既定ライブラリは上書きしない。
 */
export function ensureLibDir(libDir: string): void {
  fs.mkdirSync(libDir, { recursive: true });
  // fs.existsSync は Windows 等の大文字小文字を区別しないファイルシステムでは
  // 大文字小文字違いのファイルも「存在する」と判定してしまう。Python の import は
  // 大文字小文字を厳密に区別するため、実際のディレクトリエントリと完全一致するかを
  // fs.readdirSync で確認する。大文字小文字だけが異なる残骸ファイルが見つかった場合は
  // 削除して正しい大文字小文字のファイルへ移行する。
  const existing = fs.readdirSync(libDir);
  for (const file of fs.readdirSync(TEMPLATE_DIR)) {
    if (existing.includes(file)) continue;
    const stale = existing.find(e => e.toLowerCase() === file.toLowerCase());
    if (stale) fs.rmSync(path.join(libDir, stale));
    fs.copyFileSync(path.join(TEMPLATE_DIR, file), path.join(libDir, file));
  }
}
