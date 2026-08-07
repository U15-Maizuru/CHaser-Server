import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

// 大会データ (.zip) の最小の読み書き。node:zlib だけで済むので新規依存を足さない。
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

// ── 書き出し ──────────────────────────────────────────────────────────────

export interface ZipWriteEntry {
  name: string;
  data: Buffer;
  /** true なら無圧縮 (method=0)。既定は deflate (method=8) */
  store?: boolean;
}

/**
 * エントリの配列から ZIP を組み立てる。ディレクトリエントリは作らない
 * (`programs/foo.py` のように名前へスラッシュを含めれば展開時にフォルダができる)。
 */
export function writeZip(entries: ZipWriteEntry[]): Buffer {
  const locals:   Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const method  = e.store ? 0 : 8;
    const data    = e.store ? e.data : deflateRawSync(e.data);
    const crc     = crc32(e.data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);               // version needed
    local.writeUInt16LE(0, 6);                // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);     // compressed size
    local.writeUInt32LE(e.data.length, 22);   // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);               // extra len
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(SIG_CD, 0);
    central.writeUInt16LE(20, 4);             // version made by
    central.writeUInt16LE(20, 6);             // version needed
    central.writeUInt16LE(0, 8);              // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);             // extra len
    central.writeUInt16LE(0, 32);             // comment len
    central.writeUInt32LE(offset, 42);        // local header offset
    nameBuf.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const cd      = Buffer.concat(centrals);
  const cdStart = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);

  return Buffer.concat([...locals, cd, eocd]);
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
