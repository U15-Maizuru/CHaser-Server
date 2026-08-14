import { randomUUID } from 'node:crypto';
import { PortPool } from './network/PortPool.js';
import { ServerManager } from './game/ServerManager.js';
import type { GameSession } from './game/Game.js';
import type { ManualClient } from './clients/ManualClient.js';
import type { RoomSummary, ServerPhase, ServerStatusPayload } from '@u15/ws-types';

const ROOM_TTL_MS = 30 * 60 * 1000; // 30分
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとにチェック

export interface Room {
  id:         string;
  ports:      [number, number];
  manager:    ServerManager;
  createdAt:  number;
  lastActive: number;
  phase:      ServerPhase;
  fromPool:   boolean;
}

export class RoomManager {
  private readonly pool: PortPool | null;
  private readonly rooms = new Map<string, Room>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  // WsServer が設定するコールバック
  onRoomStatus?:    (roomId: string, payload: ServerStatusPayload) => void;
  onRoomSession?:   (roomId: string, session: GameSession, names: [string, string]) => void;
  onManualClient?:  (roomId: string, mc: ManualClient) => void;
  onRoomDestroyed?: (roomId: string) => void;

  constructor(webPortRange?: [number, number]) {
    this.pool = webPortRange ? new PortPool(webPortRange[0], webPortRange[1]) : null;
    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
  }

  createRoom(id?: string, fixedPorts?: [number, number], persistSettings = false): Room | null {
    let ports: [number, number];
    let fromPool: boolean;

    if (fixedPorts) {
      ports    = fixedPorts;
      fromPool = false;
    } else if (this.pool) {
      const p0 = this.pool.alloc();
      const p1 = this.pool.alloc();
      if (p0 === null || p1 === null) {
        if (p0 !== null) this.pool.release(p0);
        if (p1 !== null) this.pool.release(p1);
        return null;
      }
      ports    = [p0, p1];
      fromPool = true;
    } else {
      return null;
    }

    const roomId  = id ?? randomUUID();
    const manager = new ServerManager(ports, undefined, undefined, undefined, { persistSettings });
    manager.setRoomId(roomId);
    const room: Room = {
      id:         roomId,
      ports,
      manager,
      createdAt:  Date.now(),
      lastActive: Date.now(),
      phase:      'setup',
      fromPool,
    };

    manager.on('status', (payload: ServerStatusPayload) => {
      room.lastActive = Date.now();
      room.phase      = payload.phase;
      this.onRoomStatus?.(roomId, payload);
    });

    manager.on('session_created', (session: GameSession, names: [string, string]) => {
      this.onRoomSession?.(roomId, session, names);
    });

    manager.on('manual_client_created', (mc: ManualClient) => {
      this.onManualClient?.(roomId, mc);
    });

    this.rooms.set(roomId, room);
    console.log(`[RoomManager] created room ${roomId} ports=${ports} total=${this.rooms.size}`);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).map(r => ({
      id:        r.id,
      phase:     r.phase,
      ports:     r.ports,
      createdAt: r.createdAt,
    }));
  }

  destroyRoom(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;

    room.manager.shutdown();

    if (room.fromPool && this.pool) {
      this.pool.release(room.ports[0]);
      this.pool.release(room.ports[1]);
    }

    this.rooms.delete(id);
    this.onRoomDestroyed?.(id);
    console.log(`[RoomManager] destroyed room ${id} total=${this.rooms.size}`);
  }

  touchRoom(id: string): void {
    const room = this.rooms.get(id);
    if (room) room.lastActive = Date.now();
  }

  shutdown(): void {
    clearInterval(this.sweepTimer);
    for (const id of Array.from(this.rooms.keys())) {
      this.destroyRoom(id);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.phase === 'playing') continue;
      if (now - room.lastActive > ROOM_TTL_MS) {
        const mins = Math.round((now - room.lastActive) / 60000);
        console.log(`[RoomManager] expiring room ${id} (inactive ${mins}m)`);
        this.destroyRoom(id);
      }
    }
  }
}
