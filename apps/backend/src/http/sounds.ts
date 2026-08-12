import fs from 'node:fs';
import path from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { SOUND_KEYS, type SoundKey } from '@u15/ws-types';
import { badRequest, handleUpload, json, sanitizeFilename } from '../network/httpUtil.js';
import { SOUND_DIR, SOUND_EXTENSIONS } from './paths.js';

// SE の差し替えファイルの一覧・配信・アップロード・削除。SE 本体はフロントエンドに同梱されており、
// ここに同じ名前で置かれたものがそれより優先される。
//
// BGM (music.ts) と違い「自由な名前で蓄積して選ぶ」構造ではない。場面ごとに名前 (SoundKey) が
// 決まっていて選ぶ余地がないため、アップロードは「この場面キーを差し替える」1本だけで、
// 保存ファイル名は常にサーバー側で場面キーへ強制する。

const MAX_SOUND_BYTES = 20 * 1024 * 1024; // SE は数秒の短い音なので BGM (100MB) よりずっと小さくてよい

/** 処理したら true。false なら router が後続のルートを試す */
export function handleSoundRequest(
  req: IncomingMessage, res: ServerResponse, url: URL,
): boolean {
  // GET /api/sounds → 差し替えファイルの一覧。載っていない音は同梱分が鳴る
  if (req.method === 'GET' && url.pathname === '/api/sounds') {
    const files = fs.existsSync(SOUND_DIR)
      ? fs.readdirSync(SOUND_DIR).filter(f => SOUND_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      : [];
    json(res, 200, { files });
    return true;
  }

  // POST /api/upload/sounds/:key → 差し替えアップロード。ファイル名は key に強制する
  const uploadMatch = url.pathname.match(/^\/api\/upload\/sounds\/(.+)$/);
  if (req.method === 'POST' && uploadMatch) {
    const key = decodeURIComponent(uploadMatch[1]!);
    if (!SOUND_KEYS.includes(key as SoundKey)) {
      badRequest(res, `不明な SE キーです: ${key}`);
      return true;
    }
    fs.mkdirSync(SOUND_DIR, { recursive: true });
    handleUpload(
      req, res, SOUND_DIR, SOUND_EXTENSIONS, MAX_SOUND_BYTES,
      (outPath) => {
        // 同じ key の別拡張子が残っていると、拡張子非依存でマッチする再生側 (useSound.ts) で
        // どちらが優先されるか不定になるため、新しく保存した拡張子以外は消しておく
        for (const ext of SOUND_EXTENSIONS) {
          const other = path.join(SOUND_DIR, `${key}${ext}`);
          if (other !== outPath && fs.existsSync(other)) fs.unlinkSync(other);
        }
      },
      ext => `${key}${ext}`,
    );
    return true;
  }

  // GET/DELETE /api/sounds/:filename
  const soundMatch = url.pathname.match(/^\/api\/sounds\/(.+)$/);
  if (soundMatch) {
    const filename = sanitizeFilename(decodeURIComponent(soundMatch[1]!));
    const filepath = path.join(SOUND_DIR, filename);

    // DELETE /api/sounds/:filename → 差し替えファイルを削除し、同梱の音に戻す
    if (req.method === 'DELETE') {
      if (filename && fs.existsSync(filepath)) fs.unlinkSync(filepath);
      res.writeHead(204);
      res.end();
      return true;
    }

    // GET /api/sounds/:filename → SE の再生用ストリーム
    if (req.method === 'GET') {
      if (!filename || !fs.existsSync(filepath)) {
        res.writeHead(404);
        res.end('Not found');
        return true;
      }
      const ext = path.extname(filepath).toLowerCase();
      res.writeHead(200, { 'Content-Type': ext === '.wav' ? 'audio/wav' : 'audio/mpeg' });
      fs.createReadStream(filepath).pipe(res);
      return true;
    }
  }

  return false;
}
