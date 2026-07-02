import type { WebSocket } from 'ws';
import type { RoomManager } from '../RoomManager.js';
import type { FrontendMessage, LobbyMessage, ServerStatusPayload, WsMessage } from '@u15/ws-types';

export interface LobbyRouterDeps {
  joinWsToRoom:      (ws: WebSocket, roomId: string) => void;
  getSocketRoom:     (ws: WebSocket) => string | undefined;
  getLastRoomStatus: (roomId: string) => ServerStatusPayload | undefined;
  broadcastAll:      (msg: WsMessage | LobbyMessage) => void;
}

/**
 * ロビー系メッセージ (create_room / join_room / list_rooms / destroy_room) を処理する。
 * 該当しないメッセージは false を返し、呼び出し側でゲームメッセージとして処理させる。
 */
export class LobbyRouter {
  constructor(private readonly rm: RoomManager, private readonly deps: LobbyRouterDeps) {}

  tryHandle(ws: WebSocket, msg: FrontendMessage): boolean {
    switch (msg.type) {
      case 'create_room': {
        const room = this.rm.createRoom();
        if (!room) {
          this.send(ws, { type: 'error', payload: { message: 'サーバーが満員です' } });
          return true;
        }
        this.deps.joinWsToRoom(ws, room.id);
        this.send(ws, { type: 'room_created', payload: { roomId: room.id, ports: room.ports } });
        this.deps.broadcastAll({ type: 'room_list', payload: { rooms: this.rm.listRooms() } });
        return true;
      }

      case 'join_room': {
        const room = this.rm.getRoom(msg.payload.roomId);
        if (!room) {
          this.send(ws, { type: 'error', payload: { message: 'ルームが見つかりません' } });
          return true;
        }
        this.deps.joinWsToRoom(ws, room.id);
        this.rm.touchRoom(room.id);
        const lastStatus = this.deps.getLastRoomStatus(room.id);
        if (lastStatus) {
          this.send(ws, { type: 'server_status', payload: lastStatus });
        }
        this.send(ws, { type: 'room_joined', payload: { roomId: room.id, ports: room.ports } });
        return true;
      }

      case 'list_rooms':
        this.send(ws, { type: 'room_list', payload: { rooms: this.rm.listRooms() } });
        return true;

      case 'destroy_room': {
        const roomId = this.deps.getSocketRoom(ws);
        if (roomId) {
          this.rm.destroyRoom(roomId);
          this.deps.broadcastAll({ type: 'room_list', payload: { rooms: this.rm.listRooms() } });
        }
        return true;
      }

      default:
        return false;
    }
  }

  private send(ws: WebSocket, msg: LobbyMessage | WsMessage): void {
    ws.send(JSON.stringify(msg));
  }
}
