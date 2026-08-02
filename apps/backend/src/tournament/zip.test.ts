import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildZip } from '../test/buildZip.js';
import { DEFAULT_ZIP_LIMITS, ZipError, extractZip, readZip, safeJoin } from './zip.js';

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-zip-test-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('readZip', () => {
  it('deflate(8) のエントリを往復できる', () => {
    const zip = buildZip([{ name: 'tournament.json', body: '{"name":"杯"}' }]);
    const out = readZip(zip);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('tournament.json');
    expect(out[0]!.data.toString('utf-8')).toBe('{"name":"杯"}');
  });

  it('store(0) のエントリも読める', () => {
    const zip = readZip(buildZip([{ name: 'a.py', body: 'print(1)', store: true }]));
    expect(zip[0]!.data.toString('utf-8')).toBe('print(1)');
  });

  it('複数エントリと日本語ファイル名を扱える', () => {
    const zip = readZip(buildZip([
      { name: 'tournament.json', body: '{}' },
      { name: 'programs/舞鶴A.py', body: 'print("A")' },
      { name: 'programs/b.py', body: 'print("B")', store: true },
    ]));
    expect(zip.map(e => e.name)).toEqual(['tournament.json', 'programs/舞鶴A.py', 'programs/b.py']);
    expect(zip[1]!.data.toString('utf-8')).toBe('print("A")');
  });

  it('大きめの内容でも壊れない', () => {
    const body = 'x'.repeat(100_000);
    const zip  = readZip(buildZip([{ name: 'big.py', body }]));
    expect(zip[0]!.data.toString('utf-8')).toBe(body);
  });

  it('ディレクトリエントリは無視する', () => {
    const zip = readZip(buildZip([
      { name: 'programs/', body: '', store: true },
      { name: 'programs/a.py', body: 'x' },
    ]));
    expect(zip.map(e => e.name)).toEqual(['programs/a.py']);
  });

  it('ZIP でないバイト列は ZipError', () => {
    expect(() => readZip(Buffer.from('これはzipではない'))).toThrow(ZipError);
    expect(() => readZip(Buffer.from('これはzipではない'))).toThrow(/ZIP ファイルとして読めません/);
  });

  it('エントリ数の上限を超えたら ZipError', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.py`, body: 'x' }));
    expect(() => readZip(buildZip(many), { ...DEFAULT_ZIP_LIMITS, maxEntries: 3 }))
      .toThrow(/ファイル数が多すぎます/);
  });

  it('1エントリのサイズ上限を超えたら ZipError', () => {
    const zip = buildZip([{ name: 'big.py', body: 'x'.repeat(2000) }]);
    expect(() => readZip(zip, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000 }))
      .toThrow(/大きすぎます/);
  });

  it('合計サイズの上限を超えたら ZipError', () => {
    const zip = buildZip([
      { name: 'a.py', body: 'x'.repeat(800) },
      { name: 'b.py', body: 'x'.repeat(800) },
    ]);
    expect(() => readZip(zip, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 1000, maxTotalBytes: 1000 }))
      .toThrow(/ZIP 全体が大きすぎます/);
  });
});

describe('safeJoin (zip-slip 対策)', () => {
  it('通常のパスは展開先の下に解決される', () => {
    const dest = tmpDir();
    expect(safeJoin(dest, 'programs/a.py')).toBe(path.resolve(dest, 'programs/a.py'));
  });

  it('展開先の外を指すパスを弾く', () => {
    const dest = tmpDir();
    for (const bad of [
      '../evil.py',
      'programs/../../evil.py',
      '/etc/passwd',
      'C:\\Windows\\evil.py',
      '..\\evil.py',
    ]) {
      expect(() => safeJoin(dest, bad)).toThrow(ZipError);
    }
  });
});

describe('extractZip', () => {
  it('ファイルを展開して相対パスを返す', () => {
    const dest = tmpDir();
    const written = extractZip(buildZip([
      { name: 'tournament.json', body: '{"a":1}' },
      { name: 'programs/a.py', body: 'print(1)' },
    ]), dest);

    expect(written.sort()).toEqual(['programs/a.py', 'tournament.json']);
    expect(fs.readFileSync(path.join(dest, 'tournament.json'), 'utf-8')).toBe('{"a":1}');
    expect(fs.readFileSync(path.join(dest, 'programs/a.py'), 'utf-8')).toBe('print(1)');
  });

  it('許可外の拡張子は展開しない', () => {
    const dest = tmpDir();
    const written = extractZip(buildZip([
      { name: 'tournament.json', body: '{}' },
      { name: 'evil.exe', body: 'MZ' },
      { name: 'programs/a.py', body: 'x' },
    ]), dest, { allowedExtensions: ['.json', '.py'] });

    expect(written.sort()).toEqual(['programs/a.py', 'tournament.json']);
    expect(fs.existsSync(path.join(dest, 'evil.exe'))).toBe(false);
  });

  it('展開先の外へ書き出そうとしたら ZipError で中断する', () => {
    const dest = tmpDir();
    expect(() => extractZip(buildZip([{ name: '../escaped.py', body: 'x' }]), dest))
      .toThrow(/展開先の外/);
  });
});
