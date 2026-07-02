import { EventEmitter } from 'node:events';
import os from 'node:os';
import { GameSession } from './Game.js';
import { StableLog } from '../log/StableLog.js';
import { calculatePoints } from './GameLogic.js';
import { SlotManager } from './SlotManager.js';
import { MapManager } from './MapManager.js';
import { RoundController } from './RoundController.js';
import { Winner } from '@u15/ws-types';
import type { ManualClient } from '../clients/ManualClient.js';
import type {
  ClientType,
  InlineMapData,
  MapParams,
  ProcessConfig,
  RoundResult,
  ServerStatusPayload,
  Reason,
} from '@u15/ws-types';

// Events emitted:
//   'status'          (payload: ServerStatusPayload)
//   'session_created' (session: GameSession, playerNames: [string, string])
//   'manual_client_created' (mc: ManualClient)
export class ServerManager extends EventEmitter {
  private readonly slots: SlotManager;
  private readonly mapManager: MapManager;
  private readonly round: RoundController;
  private readonly localIP: string;

  constructor(ports: [number, number] = [12031, 12032]) {
    super();
    this.localIP   = getLocalIP();
    this.slots     = new SlotManager(ports);
    this.mapManager = new MapManager();
    this.round     = new RoundController();

    this.slots.on('change', () => this.emitStatus());
    this.slots.on('manual_client_created', (mc: ManualClient) => this.emit('manual_client_created', mc));
  }

  // ── Public commands ────────────────────────────────────────────────────────

  async setClientType(slot: 0 | 1, type: ClientType, processConfig?: ProcessConfig): Promise<void> {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    await this.slots.setClientType(slot, type, processConfig);
  }

  deleteProgram(slot: 0 | 1): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.slots.deleteProgram(slot);
  }

  setDoubleMode(enabled: boolean): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.round.setDoubleMode(enabled);
    this.emitStatus();
  }

  setTurnDelay(ms: number): void {
    this.round.setTurnDelay(ms);
  }

  loadMap(filePath: string): void {
    if (this.mapManager.loadFromFile(filePath)) this.emitStatus();
  }

  setMapParams(params: MapParams): void {
    this.mapManager.setParams(params);
    this.emitStatus();
  }

  loadMapData(data: InlineMapData): void {
    this.mapManager.loadInlineData(data);
    this.emitStatus();
  }

  async requestStart(): Promise<void> {
    if (!this.round.canStart()) return;
    if (!this.slots.allReady()) return;

    this.round.phase = 'playing';
    this.emitStatus();

    const clients     = this.slots.buildClients();
    const playerNames  = this.slots.getPlayerNames();
    const session      = new GameSession();

    this.emit('session_created', session, playerNames);

    const log    = new StableLog('game.log');
    const result = await session.run(clients, this.mapManager.map, log, this.round.turnDelayMs);
    console.log('Game finished:', result.status);

    // ラウンド結果を記録
    const roundResult = buildRoundResult(
      this.round.currentRound,
      result.status.winner as unknown as Winner,
      result.status.reason as unknown as Reason,
      result.state.teamScore,
      result.state.turnCount,
      result.state.leaveItems,
      playerNames,
    );
    this.round.recordRoundResult(roundResult);

    if (this.round.doubleMode && this.round.currentRound === 0) {
      // 試合1終了 → スロット入れ替え、試合2待機
      this.slots.swapSlotConfigs();
    }
    this.round.advanceAfterRound();
    this.emitStatus();
  }

  async requestNextRound(): Promise<void> {
    if (!this.round.canGoNextRound()) return;

    // スロット初期化 (スワップ済みの processConfig で再起動)
    this.slots.resetForNextRound();
    this.round.phase = 'setup';
    this.emitStatus();
    await this.slots.startListeningBoth();
  }

  async requestReset(): Promise<void> {
    this.slots.resetAllToDefault();
    this.mapManager.regenerate();
    this.round.resetForNewGame();

    await this.slots.startListeningBoth();
    this.emitStatus();
  }

  shutdown(): void {
    this.slots.shutdown();
  }

  getStatus(): ServerStatusPayload {
    return {
      phase:        this.round.phase,
      localIP:      this.localIP,
      clients:      this.slots.getStatuses(),
      doubleMode:   this.round.doubleMode,
      currentRound: this.round.currentRound,
      roundResults: this.round.roundResults,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

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
