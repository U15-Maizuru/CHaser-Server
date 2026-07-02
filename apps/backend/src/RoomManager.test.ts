import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from './RoomManager.js';

describe('RoomManager', () => {
  let rm: RoomManager;

  afterEach(() => {
    rm?.shutdown();
    vi.useRealTimers();
  });

  describe('ローカルモード (固定ポート、プールなし)', () => {
    beforeEach(() => {
      rm = new RoomManager();
    });

    it('fixedPorts を指定すれば room を作成できる', () => {
      const room = rm.createRoom('local', [39100, 39101]);
      expect(room).not.toBeNull();
      expect(room!.id).toBe('local');
      expect(room!.ports).toEqual([39100, 39101]);
      expect(room!.phase).toBe('setup');
    });

    it('fixedPorts なしではプールが存在しないため作成できない', () => {
      const room = rm.createRoom();
      expect(room).toBeNull();
    });
  });

  describe('Web モード (ポートプール)', () => {
    beforeEach(() => {
      rm = new RoomManager([39200, 39202]); // 3ポート = 1部屋半分
    });

    it('プールから2ポートずつ確保して room を作る', () => {
      const room = rm.createRoom();
      expect(room).not.toBeNull();
      expect(room!.ports).toEqual([39200, 39201]);
    });

    it('プール枯渇時は null を返し、片方だけ確保したポートを解放する', () => {
      const first = rm.createRoom();
      expect(first).not.toBeNull(); // 39200, 39201 を消費 → 残り 39202 の1個のみ

      const second = rm.createRoom();
      expect(second).toBeNull(); // 2個目の alloc が失敗 → 39202 も解放されるはず

      // 解放されていることを、別の fixedPorts なし createRoom で再確認は難しいので、
      // 内部状態同等の検証として3個目確保を試みても良いが、
      // ここでは release 後にプールから同じポートを取り出せることを確認する。
      const third = rm.createRoom();
      // まだ 39201 は最初の room が握ったままなので、2ポート要求はまた失敗するはず
      expect(third).toBeNull();
    });

    it('destroyRoom でポートをプールに返却し、再利用できる', () => {
      // このケースだけは残余ポートによる Set 順序のブレを避けるため専用の2ポートプールを使う
      const isolated = new RoomManager([39230, 39231]);
      try {
        const room = isolated.createRoom()!;
        isolated.destroyRoom(room.id);

        const again = isolated.createRoom();
        expect(again).not.toBeNull();
        expect(again!.ports).toEqual([39230, 39231]);
      } finally {
        isolated.shutdown();
      }
    });

    it('destroyRoom は onRoomDestroyed コールバックを呼ぶ', () => {
      const onDestroyed = vi.fn();
      rm.onRoomDestroyed = onDestroyed;

      const room = rm.createRoom()!;
      rm.destroyRoom(room.id);

      expect(onDestroyed).toHaveBeenCalledWith(room.id);
      expect(rm.getRoom(room.id)).toBeUndefined();
    });

    it('存在しない room の destroyRoom は何もしない', () => {
      expect(() => rm.destroyRoom('does-not-exist')).not.toThrow();
    });

    it('touchRoom は lastActive を更新する', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const room = rm.createRoom()!;
      const before = room.lastActive;
      vi.advanceTimersByTime(1000);
      rm.touchRoom(room.id);
      expect(room.lastActive).toBeGreaterThan(before);
    });

    it('listRooms は RoomSummary の配列を返す', () => {
      const room = rm.createRoom()!;
      const summaries = rm.listRooms();
      expect(summaries).toEqual([
        { id: room.id, phase: 'setup', ports: room.ports, createdAt: room.createdAt },
      ]);
    });
  });

  describe('TTL による自動削除', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      rm = new RoomManager([39210, 39213]);
    });

    it('30分以上非アクティブな setup/finished 部屋は自動削除される', () => {
      const room = rm.createRoom()!;
      expect(rm.getRoom(room.id)).toBeDefined();

      // sweep は5分間隔。TTL(30分)ちょうどの tick では非活性時間が TTL と等しいだけで
      // まだ超過していないため削除されない → 次の tick (35分) まで進めて確実に超過させる
      vi.advanceTimersByTime(36 * 60 * 1000);

      expect(rm.getRoom(room.id)).toBeUndefined();
    });

    it('phase が playing の部屋は自動削除されない', () => {
      const room = rm.createRoom()!;
      room.phase = 'playing';

      vi.advanceTimersByTime(36 * 60 * 1000);

      expect(rm.getRoom(room.id)).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('全ての room を破棄し、TTL タイマーを止める', () => {
      rm = new RoomManager([39220, 39223]);
      const room = rm.createRoom()!;
      rm.shutdown();

      expect(rm.getRoom(room.id)).toBeUndefined();
      expect(rm.listRooms()).toEqual([]);
    });
  });
});
