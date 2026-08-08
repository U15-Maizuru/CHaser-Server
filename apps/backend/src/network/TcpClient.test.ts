import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aroundDataToString } from '../game/GameSystem.js';
import { ConnectingStatus, MapObject } from '../game/types.js';
import { TcpClient } from './TcpClient.js';

const TEST_PORT = 19990;

const AROUND: import('../game/types.js').AroundData = {
  connect: ConnectingStatus.CONTINUE,
  data: Array(9).fill(MapObject.NOTHING) as MapObject[],
};

async function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port }, () => resolve(s));
  });
}

describe('TcpClient', () => {
  let server: TcpClient;

  beforeEach(async () => {
    server = new TcpClient(500);
    await server.listen(TEST_PORT);
  });

  afterEach(() => {
    server.close();
  });

  it('クライアント接続とプレイヤー名取得', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('TestTeam\n');
    await connectPromise;
    expect(server.name).toBe('TestTeam');
    sock.destroy();
  });

  it('waitGetReady — gr で true', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('Team\n');
    await connectPromise;

    const p = server.waitGetReady();
    // Wait for @ from server
    await new Promise<void>((resolve) => {
      sock.once('data', (d) => {
        expect(d.toString()).toBe('@\r\n');
        sock.write('gr\r\n');
        resolve();
      });
    });
    expect(await p).toBe(true);
    sock.destroy();
  });

  it('waitGetReady — タイムアウト → false', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('Team\n');
    await connectPromise;

    const result = await server.waitGetReady(); // no response → timeout (500ms)
    expect(result).toBe(false);
    sock.destroy();
  });

  it('updateTimeout — 接続済みクライアントにも新しいタイムアウト値が反映される', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('Team\n');
    await connectPromise;

    server.updateTimeout(50);
    const start = Date.now();
    const result = await server.waitGetReady(); // no response → 50ms でタイムアウトするはず
    expect(result).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
    sock.destroy();
  });

  it('waitReturnMethod — wu を受け取り WALK+UP を返す', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('Team\n');
    await connectPromise;

    const aroundStr = aroundDataToString(AROUND);

    const p = server.waitReturnMethod(AROUND);
    await new Promise<void>((resolve) => {
      sock.once('data', (d) => {
        expect(d.toString()).toBe(aroundStr + '\r\n');
        sock.write('wu\r\n');
        resolve();
      });
    });
    const method = await p;
    expect(method.action).toBe(0 /* WALK */);
    expect(method.rote).toBe(0 /* UP */);
    sock.destroy();
  });

  it('waitEndSharp — # で true', async () => {
    const connectPromise = server.waitForClient();
    const sock = await connectClient(TEST_PORT);
    sock.write('Team\n');
    await connectPromise;

    const p = server.waitEndSharp(AROUND);
    await new Promise<void>((resolve) => {
      sock.once('data', () => {
        sock.write('#\r\n');
        resolve();
      });
    });
    expect(await p).toBe(true);
    sock.destroy();
  });
});
