import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ensureDirectories, handleHttpRequest } from './router.js';
import { RoomManager } from '../RoomManager.js';

const ROOM_ID = 'test-http-server';

describe('HttpServer', () => {
  let server: Server;
  let baseUrl: string;
  let rm: RoomManager;

  beforeAll(async () => {
    ensureDirectories();
    rm = new RoomManager();
    server = createServer((req, res) => handleHttpRequest(req, res, rm));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    rm.shutdown();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    fs.rmSync(path.resolve(`server/rooms/${ROOM_ID}`), { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(path.resolve(`server/rooms/${ROOM_ID}`), { recursive: true, force: true });
  });

  it('OPTIONS リクエストには 204 と CORS ヘッダーで応答する', async () => {
    const res = await fetch(`${baseUrl}/api/libs?slot=0&room=${ROOM_ID}`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  describe('GET /api/default-room', () => {
    it('ローカルルームが無い場合は 404', async () => {
      const res = await fetch(`${baseUrl}/api/default-room`);
      expect(res.status).toBe(404);
    });

    it('ローカルルームがあれば roomId と ports を返す', async () => {
      const room = rm.createRoom('local', [39301, 39302]);
      try {
        const res = await fetch(`${baseUrl}/api/default-room`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ roomId: 'local', ports: [39301, 39302] });
      } finally {
        rm.destroyRoom(room!.id);
      }
    });
  });

  describe('POST /api/upload/program', () => {
    it('slot パラメータが無ければ 400', async () => {
      const res = await fetch(`${baseUrl}/api/upload/program?room=${ROOM_ID}`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('room パラメータが無ければ 400', async () => {
      const res = await fetch(`${baseUrl}/api/upload/program?slot=0`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('許可されていない拡張子は 400', async () => {
      const form = new FormData();
      form.append('file', new Blob(['print(1)']), 'player.txt');
      const res = await fetch(`${baseUrl}/api/upload/program?slot=0&room=${ROOM_ID}`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(400);
    });

    it('.py ファイルを正常にアップロードできる', async () => {
      const form = new FormData();
      form.append('file', new Blob(['print("hello")']), 'player.py');
      const res = await fetch(`${baseUrl}/api/upload/program?slot=0&room=${ROOM_ID}`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.serverPath).toContain('player.py');
      expect(fs.existsSync(body.serverPath)).toBe(true);
    });

    it('上限サイズを超えるファイルは 413', async () => {
      const big = new Uint8Array(512 * 1024 + 1);
      const form = new FormData();
      form.append('file', new Blob([big]), 'big.py');
      const res = await fetch(`${baseUrl}/api/upload/program?slot=0&room=${ROOM_ID}`, {
        method: 'POST',
        body: form,
      });
      expect(res.status).toBe(413);
    });
  });

  describe('/api/programs (プログラムライブラリ)', () => {
    afterEach(() => {
      fs.rmSync(path.resolve('server/program-catalog'), { recursive: true, force: true });
    });

    it('.py ファイルをライブラリへアップロードでき、id ベースのパスと displayName を持つ entry が返る', async () => {
      const form = new FormData();
      form.append('file', new Blob(['print("hello")']), 'main.py');
      const res = await fetch(`${baseUrl}/api/programs`, { method: 'POST', body: form });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.entry.displayName).toBe('main.py');
      expect(body.entry.demoEnabled).toBe(true);
      expect(body.serverPath).toBe(body.entry.programPath);
      expect(fs.existsSync(body.entry.programPath)).toBe(true);
    });

    it('許可されていない拡張子は 400', async () => {
      const form = new FormData();
      form.append('file', new Blob(['not a program']), 'note.txt');
      const res = await fetch(`${baseUrl}/api/programs`, { method: 'POST', body: form });
      expect(res.status).toBe(400);
    });

    it('一覧取得・デモ対象フラグの更新・削除ができる', async () => {
      const form = new FormData();
      form.append('file', new Blob(['print(1)']), 'main.py');
      const uploadRes = await fetch(`${baseUrl}/api/programs`, { method: 'POST', body: form });
      const { entry } = await uploadRes.json();

      const listRes = await fetch(`${baseUrl}/api/programs`);
      expect(listRes.status).toBe(200);
      const { entries } = await listRes.json();
      expect(entries.map((e: { id: string }) => e.id)).toContain(entry.id);

      const patchRes = await fetch(`${baseUrl}/api/programs/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoEnabled: false }),
      });
      expect(patchRes.status).toBe(200);
      const { entry: patched } = await patchRes.json();
      expect(patched.demoEnabled).toBe(false);

      const deleteRes = await fetch(`${baseUrl}/api/programs/${entry.id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(204);

      const listAfter = await fetch(`${baseUrl}/api/programs`);
      const { entries: entriesAfter } = await listAfter.json();
      expect(entriesAfter.map((e: { id: string }) => e.id)).not.toContain(entry.id);
      expect(fs.existsSync(entry.programPath)).toBe(false);
    });

    it('同名ファイルを複数回アップロードしても on-disk では衝突しない', async () => {
      const upload = (content: string) => {
        const form = new FormData();
        form.append('file', new Blob([content]), 'main.py');
        return fetch(`${baseUrl}/api/programs`, { method: 'POST', body: form }).then(r => r.json());
      };
      const { entry: a } = await upload('A');
      const { entry: b } = await upload('B');

      expect(a.id).not.toBe(b.id);
      expect(a.programPath).not.toBe(b.programPath);
      expect(fs.readFileSync(a.programPath, 'utf-8')).toBe('A');
      expect(fs.readFileSync(b.programPath, 'utf-8')).toBe('B');
    });
  });

  describe('GET/DELETE /api/libs', () => {
    it('アップロード済みライブラリを一覧・削除できる', async () => {
      const uploadForm = new FormData();
      uploadForm.append('file', new Blob(['# lib']), 'mylib.py');
      const uploadRes = await fetch(`${baseUrl}/api/upload/library?slot=1&room=${ROOM_ID}`, {
        method: 'POST',
        body: uploadForm,
      });
      expect(uploadRes.status).toBe(200);

      const listRes = await fetch(`${baseUrl}/api/libs?slot=1&room=${ROOM_ID}`);
      expect(listRes.status).toBe(200);
      const { files } = await listRes.json();
      expect(files).toContain('mylib.py');

      const deleteRes = await fetch(
        `${baseUrl}/api/libs/${encodeURIComponent('mylib.py')}?slot=1&room=${ROOM_ID}`,
        { method: 'DELETE' },
      );
      expect(deleteRes.status).toBe(204);

      const listAfter = await fetch(`${baseUrl}/api/libs?slot=1&room=${ROOM_ID}`);
      const { files: filesAfter } = await listAfter.json();
      expect(filesAfter).not.toContain('mylib.py');
    });

    it('未アップロードの room でも既定ライブラリ (pyCHaser) だけは自動配置され一覧に含まれる', async () => {
      const res = await fetch(`${baseUrl}/api/libs?slot=0&room=nonexistent-room-xyz`);
      expect(res.status).toBe(200);
      const { files } = await res.json();
      expect(files).toEqual(['pyCHaser.py']);
    });
  });

  it('未知のパスは 404', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
  });

  describe('BGM (music)', () => {
    afterEach(() => {
      fs.rmSync(path.resolve('server/music'), { recursive: true, force: true });
    });

    it('許可されていない拡張子は 400', async () => {
      const form = new FormData();
      form.append('file', new Blob(['not audio']), 'note.txt');
      const res = await fetch(`${baseUrl}/api/upload/music`, { method: 'POST', body: form });
      expect(res.status).toBe(400);
    });

    it('mp3 をアップロードして一覧・再生取得できる', async () => {
      const form = new FormData();
      form.append('file', new Blob(['fake mp3 bytes']), 'theme.mp3');
      const uploadRes = await fetch(`${baseUrl}/api/upload/music`, { method: 'POST', body: form });
      expect(uploadRes.status).toBe(200);

      const listRes = await fetch(`${baseUrl}/api/music`);
      expect(listRes.status).toBe(200);
      const { files } = await listRes.json();
      expect(files).toContain('theme.mp3');

      const playRes = await fetch(`${baseUrl}/api/music/${encodeURIComponent('theme.mp3')}`);
      expect(playRes.status).toBe(200);
      expect(playRes.headers.get('content-type')).toBe('audio/mpeg');
      expect(await playRes.text()).toBe('fake mp3 bytes');
    });

    it('存在しないファイルの再生取得は 404', async () => {
      const res = await fetch(`${baseUrl}/api/music/${encodeURIComponent('nothing.mp3')}`);
      expect(res.status).toBe(404);
    });

    it('BGM フォルダが無い場合の一覧取得は空配列', async () => {
      const res = await fetch(`${baseUrl}/api/music`);
      expect(res.status).toBe(200);
      const { files } = await res.json();
      expect(files).toEqual([]);
    });
  });
});
