import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerManager } from './ServerManager.js';
import { MapManager } from './MapManager.js';
import { addCatalogEntry, catalogDir, ensureCatalogDir, setDemoEnabled } from '../programCatalog.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeTempProgramFile(content = 'not a real program'): string {
  const file = path.join(os.tmpdir(), `u15-catalog-test-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(file, content);
  return file;
}

// ログを cwd 直下ではなく一時ディレクトリに書かせ、テスト実行のたびに game-*.log が
// リポジトリ内に散らからないようにする
const TEST_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'u15-server-manager-test-'));
afterAll(() => fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true }));

function makeServerManager(...args: ConstructorParameters<typeof ServerManager>): ServerManager {
  const sm = new ServerManager(...args);
  sm.setLogDir(TEST_LOG_DIR);
  return sm;
}

/** 固定 sleep だと CI/並列実行時の負荷でタイマー連鎖が間に合わずフレーキーになるため、ポーリングで待つ */
async function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
}

describe('ServerManager', () => {
  let sm: ServerManager | undefined;

  afterEach(() => {
    sm?.shutdown();
    sm = undefined;
  });

  it('構築直後は phase=setup で、指定した port を各スロットに保持する', () => {
    sm = makeServerManager([39400, 39401], 0);
    const status = sm.getStatus();
    expect(status.phase).toBe('setup');
    expect(status.clients[0].port).toBe(39400);
    expect(status.clients[1].port).toBe(39401);
  });

  it('setClientType(cpu) はスロットを即座に ready にする', async () => {
    sm = makeServerManager([39402, 39403], 0);
    await sm.setClientType(0, 'cpu');
    const status = sm.getStatus();
    expect(status.clients[0]).toMatchObject({ type: 'cpu', state: 'ready', name: 'CPU' });
  });

  it('setClientType(manual) はスロットを即座に ready にする', async () => {
    sm = makeServerManager([39404, 39405], 0);
    await sm.setClientType(1, 'manual');
    const status = sm.getStatus();
    expect(status.clients[1]).toMatchObject({ type: 'manual', state: 'ready', name: '手動操作' });
  });

  it('requestStart は全スロットが ready でなければ何もしない', async () => {
    sm = makeServerManager([39406, 39407], 0);
    await sm.setClientType(0, 'cpu'); // slot1 は未接続のまま
    await sm.requestStart();
    expect(sm.getStatus().phase).toBe('setup');
  });

  it('CPU vs CPU で1試合を最後まで実行し finished になる', async () => {
    sm = makeServerManager([39408, 39409], 0);
    sm.setTurnDelay(0);
    await sm.setClientType(0, 'cpu');
    await sm.setClientType(1, 'cpu');

    await sm.requestStart();

    const status = sm.getStatus();
    expect(status.phase).toBe('finished');
    expect(status.roundResults).toHaveLength(1);
    expect(status.roundResults[0].winner).toBeDefined();
  });

  describe('スロット初期化ロジックの重複3経路 (Phase 2 分割時の回帰ベースライン)', () => {
    it('deleteProgram は setup フェーズ以外では無視される (プレイ中ガード)', async () => {
      sm = makeServerManager([39410, 39411], 0);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      const startPromise = sm.requestStart();
      // requestStart は最初の await (session.run) の前に同期的に phase を 'playing' にする
      expect(sm.getStatus().phase).toBe('playing');

      sm.deleteProgram(0); // ガードにより無視されるはず
      expect(sm.getStatus().phase).toBe('playing');
      expect(sm.getStatus().clients[0].type).toBe('cpu');

      await startPromise;
      expect(sm.getStatus().phase).toBe('finished');
    });

    it('requestReset はフェーズを問わず初期状態 (type=process含む) に戻す', async () => {
      sm = makeServerManager([39412, 39413], 0);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      await sm.requestStart();
      expect(sm.getStatus().phase).toBe('finished');

      await sm.requestReset();

      const status = sm.getStatus();
      expect(status.phase).toBe('setup');
      expect(status.currentRound).toBe(0);
      expect(status.roundResults).toEqual([]);
      expect(status.clients[0].type).toBe('process'); // DEFAULT_TYPE に戻る
      expect(status.clients[1].type).toBe('process');
    });

    it('requestNextRound は doubleMode でラウンド1・finished のときのみ次戦を準備する', async () => {
      sm = makeServerManager([39414, 39415], 0);
      sm.setTurnDelay(0);
      sm.setDoubleMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await sm.requestStart(); // 1試合目
      const afterRound1 = sm.getStatus();
      expect(afterRound1.phase).toBe('finished');
      expect(afterRound1.currentRound).toBe(1);
      expect(afterRound1.roundResults).toHaveLength(1);

      await sm.requestNextRound();
      const afterNextRound = sm.getStatus();
      expect(afterNextRound.phase).toBe('setup');
      expect(afterNextRound.currentRound).toBe(1);
      // cpu タイプはスワップ後も維持され、startListening で即座に ready に戻る
      expect(afterNextRound.clients[0].state).toBe('ready');
      expect(afterNextRound.clients[1].state).toBe('ready');

      await sm.requestStart(); // 2試合目
      const afterRound2 = sm.getStatus();
      expect(afterRound2.phase).toBe('finished');
      expect(afterRound2.roundResults).toHaveLength(2);
    });

    it('requestNextRound は doubleMode 無効時は無視される', async () => {
      sm = makeServerManager([39416, 39417], 0);
      await sm.requestNextRound();
      expect(sm.getStatus().phase).toBe('setup');
      expect(sm.getStatus().currentRound).toBe(0);
    });
  });

  describe('マップ設定変更のガード (2試合制で第1試合・第2試合のマップが変わらないようにする)', () => {
    it('通常の初回セットアップ中 (setup, roundResults=[]) は setMapParams が反映される', () => {
      sm = makeServerManager([39440, 39441], 0);
      const regenerateSpy = vi.spyOn(MapManager.prototype, 'regenerate');
      sm.setMapParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
      expect(regenerateSpy).toHaveBeenCalledTimes(1);
      regenerateSpy.mockRestore();
    });

    it('doubleMode で第1試合終了後・第2試合待機中の setup では setMapParams が無視される', async () => {
      sm = makeServerManager([39442, 39443], 0);
      sm.setTurnDelay(0);
      sm.setDoubleMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await sm.requestStart(); // 1試合目
      await sm.requestNextRound(); // phase は 'setup' に戻るが roundResults は残る
      expect(sm.getStatus().phase).toBe('setup');
      expect(sm.getStatus().roundResults).toHaveLength(1);

      const regenerateSpy = vi.spyOn(MapManager.prototype, 'regenerate');
      sm.setMapParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
      sm.loadMap('does-not-exist');
      sm.loadMapData({
        field: [[0]], size: { x: 1, y: 1 }, turn: 10,
        teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      });
      expect(regenerateSpy).not.toHaveBeenCalled();
      expect(sm.getStatus().mapSource.kind).toBe('random'); // loadMapData も無視されている
      regenerateSpy.mockRestore();
    });

    it('requestReset 後 (roundResults がリセットされる) は setMapParams が再び反映される', async () => {
      sm = makeServerManager([39444, 39445], 0);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      await sm.requestStart();
      await sm.requestReset();
      expect(sm.getStatus().roundResults).toEqual([]);

      const regenerateSpy = vi.spyOn(MapManager.prototype, 'regenerate');
      sm.setMapParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
      expect(regenerateSpy).toHaveBeenCalledTimes(1);
      regenerateSpy.mockRestore();
    });
  });

  describe('repeatMode', () => {
    it('requestRepeat は repeatMode 無効時は無視される', async () => {
      sm = makeServerManager([39418, 39419], 0);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      await sm.requestStart();
      expect(sm.getStatus().phase).toBe('finished');

      await sm.requestRepeat();
      expect(sm.getStatus().phase).toBe('finished'); // 無視されたまま
    });

    it('requestRepeat は接続 (type) を維持したままスワップし、新しい対戦として再開できる状態にする', async () => {
      sm = makeServerManager([39420, 39421], 0);
      sm.setTurnDelay(0);
      sm.setRepeatMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      await sm.requestStart();
      expect(sm.getStatus().phase).toBe('finished');
      expect(sm.getStatus().roundResults).toHaveLength(1);

      await sm.requestRepeat();

      const status = sm.getStatus();
      expect(status.phase).toBe('setup');
      expect(status.currentRound).toBe(0);
      expect(status.roundResults).toEqual([]); // 新しい対戦として集計がリセットされる
      // cpu タイプは維持されたまま (requestReset のように process には戻らない)
      expect(status.clients[0].type).toBe('cpu');
      expect(status.clients[1].type).toBe('cpu');
      expect(status.clients[0].state).toBe('ready');
      expect(status.clients[1].state).toBe('ready');
    });

    it('requestRepeat は試合が終了していなければ無視される', async () => {
      sm = makeServerManager([39422, 39423], 0);
      sm.setRepeatMode(true);
      await sm.requestRepeat(); // まだ setup フェーズ
      expect(sm.getStatus().phase).toBe('setup');
    });
  });

  describe('demoMode', () => {
    const FAST_DEMO_DELAYS = { start: 10, nextRound: 10, repeat: 10 };

    it('demoMode 有効時、両スロットが ready になったら自動的に対戦を開始する', async () => {
      sm = makeServerManager([39424, 39425], 0, FAST_DEMO_DELAYS);
      sm.setTurnDelay(0);
      sm.setDemoMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      expect(sm.getStatus().phase).toBe('setup'); // まだ自動開始タイマー待ち

      await waitFor(() => sm!.getStatus().phase === 'finished'); // CPU戦は即座に終わるので finished まで進む
    });

    it('demoMode 無効時は自動開始しない', async () => {
      sm = makeServerManager([39426, 39427], 0, FAST_DEMO_DELAYS);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await sleep(200);
      expect(sm.getStatus().phase).toBe('setup');
    });

    it('demoMode + repeatMode 併用時、対戦終了後に自動でリピートする', async () => {
      sm = makeServerManager([39428, 39429], 0, FAST_DEMO_DELAYS);
      sm.setTurnDelay(0);
      sm.setDemoMode(true);
      sm.setRepeatMode(true);

      // roundResults.length だけでは「1試合目終了」と「リピート後の新しい1試合目終了」を
      // 区別できない (どちらも length===1) ため、finished への遷移回数をイベントで数える
      let finishedCount = 0;
      sm.on('status', (status) => {
        if (status.phase === 'finished') finishedCount++;
      });

      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await waitFor(() => finishedCount >= 2); // 1試合目 + リピート後の2試合目
      expect(sm.getStatus().phase).toBe('finished');
      expect(sm.getStatus().roundResults).toHaveLength(1); // リピートで集計がリセットされている
    });

    it('setDemoMode(false) にすると予約済みの自動開始タイマーを止める', async () => {
      sm = makeServerManager([39430, 39431], 0, FAST_DEMO_DELAYS);
      sm.setTurnDelay(0);
      sm.setDemoMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      expect(sm.getStatus().phase).toBe('setup');

      sm.setDemoMode(false);
      await sleep(200);
      expect(sm.getStatus().phase).toBe('setup'); // 自動開始されない
    });
  });

  describe('demoMode + プログラムライブラリ', () => {
    beforeEach(() => {
      ensureCatalogDir();
    });

    afterEach(() => {
      fs.rmSync(catalogDir(), { recursive: true, force: true });
    });

    it('ライブラリが空なら setDemoMode(true) は何もしない (スロットは待機のまま)', async () => {
      sm = makeServerManager([39432, 39433], 0);
      sm.setDemoMode(true);
      await sleep(200);

      const status = sm.getStatus();
      expect(status.clients[0].state).toBe('waiting');
      expect(status.clients[1].state).toBe('waiting');
      expect(status.clients[0].error).toBeUndefined();
    });

    it('デモ対象プログラムが1件あれば setDemoMode(true) で両スロットに割り当てられる', async () => {
      addCatalogEntry('dummy.py', writeTempProgramFile());

      sm = makeServerManager([39434, 39435], 0);
      sm.setDemoMode(true);

      // processConfig が割り当てられると spawn が試みられ、成功 (ready) か失敗 (error) のいずれかに
      // 遷移する。カタログが空のときは silent に 'waiting' のままなので、この遷移自体が
      // randomizeFromCatalog が実際に動作した証跡になる。
      await waitFor(() => {
        const c = sm!.getStatus().clients[0];
        return c.state === 'ready' || c.error !== undefined;
      });
      expect(sm.getStatus().clients[0].type).toBe('process');
      expect(sm.getStatus().clients[1].type).toBe('process');
    });

    it('デモ対象 (demoEnabled=false) のプログラムは選ばれない', async () => {
      const entry = addCatalogEntry('dummy.py', writeTempProgramFile());
      setDemoEnabled(entry.id, false);

      sm = makeServerManager([39436, 39437], 0);
      sm.setDemoMode(true);
      await sleep(200);

      expect(sm.getStatus().clients[0].state).toBe('waiting');
      expect(sm.getStatus().clients[0].error).toBeUndefined();
    });
  });
});
