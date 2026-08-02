import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

// テスト用に最小の ZIP を組み立てる。実装 (tournament/zip.ts) は読む側なので、
// 書く側はここで自前で用意する (これにより外部の zip ライブラリに依存しない)。

export interface ZipSrcEntry {
  name: string;
  body: string | Buffer;
  /** true なら無圧縮 (method=0)。既定は deflate (method=8) */
  store?: boolean;
}

export function buildZip(entries: ZipSrcEntry[]): Buffer {
  const locals:   Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const content = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body, 'utf-8');
    const method  = e.store ? 0 : 8;
    const data    = e.store ? content : deflateRawSync(content);
    const crc     = crc32(content);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);    // compressed size
    local.writeUInt32LE(content.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);              // extra len
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);            // version made by
    central.writeUInt16LE(20, 6);            // version needed
    central.writeUInt16LE(0, 8);             // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);            // extra len
    central.writeUInt16LE(0, 32);            // comment len
    central.writeUInt32LE(offset, 42);       // local header offset
    nameBuf.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const cd      = Buffer.concat(centrals);
  const cdStart = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);

  return Buffer.concat([...locals, cd, eocd]);
}
