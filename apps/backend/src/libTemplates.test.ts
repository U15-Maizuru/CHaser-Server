import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureLibDir } from './libTemplates.js';

describe('ensureLibDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-libtest-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('存在しないディレクトリを作成し、既定ライブラリ (pyCHaser.py) を配置する', () => {
    const libDir = path.join(dir, 'lib');
    ensureLibDir(libDir);
    expect(fs.existsSync(path.join(libDir, 'pyCHaser.py'))).toBe(true);
  });

  it('ユーザーが変更した既定ライブラリの内容を上書きしない', () => {
    const libDir = path.join(dir, 'lib');
    ensureLibDir(libDir);
    fs.writeFileSync(path.join(libDir, 'pyCHaser.py'), '# customized');
    ensureLibDir(libDir);
    expect(fs.readFileSync(path.join(libDir, 'pyCHaser.py'), 'utf8')).toBe('# customized');
  });

  it('既存のカスタムライブラリファイルはそのまま残る', () => {
    const libDir = path.join(dir, 'lib');
    ensureLibDir(libDir);
    fs.writeFileSync(path.join(libDir, 'myLib.py'), '# custom lib');
    ensureLibDir(libDir);
    expect(fs.existsSync(path.join(libDir, 'myLib.py'))).toBe(true);
  });

  it('大文字小文字違いの残骸ファイルが存在する場合、正しい大文字小文字のファイルに移行される', () => {
    const libDir = path.join(dir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    // 大文字小文字を区別しないファイルシステムでは fs.existsSync が誤って
    // "既に存在する" と判定してしまう状況を、大文字小文字違いのファイルを
    // あらかじめ用意することで直接再現する。
    fs.writeFileSync(path.join(libDir, 'pyChaser.py'), '# old casing');

    ensureLibDir(libDir);

    // fs.existsSync は大文字小文字を区別しないファイルシステムでは判定に使えないため、
    // 実際のディレクトリエントリを列挙して大文字小文字を含めて厳密に検証する。
    const entries = fs.readdirSync(libDir);
    expect(entries).toContain('pyCHaser.py');
    expect(entries).not.toContain('pyChaser.py');
  });
});
