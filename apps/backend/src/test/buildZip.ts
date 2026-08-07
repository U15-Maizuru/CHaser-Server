import { Buffer } from 'node:buffer';
import { writeZip } from '../tournament/zip.js';

// テスト用に最小の ZIP を組み立てる。組み立て自体は本番の writeZip (tournament/zip.ts) —
// 大会データの書き出しで使うものと同じ実装を通す。ここは文字列をそのまま body に
// 渡せるようにするだけの薄い包み。

export interface ZipSrcEntry {
  name: string;
  body: string | Buffer;
  /** true なら無圧縮 (method=0)。既定は deflate (method=8) */
  store?: boolean;
}

export function buildZip(entries: ZipSrcEntry[]): Buffer {
  return writeZip(entries.map(e => ({
    name: e.name,
    data: Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body, 'utf-8'),
    ...(e.store === undefined ? {} : { store: e.store }),
  })));
}
