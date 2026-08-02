import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

// 大会データ (.zip) の最小展開。node:zlib だけで済むので新規依存を足さない。
// 対応するのは store(0) と deflate(8) のみ。ZIP64 や暗号化には対応しない
// (大会データは tournament.json + programs/*.py の小さなアーカイブなので十分)。

export class ZipError extends Error {}

const SIG_EOCD  = 0x06054b50;
const SIG_LOCAL = 0x04034b50;
const SIG_CD    = 0x02014b50;

export interface ZipLimits {
  maxEntries:    number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries:    200,
  maxEntryBytes: 512 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
};

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 末尾から End of Central Directory を後方探索する (コメント付きでも見つかる) */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new ZipError('ZIP ファイルとして読めません (End of Central Directory が見つかりません)');
}

/**
 * ZIP を展開してエントリの配列を返す。ディレクトリエントリは含まない。
 * ファイル名の検証 (zip-slip 対策) は extractZip 側で行う。
 */
export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const eocd    = findEocd(buf);
  const count   = buf.readUInt16LE(eocd + 10);
  const cdStart = buf.readUInt32LE(eocd + 16);

  if (count > limits.maxEntries) {
    throw new ZipError(`ZIP のファイル数が多すぎます (上限 ${limits.maxEntries} 件)`);
  }

  const entries: ZipEntry[] = [];
  let total = 0;
  let p     = cdStart;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) {
      throw new ZipError('ZIP の中央ディレクトリが壊れています');
    }

    const method     = buf.readUInt16LE(p + 10);
    const compSize   = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const fnLen      = buf.readUInt16LE(p + 28);
    const extraLen   = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff   = buf.readUInt32LE(p + 42);
    const name       = buf.subarray(p + 46, p + 46 + fnLen).toString('utf-8');

    p += 46 + fnLen + extraLen + commentLen;

    // ディレクトリエントリは中身が無いので飛ばす
    if (name.endsWith('/')) continue;

    if (uncompSize > limits.maxEntryBytes) {
      throw new ZipError(`"${name}" が大きすぎます (上限 ${limits.maxEntryBytes / 1024}KB)`);
    }
    total += uncompSize;
    if (total > limits.maxTotalBytes) {
      throw new ZipError(`ZIP 全体が大きすぎます (上限 ${limits.maxTotalBytes / 1024 / 1024}MB)`);
    }

    // ローカルヘッダは可変長なので、実データの開始位置はここで読み直す
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== SIG_LOCAL) {
      throw new ZipError(`"${name}" のローカルヘッダが壊れています`);
    }
    const lFnLen    = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lFnLen + lExtraLen;
    const raw       = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = inflateRawSync(raw);
      } catch {
        throw new ZipError(`"${name}" を展開できませんでした`);
      }
    } else {
      throw new ZipError(`"${name}" は未対応の圧縮方式です (method=${method})`);
    }

    entries.push({ name, data });
  }

  return entries;
}

/** 展開先の外に書き出そうとするエントリ名 (zip-slip) を弾く */
export function safeJoin(destDir: string, name: string): string {
  const normalized = name.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new ZipError(`"${name}" は展開先の外を指しています`);
  }
  const dest = path.resolve(destDir);
  const out  = path.resolve(dest, normalized);
  if (out !== dest && !out.startsWith(dest + path.sep)) {
    throw new ZipError(`"${name}" は展開先の外を指しています`);
  }
  return out;
}

export interface ExtractOptions {
  /** 許可する拡張子 (小文字、ドット付き)。指定しなければ全て許可 */
  allowedExtensions?: string[];
  limits?: ZipLimits;
}

/** ZIP を destDir 配下へ展開する。書き出したファイルの相対パスを返す */
export function extractZip(buf: Buffer, destDir: string, opts: ExtractOptions = {}): string[] {
  const entries = readZip(buf, opts.limits ?? DEFAULT_ZIP_LIMITS);
  const written: string[] = [];

  for (const entry of entries) {
    if (opts.allowedExtensions) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!opts.allowedExtensions.includes(ext)) continue; // 対象外は黙って捨てる
    }
    const out = safeJoin(destDir, entry.name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.data);
    written.push(path.relative(destDir, out).replace(/\\/g, '/'));
  }

  return written;
}
