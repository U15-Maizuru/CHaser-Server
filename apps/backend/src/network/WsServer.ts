import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'node:http';
import type { GameSession, GameResult } from '../game/Game.js';
import type { GameState } from '../game/GameLogic.js';
import type { ManualClient } from '../clients/ManualClient.js';
import type { RoomManager } from '../RoomManager.js';
import type {
  GameStateSnapshot,
  WsMessage,
  LobbyMessage,
  FrontendMessage,
  ServerStatusPayload,
} from '@u15/ws-types';

export class WsServer {
  private readonly wss: WebSocketServer;
  readonly httpServer: HttpServer;

  private rm: RoomManager | null = null;

  private readonly socketToRoom    = new Map<WebSocket, string>();
  private readonly roomSockets     = new Map<string, Set<WebSocket>>();
  private readonly lastRoomStatus  = new Map<string, ServerStatusPayload>();
  private readonly roomManualClients = new Map<string, Map<0 | 1, ManualClient>>();

  constructor(port: number) {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      ws.on('error', () => {});
      ws.on('message', (data) => this.onMessage(ws, data.toString()));
      ws.on('close',   () => this.onDisconnect(ws));

      if (this.rm) {
        ws.send(JSON.stringify({ type: 'room_list', payload: { rooms: this.rm.listRooms() } }));
      }
    });

    this.httpServer.listen(port);
  }

  setRoomManager(rm: RoomManager): void {
    this.rm = rm;

    rm.onRoomStatus = (roomId, payload) => {
      this.lastRoomStatus.set(roomId, payload);
      this.broadcastToRoom(roomId, { type: 'server_status', payload });
    };

    rm.onRoomSession = (roomId, session, names) => {
      this.attachRoom(roomId, session, names);
    };

    rm.onManualClient = (roomId, mc) => {
      if (!this.roomManualClients.has(roomId)) {
        this.roomManualClients.set(roomId, new Map());
      }
      this.roomManualClients.get(roomId)!.set(mc.currentSlot, mc);
      mc.on('need_input', (slot: 0 | 1, aroundData: number[]) => {
        this.broadcastToRoom(roomId, { type: 'manual_request', payload: { slot, aroundData } });
      });
    };

    rm.onRoomDestroyed = (roomId) => {
      this.lastRoomStatus.delete(roomId);
      this.roomManualClients.delete(roomId);
      const sockets = this.roomSockets.get(roomId);
      if (sockets) {
        for (const ws of sockets) this.socketToRoom.delete(ws);
        this.roomSockets.delete(roomId);
      }
    };
  }

  broadcastToRoom(roomId: string, msg: WsMessage): void {
    const sockets = this.roomSockets.get(roomId);
    if (!sockets) return;
    const json = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }

  broadcastAll(msg: WsMessage | LobbyMessage): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  }

  close(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
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

  private joinWsToRoom(ws: WebSocket, roomId: string): void {
    const oldRoom = this.socketToRoom.get(ws);
    if (oldRoom) this.roomSockets.get(oldRoom)?.delete(ws);

    this.socketToRoom.set(ws, roomId);
    if (!this.roomSockets.has(roomId)) this.roomSockets.set(roomId, new Set());
    this.roomSockets.get(roomId)!.add(ws);
  }

  private onDisconnect(ws: WebSocket): void {
    const roomId = this.socketToRoom.get(ws);
    if (roomId) {
      this.roomSockets.get(roomId)?.delete(ws);
      this.socketToRoom.delete(ws);
    }
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: FrontendMessage;
    try {
      msg = JSON.parse(raw) as FrontendMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    const rm = this.rm;
    if (!rm) return;

    // ── ロビーメッセージ ──────────────────────────────────────────────────────

    if (msg.type === 'create_room') {
      const room = rm.createRoom();
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'サーバーが満員です' } } satisfies LobbyMessage));
        return;
      }
      this.joinWsToRoom(ws, room.id);
      ws.send(JSON.stringify({ type: 'room_created', payload: { roomId: room.id, ports: room.ports } } satisfies LobbyMessage));
      this.broadcastAll({ type: 'room_list', payload: { rooms: rm.listRooms() } });
      return;
    }

    if (msg.type === 'join_room') {
      const room = rm.getRoom(msg.payload.roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'ルームが見つかりません' } } satisfies LobbyMessage));
        return;
      }
      this.joinWsToRoom(ws, room.id);
      rm.touchRoom(room.id);
      const lastStatus = this.lastRoomStatus.get(room.id);
      if (lastStatus) {
        ws.send(JSON.stringify({ type: 'server_status', payload: lastStatus } satisfies WsMessage));
      }
      ws.send(JSON.stringify({ type: 'room_joined', payload: { roomId: room.id, ports: room.ports } } satisfies LobbyMessage));
      return;
    }

    if (msg.type === 'list_rooms') {
      ws.send(JSON.stringify({ type: 'room_list', payload: { rooms: rm.listRooms() } } satisfies LobbyMessage));
      return;
    }

    if (msg.type === 'destroy_room') {
      const roomId = this.socketToRoom.get(ws);
      if (roomId) {
        rm.destroyRoom(roomId);
        this.broadcastAll({ type: 'room_list', payload: { rooms: rm.listRooms() } });
      }
      return;
    }

    // ── ゲームメッセージ (ルーム内専用) ──────────────────────────────────────

    const roomId = this.socketToRoom.get(ws);
    if (!roomId) return;
    const room = rm.getRoom(roomId);
    if (!room) return;
    rm.touchRoom(roomId);

    const manager = room.manager;

    switch (msg.type) {
      case 'set_client':
        void manager.setClientType(msg.payload.slot, msg.payload.clientType, msg.payload.processConfig);
        break;
      case 'delete_program':
        manager.deleteProgram(msg.payload.slot);
        break;
      case 'request_start':
        this.roomManualClients.get(roomId)?.clear();
        manager.requestStart().catch(console.error);
        break;
      case 'request_reset':
        this.roomManualClients.get(roomId)?.clear();
        manager.requestReset().catch(console.error);
        break;
      case 'load_map':
        manager.loadMap(msg.payload.filePath);
        break;
      case 'set_map_params':
        manager.setMapParams(msg.payload);
        break;
      case 'load_map_data':
        manager.loadMapData(msg.payload);
        break;
      case 'set_double_mode':
        manager.setDoubleMode(msg.payload.enabled);
        break;
      case 'set_turn_delay':
        manager.setTurnDelay(msg.payload.ms);
        break;
      case 'request_next_round':
        this.roomManualClients.get(roomId)?.clear();
        manager.requestNextRound().catch(console.error);
        break;
      case 'manual_action': {
        const mc = this.roomManualClients.get(roomId)?.get(msg.payload.slot);
        if (mc) mc.receiveAction(msg.payload.action, msg.payload.rote);
        break;
      }
    }
  }

  attachRoom(roomId: string, session: GameSession, playerNames: [string, string]): void {
    session.on('stateUpdate', (state: GameState) => {
      this.broadcastToRoom(roomId, {
        type: 'game_state',
        payload: toSnapshot(state, playerNames),
      });
    });

    session.on('turnStart', (player: number, state: GameState) => {
      this.broadcastToRoom(roomId, {
        type: 'turn_start',
        payload: { turn: state.turnCount, player },
      });
    });

    session.on('scoreUpdate', (state: GameState) => {
      this.broadcastToRoom(roomId, {
        type: 'score_update',
        payload: {
          teamScore:  [...state.teamScore] as [number, number],
          leaveItems: state.leaveItems,
        },
      });
    });

    session.on('gameEnd', (result: GameResult) => {
      this.broadcastToRoom(roomId, {
        type: 'game_end',
        payload: {
          winner:     result.status.winner,
          reason:     result.status.reason,
          playerNames,
          finalScore: [...result.state.teamScore] as [number, number],
        },
      });
    });
  }
}

function toSnapshot(state: GameState, playerNames: [string, string]): GameStateSnapshot {
  return {
    field:       state.map.field.map((row: import('../game/types.js').MapObject[]) => [...row]),
    size:        { ...state.map.size },
    teamPos:     [{ ...state.teamPos[0] }, { ...state.teamPos[1] }],
    teamScore:   [...state.teamScore] as [number, number],
    turnCount:   state.turnCount,
    leaveItems:  state.leaveItems,
    playerNames,
  };
}
