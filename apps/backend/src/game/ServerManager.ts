import { EventEmitter } from 'node:events';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { GameSession } from './Game.js';
import { StableLog } from '../log/StableLog.js';
import { calculateBonusBreakdown } from './GameLogic.js';
import type { GameStatus } from './types.js';
import { SlotManager } from './SlotManager.js';
import { MapManager } from './MapManager.js';
import { RoundController } from './RoundController.js';
import { START_COUNTDOWN_SECONDS, Winner } from '@u15/ws-types';
import type { ManualClient } from '../clients/ManualClient.js';
import { pickRandomPair } from '../programCatalog.js';
import type {
  CatalogEntry,
  ClientType,
  DisplayPrefs,
  InlineMapData,
  MapParams,
  ProcessConfig,
  RoundResult,
  ServerStatusPayload,
  Reason,
} from '@u15/ws-types';
import { DEFAULT_DISPLAY_PREFS } from '@u15/ws-types';

// デモモード (無人自動進行) で、各フェーズ完了から次の操作を自動実行するまでの待機時間
export interface DemoDelaysMs {
  start:     number; // setup 完了 → 自動 requestStart
  nextRound: number; // 2試合制: 1試合目終了 → 自動 requestNextRound
  repeat:    number; // 最終戦終了 (repeatMode 併用時) → 自動 requestRepeat
}
const DEFAULT_DEMO_DELAYS_MS: DemoDelaysMs = { start: 3_000, nextRound: 5_000, repeat: 10_000 };

// Events emitted:
//   'status'          (payload: ServerStatusPayload)
//   'session_created' (session: GameSession, playerNames: [string, string])
//   'manual_client_created' (mc: ManualClient)
export class ServerManager extends EventEmitter {
  private readonly slots: SlotManager;
  private readonly mapManager: MapManager;
  private readonly round: RoundController;
  private readonly localIP: string;
  private readonly startDelayMs: number;
  private readonly demoDelaysMs: DemoDelaysMs;
  private darkMode = false;
  private displayPrefs: DisplayPrefs = { ...DEFAULT_DISPLAY_PREFS };
  private demoTimer: ReturnType<typeof setTimeout> | null = null;
  private logDir = '.';
  private roomId = 'local';

  constructor(
    ports: [number, number] = [12031, 12032],
    startDelayMs = START_COUNTDOWN_SECONDS * 1000,
    demoDelaysMs: DemoDelaysMs = DEFAULT_DEMO_DELAYS_MS,
  ) {
    super();
    this.localIP   = getLocalIP();
    this.startDelayMs = startDelayMs;
    this.demoDelaysMs = demoDelaysMs;
    this.slots     = new SlotManager(ports);
    this.mapManager = new MapManager();
    this.round     = new RoundController();

    this.slots.on('change', () => {
      this.emitStatus();
      this.maybeAutoStartDemo();
    });
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

  setRepeatMode(enabled: boolean): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.round.setRepeatMode(enabled);
    this.emitStatus();
  }

  setDemoMode(enabled: boolean): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.round.setDemoMode(enabled);
    if (!enabled) this.clearDemoTimer();
    if (enabled) void this.randomizeFromCatalog(); // ライブラリから両スロットへランダムに割り当てる
    this.emitStatus();
  }

  /** RoomManager から room 作成直後に呼ばれる。ライブラリ選出時の libPath 組み立てに使う。 */
  setRoomId(id: string): void {
    this.roomId = id;
  }

  setDarkMode(enabled: boolean): void {
    this.darkMode = enabled;
    this.emitStatus();
  }

  /** 観戦画面の表示・音声設定。コントロールパネルが決め、全観戦画面に配信される */
  setDisplayPrefs(patch: Partial<DisplayPrefs>): void {
    this.displayPrefs = { ...this.displayPrefs, ...patch };
    this.emitStatus();
  }

  setTurnDelay(ms: number): void {
    this.round.setTurnDelay(ms);
  }

  setTcpTimeout(ms: number): void {
    this.slots.setTcpTimeout(Math.max(1000, Math.min(60000, ms)));
  }

  /**
   * ログ保存先・Pythonコマンドの上書きはローカルの Electron アプリからのみ許可する。
   * U15_MODE=web (ブラウザから誰でもルームを作成できる公開モード) では、リモートの
   * クライアントがサーバー上の任意パスへの書き込み・任意コマンドの実行経路に触れる
   * ことになるため、常に無視する。
   */
  private isLocalMode(): boolean {
    return (process.env['U15_MODE'] ?? 'local') === 'local';
  }

  setLogDir(dir: string): void {
    if (!this.isLocalMode()) return;
    this.logDir = dir;
  }

  setPythonCommand(command: string): void {
    if (!this.isLocalMode()) return;
    this.slots.setPythonCommand(command || undefined);
  }

  loadMap(filePath: string): void {
    if (!this.round.canEditMap()) return;
    if (this.mapManager.loadFromFile(filePath)) this.emitStatus();
  }

  setMapParams(params: MapParams): void {
    if (!this.round.canEditMap()) return;
    this.mapManager.setParams(params);
    this.emitStatus();
  }

  loadMapData(data: InlineMapData): void {
    if (!this.round.canEditMap()) return;
    this.mapManager.loadInlineData(data);
    this.emitStatus();
  }

  getCurrentMapData(): InlineMapData {
    return this.mapManager.getCurrentMapData();
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

    const log    = new StableLog(this.buildLogFilePath());
    const result = await session.run(clients, this.mapManager.map, log, this.round.turnDelayMs, this.startDelayMs);
    console.log('Game finished:', result.status);

    // ラウンド結果を記録
    const roundResult = buildRoundResult(
      this.round.currentRound,
      result.status,
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
    this.maybeAutoAdvanceDemo();
  }

  async requestNextRound(): Promise<void> {
    if (!this.round.canGoNextRound()) return;

    // スロット初期化 (スワップ済みの processConfig で再起動)
    this.slots.resetForNextRound();
    this.round.phase = 'setup';
    this.emitStatus();
    await this.slots.startListeningBoth();
  }

  /**
   * リピートモード: 接続 (processConfig) は維持したまま COOL/HOT を入れ替えて新しい対戦を始める。
   * デモモード併用時は、入れ替えの代わりにライブラリからランダムに選び直す。
   */
  async requestRepeat(): Promise<void> {
    if (!this.round.canRepeat()) return;

    if (this.round.demoMode) {
      await this.randomizeFromCatalog();
    } else {
      this.slots.swapSlotConfigs();
    }
    this.slots.resetForNextRound();
    this.mapManager.regenerate();
    this.round.resetForNewGame();

    await this.slots.startListeningBoth();
    this.emitStatus();
  }

  async requestReset(): Promise<void> {
    this.clearDemoTimer();
    this.slots.resetAllToDefault();
    this.mapManager.regenerate();
    this.round.resetForNewGame();

    await this.slots.startListeningBoth();
    this.emitStatus();
  }

  shutdown(): void {
    this.clearDemoTimer();
    this.slots.shutdown();
  }

  getStatus(): ServerStatusPayload {
    return {
      phase:        this.round.phase,
      localIP:      this.localIP,
      clients:      this.slots.getStatuses(),
      doubleMode:   this.round.doubleMode,
      repeatMode:   this.round.repeatMode,
      demoMode:     this.round.demoMode,
      currentRound: this.round.currentRound,
      roundResults: this.round.roundResults,
      darkMode:     this.darkMode,
      mapIsCustom:  this.mapManager.isCustom,
      displayPrefs: this.displayPrefs,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  /** デモモード: setup で両スロットが ready になったら自動的に対戦を開始する */
  private maybeAutoStartDemo(): void {
    if (!this.round.demoMode) return;
    if (!this.round.canStart()) return;
    if (!this.slots.allReady()) return;
    if (this.demoTimer) return; // 既に予約済み

    this.demoTimer = setTimeout(() => {
      this.demoTimer = null;
      void this.requestStart();
    }, this.demoDelaysMs.start);
  }

  /** デモモード: 対戦終了後、次戦 (2試合制) またはリピートへ自動的に進める */
  private maybeAutoAdvanceDemo(): void {
    if (!this.round.demoMode) return;
    if (this.demoTimer) return; // 既に予約済み

    if (this.round.canGoNextRound()) {
      this.demoTimer = setTimeout(() => {
        this.demoTimer = null;
        void this.requestNextRound();
      }, this.demoDelaysMs.nextRound);
    } else if (this.round.canRepeat()) {
      this.demoTimer = setTimeout(() => {
        this.demoTimer = null;
        void this.requestRepeat();
      }, this.demoDelaysMs.repeat);
    }
  }

  /** デモモード: プログラムライブラリからランダムに2つ選び、両スロットへ割り当てる。ライブラリが空なら何もしない。 */
  private async randomizeFromCatalog(): Promise<void> {
    const pair = pickRandomPair();
    if (!pair) return;

    const buildConfig = (entry: CatalogEntry, slot: 0 | 1): ProcessConfig => ({
      programType:    entry.programType,
      programPath:    entry.programPath,
      runtimeCommand: entry.runtimeCommand,
      libPath:        `server/rooms/${this.roomId}/libs/${slot === 0 ? 'cool' : 'hot'}`,
    });

    await this.slots.setClientType(0, 'process', buildConfig(pair[0], 0));
    await this.slots.setClientType(1, 'process', buildConfig(pair[1], 1));
  }

  /** 試合ごとに一意なログファイルパスを組み立てる (日時+ラウンド番号)。保存先ディレクトリも用意する。 */
  private buildLogFilePath(): string {
    fs.mkdirSync(this.logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.logDir, `game-${timestamp}-round${this.round.currentRound}.log`);
  }

  private clearDemoTimer(): void {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }
  }
}

function buildRoundResult(
  round:          0 | 1,
  status:         GameStatus,
  scores:         [number, number],
  remainingTurns: number,
  leaveItems:     number,
  playerNames:    [string, string],
): RoundResult {
  const { strikeBonus, sweepBonus } = calculateBonusBreakdown(status, scores, leaveItems);
  return {
    round,
    winner: status.winner,
    reason: status.reason,
    scores,
    remainingTurns,
    strikeBonus,
    sweepBonus,
    playerNames,
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
