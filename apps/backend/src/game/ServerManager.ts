import path from 'node:path';
import { EventEmitter } from 'node:events';
import { GameSession } from './Game.js';
import { getLocalIP } from '../network/localIp.js';
import { DEFAULT_LOG_DIR, openGameLog } from '../log/StableLog.js';
import { buildRoundResult } from './roundResult.js';
import { loadLocalSettings, saveLocalSettings } from './localSettingsStore.js';

import type { GameStatus } from './types.js';
import { SlotManager } from './SlotManager.js';
import { MapManager } from './MapManager.js';
import { RoundController } from './RoundController.js';
import { buildProcessConfig } from './processConfig.js';
import { SCENE_FADE_MS, START_COUNTDOWN_SECONDS, Winner } from '@u15/ws-types';
import type { ManualClient } from '../clients/ManualClient.js';
import type { BaseClient } from '../network/BaseClient.js';
import { pickRandomPair } from '../programCatalog.js';
import { getMapCatalogEntry } from '../mapCatalog.js';
import type {
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
  nextRound: number; // 2ゲーム制: 第1ゲーム終了 → 自動 requestNextRound
  repeat:    number; // 最終ゲーム終了 (repeatMode 併用時) → 自動 requestRepeat
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
  private logDir = DEFAULT_LOG_DIR;
  private roomId = 'local';
  private readonly localMode: boolean;
  private readonly persistSettings: boolean;
  private readonly localSettingsPath: string;

  // requestStart の度に増える世代カウンタ。requestReset 等で対戦を中断した後、
  // 裏で動き続けていた session.run() が遅れて戻ってきても、古い世代の結果で
  // round/status を書き換えてしまわないようにするための番人。
  private gameToken = 0;
  private activeSession: GameSession | null = null;
  private activeClients: [BaseClient, BaseClient] | null = null;

  constructor(
    ports: [number, number] = [2009, 2010],
    // 待機画面→対戦画面の暗転が閉じきってから対戦画面がマウントされる (SCENE_FADE_MS) ぶん、
    // 開始カウントダウンの表示開始が遅れる。同じだけ実際の開始も遅らせて、観客側は常に
    // 画面が出てから新たに START_COUNTDOWN_SECONDS で 0 になるようにする
    startDelayMs = START_COUNTDOWN_SECONDS * 1000 + SCENE_FADE_MS,
    demoDelaysMs: DemoDelaysMs = DEFAULT_DEMO_DELAYS_MS,
    // 既定は起動時の環境変数。引数で渡せるようにしてあるのは web モードの挙動をテストできるようにするため
    localMode = (process.env['U15_MODE'] ?? 'local') === 'local',
    // 表示・BGM/SE・対戦ルールをディスクに永続化するか。ローカルモードの唯一の room だけが
    // opt-in する (web モードの動的 room やテストは呼び出し元が渡さない限り既定で無効)。
    // 2つとも使う呼び出し元がほぼ無いため1つのオプションにまとめ、片方だけ渡したい
    // 呼び出し元 (RoomManager) が undefined を並べて埋める必要が無いようにしている
    localPersistence: { persistSettings?: boolean; localSettingsPath?: string } = {},
  ) {
    super();
    this.localMode = localMode;
    this.persistSettings = localPersistence.persistSettings ?? false;
    this.localSettingsPath = localPersistence.localSettingsPath ?? path.resolve('server/local-settings.json');
    this.localIP   = getLocalIP();
    this.startDelayMs = startDelayMs;
    this.demoDelaysMs = demoDelaysMs;
    this.slots     = new SlotManager(ports);
    this.mapManager = new MapManager();
    this.round     = new RoundController();

    if (this.persistSettings) {
      const saved = loadLocalSettings(this.localSettingsPath);
      if (saved.darkMode !== undefined) this.darkMode = saved.darkMode;
      if (saved.displayPrefs) this.displayPrefs = { ...this.displayPrefs, ...saved.displayPrefs };
      // setDoubleMode() 等のセッターは canStart() ゲートや randomizeFromCatalog() 等の副作用を
      // 持つため、初期化はフィールドへの直接代入にする
      if (saved.doubleMode !== undefined) this.round.doubleMode = saved.doubleMode;
      if (saved.repeatMode !== undefined) this.round.repeatMode = saved.repeatMode;
      if (saved.demoMode !== undefined) this.round.demoMode = saved.demoMode;
    }

    this.slots.on('change', () => {
      this.emitStatus();
      this.maybeAutoStartDemo();
    });
    this.slots.on('manual_client_created', (mc: ManualClient) => this.emit('manual_client_created', mc));
  }

  /** persistSettings が有効なときだけ、表示・BGM/SE・対戦ルールの現在値をディスクに書く */
  private persistIfEnabled(): void {
    if (!this.persistSettings) return;
    saveLocalSettings(this.localSettingsPath, {
      darkMode:     this.darkMode,
      displayPrefs: this.displayPrefs,
      doubleMode:   this.round.doubleMode,
      repeatMode:   this.round.repeatMode,
      demoMode:     this.round.demoMode,
    });
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
    this.persistIfEnabled();
    this.emitStatus();
  }

  setRepeatMode(enabled: boolean): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.round.setRepeatMode(enabled);
    this.persistIfEnabled();
    this.emitStatus();
  }

  setDemoMode(enabled: boolean): void {
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    this.round.setDemoMode(enabled);
    if (!enabled) this.clearDemoTimer();
    if (enabled) void this.randomizeFromCatalog(); // ライブラリから両スロットへランダムに割り当てる
    this.persistIfEnabled();
    this.emitStatus();
  }

  /** RoomManager から room 作成直後に呼ばれる。ライブラリ選出時の libPath 組み立てに使う。 */
  setRoomId(id: string): void {
    this.roomId = id;
  }

  setDarkMode(enabled: boolean): void {
    this.darkMode = enabled;
    this.persistIfEnabled();
    this.emitStatus();
  }

  /** 観戦画面の表示・音声設定。コントロールパネルが決め、全観戦画面に配信される */
  setDisplayPrefs(patch: Partial<DisplayPrefs>): void {
    this.displayPrefs = { ...this.displayPrefs, ...patch };
    this.persistIfEnabled();
    this.emitStatus();
  }

  setTurnDelay(ms: number): void {
    this.round.setTurnDelay(ms);
  }

  setTcpTimeout(ms: number): void {
    this.slots.setTcpTimeout(Math.max(1000, Math.min(60000, ms)));
  }

  /**
   * COOL/HOT の待ち受けポートを変更する。ローカルモード限定 (web モードは RoomManager の
   * PortPool が部屋ごとにポートを払い出しており、任意のポートへの変更は他の部屋との
   * 衝突・二重割り当てを招くため isLocalMode() と同じ理由で弾く)。
   */
  async setPorts(ports: [number, number]): Promise<void> {
    if (!this.isLocalMode()) return;
    if (!this.round.canStart()) return; // setup フェーズ以外は変更不可
    await this.slots.setPorts(ports);
  }

  /**
   * ログ保存先・Pythonコマンドの上書きはローカルの Electron アプリからのみ許可する。
   * U15_MODE=web (ブラウザから誰でもルームを作成できる公開モード) では、リモートの
   * クライアントがサーバー上の任意パスへの書き込み・任意コマンドの実行経路に触れる
   * ことになるため、常に無視する。
   */
  private isLocalMode(): boolean {
    return this.localMode;
  }

  setLogDir(dir: string): void {
    if (!this.isLocalMode()) return;
    this.logDir = dir;
  }

  setPythonCommand(command: string): void {
    if (!this.isLocalMode()) return;
    this.slots.setPythonCommand(command || undefined);
  }

  /** マップライブラリのエントリを対戦で使う。ファイルパスの解決はここだけで行う
   *  (クライアントからサーバー上の任意パスを読ませないため) */
  loadMap(catalogId: string): void {
    if (!this.round.canEditMap()) return;
    const entry = getMapCatalogEntry(catalogId);
    if (!entry) return;
    if (this.mapManager.loadFromCatalog(entry.mapPath, entry.id, entry.displayName)) this.emitStatus();
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

    const token = ++this.gameToken;

    this.round.phase = 'playing';
    this.emitStatus();

    const clients     = this.slots.buildClients();
    const playerNames  = this.slots.getPlayerNames();
    const session      = new GameSession();
    this.activeSession = session;
    this.activeClients = clients;

    this.emit('session_created', session, playerNames);

    const log    = openGameLog(this.logDir, this.round.currentRound);
    const result = await session.run(clients, this.mapManager.map, log, this.round.turnDelayMs, this.startDelayMs);
    console.log('Game finished:', result.status);

    // 待っている間に requestReset 等で中断されていたら、この結果はもう反映しない
    // (round は既に次の状態に進んでいるので、ここで書き換えると中断が巻き戻ってしまう)
    if (token !== this.gameToken) return;
    this.activeSession = null;
    this.activeClients = null;

    // ゲーム結果を記録
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
    this.mapManager.refreshForNewGame();
    this.round.resetForNewGame();

    await this.slots.startListeningBoth();
    this.emitStatus();
  }

  async requestReset(): Promise<void> {
    this.clearDemoTimer();
    this.stopActiveGame();
    this.slots.resetAllToDefault();
    this.mapManager.refreshForNewGame();
    this.round.resetForNewGame();

    await this.slots.startListeningBoth();
    this.emitStatus();
  }

  shutdown(): void {
    this.clearDemoTimer();
    this.stopActiveGame();
    this.slots.shutdown();
  }

  /**
   * 進行中の対戦 (あれば) を強制的に打ち切る。
   *
   * - gameToken を進めて、遅れて戻ってくる requestStart の続き (結果の記録・emitStatus) を無効化する
   * - session のリスナーを外し、打ち切り後にもう一巡分の stateUpdate/gameEnd 等が
   *   WsServer 経由でフロントに届いて SE が鳴るのを防ぐ
   * - 各クライアントを forceDisconnect し、GameSession.run() のループを次のチェックポイントで
   *   終わらせる (CPU 対戦は自ら切断しないので、これをしないと画面を離れても裏で走り続ける)
   */
  private stopActiveGame(): void {
    this.gameToken++; // 遅れて戻ってくる requestStart の続きを無効化する

    this.activeSession?.removeAllListeners();
    this.activeSession = null;

    if (this.activeClients) {
      for (const client of this.activeClients) client.forceDisconnect();
      this.activeClients = null;
    }
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
      mapSource:    this.mapManager.sourceInfo,
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

  /** デモモード: ゲーム終了後、第2ゲーム (2ゲーム制) またはリピートへ自動的に進める */
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

    await this.slots.setClientType(0, 'process', buildProcessConfig(pair[0], 0, this.roomId));
    await this.slots.setClientType(1, 'process', buildProcessConfig(pair[1], 1, this.roomId));
  }

  private clearDemoTimer(): void {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }
  }
}
