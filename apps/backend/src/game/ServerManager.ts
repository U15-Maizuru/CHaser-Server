import { EventEmitter } from 'node:events';
import os from 'node:os';
import { TcpClient } from '../network/TcpClient.js';
import { ComClient } from '../clients/ComClient.js';
import { ProcessClient } from '../clients/ProcessClient.js';
import { GameSession } from './Game.js';
import { createRandomMap, importMap } from './GameSystem.js';
import { StableLog } from '../log/StableLog.js';
import type { BaseClient } from '../network/BaseClient.js';
import type { GameMap } from './types.js';
import type {
  ClientType,
  ClientState,
  ClientStatusPayload,
  InlineMapData,
  MapParams,
  ProcessConfig,
  ServerStatusPayload,
  ServerPhase,
} from '@u15/ws-types';

const PORTS: [number, number] = [12031, 12032];
const DEFAULT_TYPE: ClientType = 'process';

interface SlotInfo {
  type:          ClientType;
  state:         ClientState;
  name:          string;
  ip:            string;
  port:          number;
  tcp:           TcpClient | null;
  processConfig?: ProcessConfig;
  error?:        string;
}

// Events emitted:
//   'status'          (payload: ServerStatusPayload)
//   'session_created' (session: GameSession, playerNames: [string, string])
export class ServerManager extends EventEmitter {
  private phase: ServerPhase = 'setup';
  private slots: [SlotInfo, SlotInfo];
  private map: GameMap;
  private mapParams: MapParams = { itemNum: 51, blockNum: 20, turnNum: 100, mirror: true };
  private readonly localIP: string;

  constructor() {
    super();
    this.localIP = getLocalIP();
    this.slots = [
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: PORTS[0], tcp: null },
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: PORTS[1], tcp: null },
    ];
    this.map = createRandomMap(undefined, this.mapParams.blockNum, this.mapParams.itemNum, this.mapParams.turnNum, this.mapParams.mirror);
    void this.startListening(0);
    void this.startListening(1);
  }

  // ── Public commands ────────────────────────────────────────────────────────

  async setClientType(slot: 0 | 1, type: ClientType, processConfig?: ProcessConfig): Promise<void> {
    if (this.phase !== 'setup') return;
    const info = this.slots[slot];
    info.type = type;
    info.error = undefined;

    if (type === 'cpu') {
      info.tcp?.close();
      info.tcp = null;
      info.state = 'ready';
      info.name  = 'CPU';
      info.ip    = 'ローカル';
      info.processConfig = undefined;
      this.emitStatus();
      return;
    }

    info.tcp?.close();
    info.tcp  = null;
    info.name = '';
    info.ip   = '';
    info.state = 'waiting';

    if (type === 'process') {
      info.processConfig = processConfig;
    } else {
      info.processConfig = undefined;
    }

    this.emitStatus();
    await this.startListening(slot);
  }

  deleteProgram(slot: 0 | 1): void {
    if (this.phase !== 'setup') return;
    const info = this.slots[slot];
    info.tcp?.close();
    info.tcp           = null;
    info.processConfig = undefined;
    info.state         = 'waiting';
    info.name          = '';
    info.ip            = '';
    info.error         = undefined;
    this.emitStatus();
    void this.startListening(slot);
  }

  loadMap(filePath: string): void {
    const loaded = importMap(filePath);
    if (loaded) { this.map = loaded; this.emitStatus(); }
  }

  setMapParams(params: MapParams): void {
    this.mapParams = params;
    this.map = createRandomMap(
      undefined,
      params.blockNum,
      params.itemNum,
      params.turnNum,
      params.mirror,
    );
    this.emitStatus();
  }

  loadMapData(data: InlineMapData): void {
    this.map = {
      field: data.field.map(r => [...r]) as import('./types.js').MapObject[][],
      size: { ...data.size },
      turn: data.turn,
      name: '[CUSTOM MAP]',
      teamFirstPoint: [{ ...data.teamFirstPoint[0] }, { ...data.teamFirstPoint[1] }],
      textureDirPath: 'Jewel',
    };
    this.emitStatus();
  }

  async requestStart(): Promise<void> {
    if (this.phase !== 'setup') return;
    if (!this.allReady()) return;

    this.phase = 'playing';
    this.emitStatus();

    const clients     = this.buildClients();
    const playerNames: [string, string] = [this.slots[0].name, this.slots[1].name];
    const session     = new GameSession();

    this.emit('session_created', session, playerNames);

    const log    = new StableLog('game.log');
    const result = await session.run(clients, this.map, log);
    console.log('Game finished:', result.status);

    this.phase = 'finished';
    this.emitStatus();
  }

  async requestReset(): Promise<void> {
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp   = null;
      slot.type  = DEFAULT_TYPE;
      slot.state = 'waiting';
      slot.name  = '';
      slot.ip    = '';
      slot.error = undefined;
      slot.processConfig = undefined;
    }
    this.map   = createRandomMap(undefined, this.mapParams.blockNum, this.mapParams.itemNum, this.mapParams.turnNum, this.mapParams.mirror);
    this.phase = 'setup';

    await this.startListening(0);
    await this.startListening(1);
    this.emitStatus();
  }

  getStatus(): ServerStatusPayload {
    return {
      phase:   this.phase,
      localIP: this.localIP,
      clients: [toPayload(this.slots[0]), toPayload(this.slots[1])],
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async startListening(slot: 0 | 1): Promise<void> {
    const info = this.slots[slot];
    if (info.type !== 'tcp' && info.type !== 'process') return;

    const tcp = info.type === 'process' ? new ProcessClient() : new TcpClient();
    info.tcp = tcp;

    try {
      await tcp.listen(info.port);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[slot ${slot}] listen failed on port ${info.port}:`, msg);
      info.state = 'waiting';
      info.error = `ポート ${info.port} のリッスンに失敗: ${msg}`;
      this.emitStatus();
      return;
    }

    console.log(`[slot ${slot}] listening on port ${info.port}`);
    info.state = 'waiting';
    info.error = undefined;
    this.emitStatus();

    tcp.on('connected', () => {
      info.state = 'connected';
      info.ip    = tcp.ip;
      this.emitStatus();
    });

    if (info.type === 'process' && info.processConfig) {
      void this.spawnProgram(slot, tcp as ProcessClient, info.processConfig);
    } else {
      tcp.waitForClient().then(() => {
        if (info.tcp !== tcp) return;
        info.state = 'ready';
        info.name  = tcp.name;
        info.ip    = tcp.ip;
        this.emitStatus();
      }).catch(() => {});
    }
  }

  private async spawnProgram(slot: 0 | 1, tcp: ProcessClient, cfg: ProcessConfig): Promise<void> {
    const info = this.slots[slot];
    try {
      await tcp.startProgram(info.port, cfg.programType, cfg.programPath, cfg.runtimeCommand, cfg.libPath);
      if (info.tcp !== tcp) return;
      info.state = 'ready';
      info.name  = tcp.name;
      info.ip    = tcp.ip;
      info.error = undefined;
    } catch (e) {
      if (info.tcp !== tcp) return;
      const msg = (e as Error).message;
      console.error(`[slot ${slot}] process failed:`, msg);
      info.state = 'waiting';
      info.error = `プログラムの起動に失敗: ${msg}`;
    }
    this.emitStatus();
  }

  private allReady(): boolean {
    return this.slots.every(s => s.state === 'ready');
  }

  private buildClients(): [BaseClient, BaseClient] {
    return this.slots.map((slot) => {
      if (slot.type === 'cpu') {
        const com = new ComClient();
        com.startup();
        return com;
      }
      return slot.tcp!;
    }) as [BaseClient, BaseClient];
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

function toPayload(slot: SlotInfo): ClientStatusPayload {
  return {
    type:  slot.type,
    state: slot.state,
    name:  slot.name,
    ip:    slot.ip,
    port:  slot.port,
    ...(slot.error ? { error: slot.error } : {}),
  };
}

function getLocalIP(): string {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}
