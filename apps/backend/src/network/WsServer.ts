import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'node:http';
import { EventEmitter } from 'node:events';
import type { GameSession, GameResult } from '../game/Game.js';
import type { GameState } from '../game/GameLogic.js';
import type {
  GameStateSnapshot,
  WsMessage,
  FrontendMessage,
  ServerStatusPayload,
} from '@u15/ws-types';

// Events emitted:
//   'set_client'      (slot: 0|1, clientType, processConfig?)
//   'delete_program'  (slot: 0|1)
//   'request_start'   ()
//   'request_reset'   ()
//   'load_map'        (filePath: string)
//   'set_map_params'  (params)
//   'load_map_data'   (data)
export class WsServer extends EventEmitter {
  private wss: WebSocketServer;
  readonly httpServer: HttpServer;
  private lastStatus: ServerStatusPayload | null = null;

  constructor(port: number) {
    super();
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => {
      ws.on('error', () => {});
      ws.on('message', (data) => this.onMessage(data.toString()));

      if (this.lastStatus) {
        ws.send(JSON.stringify({ type: 'server_status', payload: this.lastStatus }));
      }
    });
    this.httpServer.listen(port);
  }

  broadcastStatus(payload: ServerStatusPayload): void {
    this.lastStatus = payload;
    this.broadcast({ type: 'server_status', payload });
  }

  attach(session: GameSession, playerNames: [string, string]): void {
    session.on('stateUpdate', (state: GameState) => {
      this.broadcast({
        type: 'game_state',
        payload: toSnapshot(state, playerNames),
      });
    });

    session.on('turnStart', (player: number, state: GameState) => {
      this.broadcast({
        type: 'turn_start',
        payload: { turn: state.turnCount, player },
      });
    });

    session.on('scoreUpdate', (state: GameState) => {
      this.broadcast({
        type: 'score_update',
        payload: {
          teamScore: [...state.teamScore] as [number, number],
          leaveItems: state.leaveItems,
        },
      });
    });

    session.on('gameEnd', (result: GameResult) => {
      this.broadcast({
        type: 'game_end',
        payload: {
          winner: result.status.winner,
          reason: result.status.reason,
          playerNames,
          finalScore: [...result.state.teamScore] as [number, number],
        },
      });
    });
  }

  broadcast(msg: WsMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else this.httpServer.close((e) => (e ? reject(e) : resolve()));
      });
    });
  }

  get port(): number {
    const addr = this.httpServer.address();
    return typeof addr === 'object' && addr !== null ? addr.port : 0;
  }

  private onMessage(raw: string): void {
    let msg: FrontendMessage;
    try {
      msg = JSON.parse(raw) as FrontendMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    switch (msg.type) {
      case 'set_client':
        this.emit('set_client', msg.payload.slot, msg.payload.clientType, msg.payload.processConfig);
        break;
      case 'delete_program':
        this.emit('delete_program', msg.payload.slot);
        break;
      case 'request_start':
        this.emit('request_start');
        break;
      case 'request_reset':
        this.emit('request_reset');
        break;
      case 'load_map':
        this.emit('load_map', msg.payload.filePath);
        break;
      case 'set_map_params':
        this.emit('set_map_params', msg.payload);
        break;
      case 'load_map_data':
        this.emit('load_map_data', msg.payload);
        break;
    }
  }
}

function toSnapshot(state: GameState, playerNames: [string, string]): GameStateSnapshot {
  return {
    field: state.map.field.map((row: import('../game/types.js').MapObject[]) => [...row]),
    size: { ...state.map.size },
    teamPos: [{ ...state.teamPos[0] }, { ...state.teamPos[1] }],
    teamScore: [...state.teamScore] as [number, number],
    turnCount: state.turnCount,
    leaveItems: state.leaveItems,
    playerNames,
  };
}
