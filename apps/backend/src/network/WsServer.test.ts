import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameSession } from '../game/Game.js';
import { createRandomMap } from '../game/GameSystem.js';
import { countItems } from '../game/GameLogic.js';
import { Winner, Reason, Cause } from '../game/types.js';
import { WsServer } from './WsServer.js';
import { RoomManager } from '../RoomManager.js';
import type { WsMessage, LobbyMessage } from '@u15/ws-types';

const WS_PORT    = 19991;
const TEST_PORTS: [number, number] = [29900, 29999];

type AnyMessage = WsMessage | LobbyMessage;

interface TestClient {
  ws:   WebSocket;
  wait: (type: string, timeout?: number) => Promise<AnyMessage>;
}

function connectWs(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws  = new WebSocket(`ws://localhost:${port}`);
    const buf: AnyMessage[] = [];
    const waiters = new Map<string, { resolve: (m: AnyMessage) => void; timer: ReturnType<typeof setTimeout> }>();

    // メッセージバッファを 'open' より前に登録してレースコンディションを回避
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as AnyMessage;
      const waiter = waiters.get(msg.type);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(msg.type);
        waiter.resolve(msg);
      } else {
        buf.push(msg);
      }
    });

    const wait = (type: string, timeout = 3000): Promise<AnyMessage> => {
      const idx = buf.findIndex(m => m.type === type);
      if (idx >= 0) return Promise.resolve(buf.splice(idx, 1)[0]);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          waiters.delete(type);
          rej(new Error(`Timeout waiting for ${type}`));
        }, timeout);
        waiters.set(type, { resolve: res, timer });
      });
    };

    ws.once('open',  () => resolve({ ws, wait }));
    ws.once('error', reject);
  });
}

describe('WsServer', () => {
  let server: WsServer;
  let rm: RoomManager;

  beforeEach(() => {
    server = new WsServer(WS_PORT);
    rm = new RoomManager(TEST_PORTS);
    server.setRoomManager(rm);
  });

  afterEach(async () => {
    rm.shutdown();
    await server.close();
  });

  it('ブラウザクライアントが接続できる', async () => {
    const { ws, wait } = await connectWs(WS_PORT);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    const msg = await wait('room_list');
    expect(msg.type).toBe('room_list');
    ws.close();
  });

  it('create_room → room_created が返り、他クライアントに room_list がブロードキャストされる (LobbyRouter)', async () => {
    const a = await connectWs(WS_PORT);
    await a.wait('room_list');
    const b = await connectWs(WS_PORT);
    await b.wait('room_list');

    const createdPromise  = a.wait('room_created');
    const roomListPromise = b.wait('room_list');
    a.ws.send(JSON.stringify({ type: 'create_room' }));

    const created = await createdPromise;
    expect(created.type).toBe('room_created');

    const roomList = await roomListPromise;
    expect(roomList.type).toBe('room_list');
    if (roomList.type === 'room_list' && created.type === 'room_created') {
      expect(roomList.payload.rooms.map(r => r.id)).toContain(created.payload.roomId);
    }

    a.ws.close();
    b.ws.close();
  });

  it('list_rooms → room_list が返る (LobbyRouter)', async () => {
    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list');

    const roomListPromise = wait('room_list');
    ws.send(JSON.stringify({ type: 'list_rooms' }));
    const msg = await roomListPromise;
    expect(msg.type).toBe('room_list');
    ws.close();
  });

  it('destroy_room → 参加中の部屋が削除され room_list がブロードキャストされる (LobbyRouter)', async () => {
    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list');

    ws.send(JSON.stringify({ type: 'create_room' }));
    const created = await wait('room_created');
    if (created.type !== 'room_created') throw new Error('unexpected message');
    const roomId = created.payload.roomId;
    await wait('room_list'); // create_room 自身がブロードキャストする room_list (destroy 前) を消費

    const roomListPromise = wait('room_list');
    ws.send(JSON.stringify({ type: 'destroy_room' }));
    const msg = await roomListPromise;
    expect(msg.type).toBe('room_list');
    if (msg.type === 'room_list') {
      expect(msg.payload.rooms.map(r => r.id)).not.toContain(roomId);
    }
    ws.close();
  });

  it('broadcastAll した JSON を受信できる', async () => {
    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list'); // 初期 room_list を消費

    const msgPromise = wait('turn_start');
    server.broadcastAll({
      type: 'turn_start',
      payload: { turn: 100, player: 0 },
    });

    const msg = await msgPromise;
    expect(msg.type).toBe('turn_start');
    if (msg.type === 'turn_start') {
      expect(msg.payload.turn).toBe(100);
      expect(msg.payload.player).toBe(0);
    }
    ws.close();
  });

  it('GameSession イベントが WS に届く', async () => {
    const room    = rm.createRoom()!;
    const session = new GameSession();
    server.attachRoom(room.id, session, ['COOL', 'HOT']);

    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list');

    ws.send(JSON.stringify({ type: 'join_room', payload: { roomId: room.id } }));
    await wait('room_joined');

    const msgPromise = wait('game_state');
    const map = createRandomMap();
    session.emit('stateUpdate', {
      map,
      teamPos:        [map.teamFirstPoint[0], map.teamFirstPoint[1]],
      teamScore:      [0, 0] as [number, number],
      turnCount:      100,
      leaveItems:     countItems(map),
      isDisconnected: [false, false] as [boolean, boolean],
    });

    const msg = await msgPromise;
    expect(msg.type).toBe('game_state');
    if (msg.type === 'game_state') {
      expect(msg.payload.turnCount).toBe(100);
      expect(msg.payload.playerNames).toEqual(['COOL', 'HOT']);
    }
    ws.close();
  });

  it('game_end イベントが正しく送信される', async () => {
    const room    = rm.createRoom()!;
    const session = new GameSession();
    server.attachRoom(room.id, session, ['TeamA', 'TeamB']);

    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list');

    ws.send(JSON.stringify({ type: 'join_room', payload: { roomId: room.id } }));
    await wait('room_joined');

    const msgPromise = wait('game_end');
    const map = createRandomMap();
    session.emit('gameEnd', {
      status: { winner: Winner.COOL, reason: Reason.SCORE, cause: Cause.NONE },
      state: {
        map,
        teamPos:        [map.teamFirstPoint[0], map.teamFirstPoint[1]],
        teamScore:      [5, 3] as [number, number],
        turnCount:      0,
        leaveItems:     0,
        isDisconnected: [false, false] as [boolean, boolean],
      },
    });

    const msg = await msgPromise;
    expect(msg.type).toBe('game_end');
    if (msg.type === 'game_end') {
      expect(msg.payload.winner).toBe(Winner.COOL);
      expect(msg.payload.finalScore).toEqual([5, 3]);
    }
    ws.close();
  });

  it('request_start が失敗した場合、コンソールに握りつぶさず error を発行元ソケットに送る', async () => {
    const room = rm.createRoom()!;
    room.manager.requestStart = () => Promise.reject(new Error('boom'));

    const { ws, wait } = await connectWs(WS_PORT);
    await wait('room_list');

    ws.send(JSON.stringify({ type: 'join_room', payload: { roomId: room.id } }));
    await wait('room_joined');

    const errorPromise = wait('error');
    ws.send(JSON.stringify({ type: 'request_start' }));

    const msg = await errorPromise;
    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.payload.message).toContain('boom');
    }
    ws.close();
  });
});
