import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import busboy from 'busboy';

// HttpServer とルートモジュール (tournament/httpRoutes 等) で共有する下ごしらえ。
// HttpServer 側に置くと、そこから読み込まれるルートモジュールとの循環参照になるため独立させてある。

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message });
}

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}'));
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * JSON ボディを読んでハンドラへ渡す。壊れたボディは共通の 400 で返す。
 * ルートごとに .then().catch(() => badRequest(...)) を書き写すのをやめるための薄い包み。
 */
export function withJsonBody(
  req: IncomingMessage, res: ServerResponse, handler: (body: unknown) => void,
): void {
  readJsonBody(req)
    .then(handler)
    .catch(() => badRequest(res, '不正なリクエストボディです'));
}

/**
 * ルーム固有のルートが必ず要求する ?room=<id>&slot=0|1 を取り出す。
 * 足りなければ 400 を返して null を返す (呼び出し側はそのまま return する)。
 */
export function requireRoomSlot(url: URL, res: ServerResponse): { room: string; slot: 0 | 1 } | null {
  const slot = url.searchParams.get('slot');
  const room = url.searchParams.get('room');
  if (slot !== '0' && slot !== '1') { badRequest(res, 'slot は 0 か 1 を指定してください'); return null; }
  if (!room) { badRequest(res, 'room パラメータが必要です'); return null; }
  return { room, slot: slot === '0' ? 0 : 1 };
}

export function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-　-鿿]/g, '_');
}

/** 非 ASCII を落とした、古いブラウザ向けのフォールバック名 */
function asciiFallbackName(name: string): string {
  const base = path.basename(name).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return base.trim() === '' || base.replace(/_/g, '') === '' ? `download${path.extname(name)}` : base;
}

/**
 * 日本語ファイル名でも落とせるダウンロードヘッダ。
 * filename は古いブラウザ向けの ASCII、filename* が本来の名前。
 */
function contentDisposition(downloadName: string): string {
  const encoded = encodeURIComponent(downloadName);
  return `attachment; filename="${asciiFallbackName(downloadName)}"; filename*=UTF-8''${encoded}`;
}

/**
 * ファイルをダウンロード用に配信する。
 * onSent は送信完了後に呼ぶ (一時ファイル削除用)。
 */
export function sendFileDownload(
  res: ServerResponse, filePath: string, downloadName: string, onSent?: () => void,
): void {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': contentDisposition(downloadName),
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  if (onSent) stream.on('close', onSent);
}

/**
 * メモリ上の中身をそのままダウンロードさせる (CSV / JSON / ZIP のエクスポート用)。
 * extraHeaders はダウンロードと一緒に返したい付帯情報用 (値は ASCII にしておくこと)。
 */
export function sendTextDownload(
  res: ServerResponse, body: string | Buffer, downloadName: string, contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(downloadName),
    ...extraHeaders,
  });
  res.end(body);
}

/** アップロードを中断し、残りのリクエストボディを読み捨てる (busboy への書き込みを止めて未捕捉例外を防ぐ) */
function abortUpload(req: IncomingMessage, bb: ReturnType<typeof busboy>, stream: Readable): void {
  stream.resume();
  req.unpipe(bb);
  req.resume();
}

export function handleUpload(
  req:             IncomingMessage,
  res:             ServerResponse,
  dir:             string,
  allowed:         string[],
  maxBytes:        number,
  onSaved?:        (outPath: string, originalFilename: string) => Record<string, unknown> | void,
  outputFilename?: (ext: string) => string,
): void {
  let bb: ReturnType<typeof busboy>;
  try {
    // busboy は既定では Content-Disposition の filename を素通りさせるだけで、Node が
    // HTTP ヘッダーを latin1 として読む都合上マルチバイト文字が文字化けする。
    // defParamCharset: 'utf8' でバイト列を UTF-8 として読み直させる。
    bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes }, defParamCharset: 'utf8' });
  } catch {
    badRequest(res, 'Content-Type が multipart/form-data ではありません');
    return;
  }

  let fileSeen   = false; // multipart に file パートが存在したか (同期的に確定)
  let serverPath = '';

  bb.on('file', (_field, stream, info) => {
    fileSeen = true;
    const ext = path.extname(info.filename).toLowerCase();
    if (!allowed.includes(ext)) {
      abortUpload(req, bb, stream);
      badRequest(res, `許可されていない拡張子です (${allowed.join(', ')} のみ)`);
      return;
    }

    const safe    = outputFilename ? outputFilename(ext) : sanitizeFilename(info.filename);
    const outPath = path.join(dir, safe);
    serverPath    = outPath;

    const out = fs.createWriteStream(outPath);
    out.on('error', () => {}); // limit到達によるdestroy()後の書き込み完了コールバックが
                                // 'error' を発火した際に未捕捉例外化するのを防ぐ
    stream.pipe(out);
    stream.on('limit', () => {
      stream.unpipe(out);
      out.destroy();
      fs.unlink(outPath, () => {});
      abortUpload(req, bb, stream);
      json(res, 413, { error: `ファイルサイズが上限 (${maxBytes / 1024}KB) を超えています` });
    });
    out.on('close', () => {
      // ディスク書き込み完了を待ってから成功レスポンスを返す
      // (bb の close は out の close より先に発火しうるため、bb 側では返さない)
      if (!res.headersSent) {
        const extra = onSaved?.(outPath, info.filename);
        json(res, 200, { serverPath, ...(extra ?? {}) });
      }
    });
  });

  bb.on('close', () => {
    if (!fileSeen && !res.headersSent) {
      badRequest(res, 'ファイルが含まれていません');
    }
  });

  bb.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'アップロード処理中にエラーが発生しました' }));
    }
  });

  req.pipe(bb);
}
