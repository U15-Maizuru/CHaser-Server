import { afterEach, describe, expect, it } from 'vitest';
import { ServerManager } from './ServerManager.js';

describe('ServerManager', () => {
  let sm: ServerManager | undefined;

  afterEach(() => {
    sm?.shutdown();
    sm = undefined;
  });

  it('構築直後は phase=setup で、指定した port を各スロットに保持する', () => {
    sm = new ServerManager([39400, 39401]);
    const status = sm.getStatus();
    expect(status.phase).toBe('setup');
    expect(status.clients[0].port).toBe(39400);
    expect(status.clients[1].port).toBe(39401);
  });

  it('setClientType(cpu) はスロットを即座に ready にする', async () => {
    sm = new ServerManager([39402, 39403]);
    await sm.setClientType(0, 'cpu');
    const status = sm.getStatus();
    expect(status.clients[0]).toMatchObject({ type: 'cpu', state: 'ready', name: 'CPU' });
  });

  it('setClientType(manual) はスロットを即座に ready にする', async () => {
    sm = new ServerManager([39404, 39405]);
    await sm.setClientType(1, 'manual');
    const status = sm.getStatus();
    expect(status.clients[1]).toMatchObject({ type: 'manual', state: 'ready', name: '手動操作' });
  });

  it('requestStart は全スロットが ready でなければ何もしない', async () => {
    sm = new ServerManager([39406, 39407]);
    await sm.setClientType(0, 'cpu'); // slot1 は未接続のまま
    await sm.requestStart();
    expect(sm.getStatus().phase).toBe('setup');
  });

  it('CPU vs CPU で1試合を最後まで実行し finished になる', async () => {
    sm = new ServerManager([39408, 39409]);
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
      sm = new ServerManager([39410, 39411]);
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
      sm = new ServerManager([39412, 39413]);
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
      sm = new ServerManager([39414, 39415]);
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
      sm = new ServerManager([39416, 39417]);
      await sm.requestNextRound();
      expect(sm.getStatus().phase).toBe('setup');
      expect(sm.getStatus().currentRound).toBe(0);
    });
  });
});
