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

  it('CPU vs CPU で1ゲームを最後まで実行し finished になる', async () => {
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

    it('対戦中の requestReset (中断) はターン処理を打ち切り、後から古い結果で状態を上書きしない', async () => {
      sm = makeServerManager([39441, 39442], 0);
      sm.setTurnDelay(50); // 0 だと一瞬で試合が終わってしまい、中断のタイミングを作れない
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      const startPromise = sm.requestStart();
      expect(sm.getStatus().phase).toBe('playing');

      await sm.requestReset();
      expect(sm.getStatus().phase).toBe('setup');

      // 中断前に投げた requestStart は裏で進んでいた対戦の決着を待って戻ってくるが、
      // 戻ってきた時点で既に古い世代なので round/status を書き換えてはいけない
      await startPromise;

      const status = sm.getStatus();
      expect(status.phase).toBe('setup');
      expect(status.roundResults).toEqual([]);
    });

    it('requestNextRound は doubleMode で第1ゲーム・finished のときのみ第2ゲームを準備する', async () => {
      sm = makeServerManager([39414, 39415], 0);
      sm.setTurnDelay(0);
      sm.setDoubleMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await sm.requestStart(); // 第1ゲーム
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

      await sm.requestStart(); // 第2ゲーム
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

  describe('setPorts', () => {
    it('ローカルモードの setup 中は指定したポートに変わる', async () => {
      sm = makeServerManager([39460, 39461], 0);
      await sm.setPorts([39462, 39463]);
      const status = sm.getStatus();
      expect(status.clients[0].port).toBe(39462);
      expect(status.clients[1].port).toBe(39463);
    });

    it('web モード (localMode=false) では無視される', async () => {
      sm = makeServerManager([39464, 39465], 0, undefined, false);
      await sm.setPorts([39466, 39467]);
      const status = sm.getStatus();
      expect(status.clients[0].port).toBe(39464);
      expect(status.clients[1].port).toBe(39465);
    });

    it('setup フェーズ以外では無視される (対戦中ガード)', async () => {
      sm = makeServerManager([39468, 39469], 0);
      sm.setTurnDelay(0);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      const startPromise = sm.requestStart();
      expect(sm.getStatus().phase).toBe('playing');

      await sm.setPorts([39470, 39471]); // ガードにより無視されるはず
      expect(sm.getStatus().clients[0].port).toBe(39468);
      expect(sm.getStatus().clients[1].port).toBe(39469);

      await startPromise;
    });
  });

  describe('マップ設定変更のガード (2ゲーム制で第1ゲーム・第2ゲームのマップが変わらないようにする)', () => {
    it('通常の初回セットアップ中 (setup, roundResults=[]) は setMapParams が反映される', () => {
      sm = makeServerManager([39440, 39441], 0);
      const regenerateSpy = vi.spyOn(MapManager.prototype, 'regenerate');
      sm.setMapParams({ itemNum: 11, blockNum: 4, turnNum: 50, mirror: false });
      expect(regenerateSpy).toHaveBeenCalledTimes(1);
      regenerateSpy.mockRestore();
    });

    it('doubleMode で第1ゲーム終了後・第2ゲーム待機中の setup では setMapParams が無視される', async () => {
      sm = makeServerManager([39442, 39443], 0);
      sm.setTurnDelay(0);
      sm.setDoubleMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await sm.requestStart(); // 第1ゲーム
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

    // 大会運営が「予選は固定マップ、決勝はランダム生成」のように回戦ごとに使い分けたとき、
    // 決勝の準備 (armMatch) は mapForMatch が null (ランダム) を返す。このとき何もしないと
    // MapManager が「ライブラリ由来は引き直さない」設計のせいで予選のマップが決勝に残ってしまう。
    it('generateRandomMap はライブラリ・エディタ由来のマップからランダム生成へ明示的に戻す', () => {
      sm = makeServerManager([39446, 39447], 0);
      sm.loadMapData({
        field: [[0]], size: { x: 1, y: 1 }, turn: 10,
        teamFirstPoint: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      });
      expect(sm.getStatus().mapSource.kind).toBe('editor');

      sm.generateRandomMap();
      expect(sm.getStatus().mapSource.kind).toBe('random');
    });

    it('generateRandomMap も setMapParams と同じガードに従う (2ゲーム制の第2ゲーム待機中は無視)', async () => {
      sm = makeServerManager([39448, 39449], 0);
      sm.setTurnDelay(0);
      sm.setDoubleMode(true);
      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');
      await sm.requestStart();
      await sm.requestNextRound();
      expect(sm.getStatus().roundResults).toHaveLength(1);

      const regenerateSpy = vi.spyOn(MapManager.prototype, 'regenerate');
      sm.generateRandomMap();
      expect(regenerateSpy).not.toHaveBeenCalled();
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

      // roundResults.length だけでは「第1ゲーム終了」と「リピート後の新しい第1ゲーム終了」を
      // 区別できない (どちらも length===1) ため、finished への遷移回数をイベントで数える
      let finishedCount = 0;
      sm.on('status', (status) => {
        if (status.phase === 'finished') finishedCount++;
      });

      await sm.setClientType(0, 'cpu');
      await sm.setClientType(1, 'cpu');

      await waitFor(() => finishedCount >= 2); // 第1ゲーム + リピート後の第2ゲーム
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

  describe('persistSettings (表示・BGM/SE・対戦ルールのローカル永続化)', () => {
    let settingsPath: string;

    beforeEach(() => {
      settingsPath = path.join(TEST_LOG_DIR, `local-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    });

    it('無効時 (デフォルト) は setDisplayPrefs 等を呼んでもファイルを作らない', () => {
      sm = makeServerManager([39450, 39451], 0);
      sm.setDarkMode(true);
      sm.setDisplayPrefs({ theme: 'RPG' });
      sm.setDoubleMode(true);
      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it('有効時、設定変更のたびに現在値をファイルへ書く', () => {
      sm = new ServerManager([39452, 39453], 0, undefined, true, { persistSettings: true, localSettingsPath: settingsPath });
      sm.setDarkMode(true);
      sm.setDisplayPrefs({ theme: 'RPG', displayTitle: 'テスト大会' });
      sm.setDoubleMode(true);
      sm.setRepeatMode(true);

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.darkMode).toBe(true);
      expect(saved.displayPrefs).toMatchObject({ theme: 'RPG', displayTitle: 'テスト大会' });
      expect(saved.doubleMode).toBe(true);
      expect(saved.repeatMode).toBe(true);
    });

    it('新しい ServerManager が同じファイルから前回の設定を読み込む (demoMode 含め、副作用なしで)', async () => {
      sm = new ServerManager([39454, 39455], 0, undefined, true, { persistSettings: true, localSettingsPath: settingsPath });
      sm.setDarkMode(true);
      sm.setDisplayPrefs({ theme: 'Heavy' });
      sm.setDoubleMode(true);
      sm.setRepeatMode(true);
      sm.setDemoMode(true); // カタログが空なので割り当ては起きないが、demoMode 自体は true になる
      await sleep(50);
      sm.shutdown();

      const randomizeSpy = vi.spyOn(
        ServerManager.prototype as unknown as { randomizeFromCatalog(): Promise<void> },
        'randomizeFromCatalog',
      );
      const sm2 = new ServerManager([39456, 39457], 0, undefined, true, { persistSettings: true, localSettingsPath: settingsPath });
      try {
        const status = sm2.getStatus();
        expect(status.darkMode).toBe(true);
        expect(status.displayPrefs.theme).toBe('Heavy');
        expect(status.doubleMode).toBe(true);
        expect(status.repeatMode).toBe(true);
        expect(status.demoMode).toBe(true);
        // 読み込みはフィールドへの直接代入で行われ、setDemoMode() のような副作用 (カタログからの
        // ランダム割当) は起きない
        expect(randomizeSpy).not.toHaveBeenCalled();
      } finally {
        sm2.shutdown();
        randomizeSpy.mockRestore();
      }
    });
  });
});
