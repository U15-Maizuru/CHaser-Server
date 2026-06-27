import { EventEmitter } from 'node:events';
import os from 'node:os';
import { TcpClient } from '../network/TcpClient.js';
import { ComClient } from '../clients/ComClient.js';
import { ProcessClient } from '../clients/ProcessClient.js';
import { GameSession } from './Game.js';
import { createRandomMap, importMap } from './GameSystem.js';
import { StableLog } from '../log/StableLog.js';
import { calculatePoints } from './GameLogic.js';
import type { BaseClient } from '../network/BaseClient.js';
import type { GameMap } from './types.js';
import { Winner } from '@u15/ws-types';
import { ManualClient } from '../clients/ManualClient.js';
import type {
  ClientType,
  ClientState,
  ClientStatusPayload,
  InlineMapData,
  MapParams,
  ProcessConfig,
  RoundResult,
  ServerStatusPayload,
  ServerPhase,
  Reason,
} from '@u15/ws-types';

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

  private doubleMode:    boolean       = false;
  private currentRound:  0 | 1        = 0;
  private roundResults:  RoundResult[] = [];
  private turnDelayMs:   number        = 1000;  // 1ターンあたりの表示待機時間 (デフォルト1秒)

  constructor(ports: [number, number] = [12031, 12032]) {
    super();
    this.localIP = getLocalIP();
    this.slots = [
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: ports[0], tcp: null },
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: ports[1], tcp: null },
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

    if (type === 'manual') {
      info.tcp?.close();
      info.tcp = null;
      info.state = 'ready';
      info.name  = '手動操作';
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

  setDoubleMode(enabled: boolean): void {
    if (this.phase !== 'setup') return;
    this.doubleMode = enabled;
    this.emitStatus();
  }

  setTurnDelay(ms: number): void {
    this.turnDelayMs = Math.max(0, Math.min(10000, ms));
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
    const result = await session.run(clients, this.map, log, this.turnDelayMs);
    console.log('Game finished:', result.status);

    // ラウンド結果を記録
    const roundResult = buildRoundResult(
      this.currentRound,
      result.status.winner as unknown as Winner,
      result.status.reason as unknown as Reason,
      result.state.teamScore,
      result.state.turnCount,
      result.state.leaveItems,
      playerNames,
    );
    this.roundResults.push(roundResult);

    if (this.doubleMode && this.currentRound === 0) {
      // 試合1終了 → スロット入れ替え、試合2待機
      this.swapSlotConfigs();
      this.currentRound = 1;
      this.phase = 'finished';
    } else {
      this.phase = 'finished';
    }
    this.emitStatus();
  }

  async requestNextRound(): Promise<void> {
    if (this.phase !== 'finished') return;
    if (!this.doubleMode || this.currentRound !== 1) return;
    if (this.roundResults.length >= 2) return; // 試合2は終了済み

    // スロット初期化 (スワップ済みの processConfig で再起動)
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp   = null;
      slot.state = 'waiting';
      slot.name  = '';
      slot.ip    = '';
      slot.error = undefined;
    }
    this.phase = 'setup';
    this.emitStatus();
    await this.startListening(0);
    await this.startListening(1);
  }

  async requestReset(): Promise<void> {
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp           = null;
      slot.type          = DEFAULT_TYPE;
      slot.state         = 'waiting';
      slot.name          = '';
      slot.ip            = '';
      slot.error         = undefined;
      slot.processConfig = undefined;
    }
    this.map          = createRandomMap(undefined, this.mapParams.blockNum, this.mapParams.itemNum, this.mapParams.turnNum, this.mapParams.mirror);
    this.phase        = 'setup';
    this.currentRound = 0;
    this.roundResults = [];

    await this.startListening(0);
    await this.startListening(1);
    this.emitStatus();
  }

  shutdown(): void {
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp = null;
    }
  }

  getStatus(): ServerStatusPayload {
    return {
      phase:        this.phase,
      localIP:      this.localIP,
      clients:      [toPayload(this.slots[0]), toPayload(this.slots[1])],
      doubleMode:   this.doubleMode,
      currentRound: this.currentRound,
      roundResults: this.roundResults,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private swapSlotConfigs(): void {
    const cfg0 = this.slots[0].processConfig;
    const cfg1 = this.slots[1].processConfig;
    const type0 = this.slots[0].type;
    const type1 = this.slots[1].type;
    this.slots[0].processConfig = cfg1;
    this.slots[1].processConfig = cfg0;
    // process タイプは保持、cpu/manual/tcp はそのまま交換
    this.slots[0].type = type1 === 'process' || type1 === 'tcp' || type1 === 'manual' ? type1 : type0;
    this.slots[1].type = type0 === 'process' || type0 === 'tcp' || type0 === 'manual' ? type0 : type1;
    // cpuタイプは入れ替え後も維持
    if (type0 === 'cpu') { this.slots[1].type = 'cpu'; }
    if (type1 === 'cpu') { this.slots[0].type = 'cpu'; }
    console.log(`[ServerManager] slots swapped: slot0=${this.slots[0].type}, slot1=${this.slots[1].type}`);
  }

  private async startListening(slot: 0 | 1): Promise<void> {
    const info = this.slots[slot];
    if (info.type === 'cpu') {
      // CPU は再起動不要 (setClientType で ready にされる)
      info.state = 'ready';
      info.name  = 'CPU';
      info.ip    = 'ローカル';
      this.emitStatus();
      return;
    }
    if (info.type === 'manual') {
      info.state = 'ready';
      info.name  = '手動操作';
      info.ip    = 'ローカル';
      this.emitStatus();
      return;
    }
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
    return this.slots.map((slot, i) => {
      if (slot.type === 'cpu') {
        const com = new ComClient();
        com.startup();
        return com;
      }
      if (slot.type === 'manual') {
        const mc = new ManualClient(i as 0 | 1);
        mc.startup();
        this.emit('manual_client_created', mc);
        return mc;
      }
      return slot.tcp!;
    }) as [BaseClient, BaseClient];
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }
}

function buildRoundResult(
  round:          0 | 1,
  winner:         Winner,
  reason:         Reason,
  scores:         [number, number],
  remainingTurns: number,
  leaveItems:     number,
  playerNames:    [string, string],
): RoundResult {
  const allItemsTaken = leaveItems === 0;
  const pt0 = calculatePoints(scores[0], remainingTurns, winner === Winner.COOL, allItemsTaken);
  const pt1 = calculatePoints(scores[1], remainingTurns, winner === Winner.HOT,  allItemsTaken);
  return { round, winner, reason, scores, remainingTurns, points: [pt0, pt1], playerNames };
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
