import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../game/Game.js';
import { createRandomMap } from '../game/GameSystem.js';
import { countItems } from '../game/GameLogic.js';
import { Winner, Reason, Cause } from '../game/types.js';
import { WsServer } from './WsServer.js';
import type { WsMessage } from './ws-types.js';

const WS_PORT = 19991;

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<WsMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString()) as WsMessage));
  });
}

describe('WsServer', () => {
  let server: WsServer;

  beforeEach(() => {
    server = new WsServer(WS_PORT);
  });

  afterEach(async () => {
    await server.close();
  });

  it('ブラウザクライアントが接続できる', async () => {
    const ws = await connectWs(WS_PORT);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('broadcast した JSON を受信できる', async () => {
    const ws = await connectWs(WS_PORT);
    const map = createRandomMap();

    const msgPromise = nextMessage(ws);
    server.broadcast({
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
    const session = new GameSession();
    server.attach(session, ['COOL', 'HOT']);

    const ws = await connectWs(WS_PORT);

    // stateUpdate イベントをシミュレート
    const msgPromise = nextMessage(ws);
    const map = createRandomMap();
    session.emit('stateUpdate', {
      map,
      teamPos: [map.teamFirstPoint[0], map.teamFirstPoint[1]],
      teamScore: [0, 0] as [number, number],
      turnCount: 100,
      leaveItems: countItems(map),
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
    const session = new GameSession();
    server.attach(session, ['TeamA', 'TeamB']);

    const ws = await connectWs(WS_PORT);
    const msgPromise = nextMessage(ws);

    const map = createRandomMap();
    session.emit('gameEnd', {
      status: { winner: Winner.COOL, reason: Reason.SCORE, cause: Cause.NONE },
      state: {
        map,
        teamPos: [map.teamFirstPoint[0], map.teamFirstPoint[1]],
        teamScore: [5, 3] as [number, number],
        turnCount: 0,
        leaveItems: 0,
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
});
