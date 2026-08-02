import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handleHttpRequest } from '../network/HttpServer.js';
import { catalogDir, ensureCatalogDir } from '../programCatalog.js';
import { ensureTournamentDir, tournamentRootDir } from './TournamentStore.js';

const DEF = {
  name: 'HTTPテスト杯',
  format: 'single-elimination',
  participants: [
    { id: 'p1', name: 'A', seed: 1, program: { builtin: 'cpu' } },
    { id: 'p2', name: 'B', seed: 2, program: { builtin: 'cpu' } },
  ],
};

function writeTournament(id: string, def: unknown): void {
  const dir = path.join(tournamentRootDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tournament.json'), JSON.stringify(def, null, 2));
}

describe('/api/tournament', () => {
  let server: Server;
  let baseUrl: string;
  let bound: string | null = null;

  beforeAll(async () => {
    ensureTournamentDir();
    ensureCatalogDir();
    server = createServer((req, res) =>
      handleHttpRequest(req, res, undefined, { boundRoomOf: id => (bound === id ? 'local' : null) }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    fs.rmSync(catalogDir(), { recursive: true, force: true });
  });

  afterEach(() => {
    bound = null;
    fs.rmSync(tournamentRootDir(), { recursive: true, force: true });
    ensureTournamentDir();
  });

  it('GET /api/tournament は空の一覧を返す', async () => {
    const res = await fetch(`${baseUrl}/api/tournament`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: [], errors: [] });
  });

  it('POST /api/tournament/scan がフォルダを検出する', async () => {
    writeTournament('cup-a', DEF);
    const res  = await fetch(`${baseUrl}/api/tournament/scan`, { method: 'POST' });
    const body = await res.json() as { imported: { id: string; name: string }[] };

    expect(res.status).toBe(200);
    expect(body.imported).toHaveLength(1);
    expect(body.imported[0]!.id).toBe('cup-a');
    expect(body.imported[0]!.name).toBe('HTTPテスト杯');
  });

  it('固定セグメント scan が :id より先に判定される', async () => {
    // 'scan' という名前の大会があっても scan が優先される (ルーティング順序の回帰テスト)
    writeTournament('scan', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/scan`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('imported');
  });

  it('POST /api/tournament/import が定義を取り込む', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...DEF, id: 'imported' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'imported' });
    expect(fs.existsSync(path.join(tournamentRootDir(), 'imported', 'tournament.json'))).toBe(true);
  });

  it('不正な定義の import は 400 と理由を返す', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/import`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: 'x', participants: [] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/participants が空/);
  });

  it('GET /api/tournament/:id は状態ペイロードを返す', async () => {
    writeTournament('cup-a', DEF);
    const res  = await fetch(`${baseUrl}/api/tournament/cup-a`);
    const body = await res.json() as { state: { matches: unknown[]; participants: unknown[] } };

    expect(res.status).toBe(200);
    expect(body.state.matches).toHaveLength(1); // 2人 → 決勝のみ
    expect(body.state.participants).toHaveLength(2);
  });

  it('存在しない大会は 404', async () => {
    const res = await fetch(`${baseUrl}/api/tournament/nope`);
    expect(res.status).toBe(404);
  });

  it('壊れた定義の取得は 400 と理由を返す', async () => {
    writeTournament('broken', { name: 'x', participants: [] });
    const res = await fetch(`${baseUrl}/api/tournament/broken`);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/participants が空/);
  });

  it('POST /api/tournament/:id/reset は進行を初期化する', async () => {
    writeTournament('cup-a', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/cup-a/reset`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('summary');
  });

  it('DELETE /api/tournament/:id は大会を削除する', async () => {
    writeTournament('cup-a', DEF);
    const res = await fetch(`${baseUrl}/api/tournament/cup-a`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-a'))).toBe(false);
  });

  it('運営中の大会は削除できない (409)', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const res = await fetch(`${baseUrl}/api/tournament/cup-a`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(fs.existsSync(path.join(tournamentRootDir(), 'cup-a'))).toBe(true);
  });

  describe('GET /api/tournament/:id/export', () => {
    it('matches.csv がヘッダ行付きで返る', async () => {
      writeTournament('cup-a', DEF);
      const res  = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=matches.csv`);
      const buf  = Buffer.from(await res.arrayBuffer());

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
      // Excel 対策の BOM。fetch の text() は仕様上 BOM を落とすので生バイトで確認する
      expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(buf.toString('utf-8')).toContain('試合ID');
    });

    it('format 省略時は JSON', async () => {
      writeTournament('cup-a', DEF);
      const res  = await fetch(`${baseUrl}/api/tournament/cup-a/export`);
      const body = await res.json() as { name: string };
      expect(res.status).toBe(200);
      expect(body.name).toBe('HTTPテスト杯');
    });

    it('standings.csv も返る', async () => {
      writeTournament('cup-a', { ...DEF, format: 'league' });
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=standings.csv`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('勝ち点');
    });

    it('未知の format は 400', async () => {
      writeTournament('cup-a', DEF);
      const res = await fetch(`${baseUrl}/api/tournament/cup-a/export?format=xlsx`);
      expect(res.status).toBe(400);
    });

    it('存在しない大会は 404', async () => {
      const res = await fetch(`${baseUrl}/api/tournament/nope/export`);
      expect(res.status).toBe(404);
    });
  });

  it('一覧には運営中の部屋が反映される', async () => {
    writeTournament('cup-a', DEF);
    bound = 'cup-a';
    const body = await (await fetch(`${baseUrl}/api/tournament`)).json() as
      { imported: { boundRoomId: string | null }[] };
    expect(body.imported[0]!.boundRoomId).toBe('local');
  });
});
