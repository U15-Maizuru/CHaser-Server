import { EventEmitter } from 'node:events';
import { TcpClient } from '../network/TcpClient.js';
import { ComClient } from '../clients/ComClient.js';
import { ProcessClient } from '../clients/ProcessClient.js';
import { ManualClient } from '../clients/ManualClient.js';
import type { BaseClient } from '../network/BaseClient.js';
import type {
  ClientType,
  ClientState,
  ClientStatusPayload,
  ProcessConfig,
} from '@u15/ws-types';

const DEFAULT_TYPE: ClientType = 'process';

/**
 * 接続を伴わないクライアント種別の表示。名前と接続元はクライアント実装
 * (ComClient / ManualClient) が持つ値と揃える。
 */
const LOCAL_CLIENT_LABEL: Partial<Record<ClientType, { name: string; ip: string }>> = {
  cpu:    { name: ComClient.DISPLAY_NAME,    ip: ComClient.DISPLAY_IP },
  manual: { name: ManualClient.DISPLAY_NAME, ip: ManualClient.DISPLAY_IP },
};

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
//   'change'                (スロット状態が変化した — 呼び出し元は emitStatus 相当の処理を行う)
//   'manual_client_created' (mc: ManualClient)
export class SlotManager extends EventEmitter {
  private slots: [SlotInfo, SlotInfo];
  private timeoutMs = 10_000;
  private pythonCommandOverride: string | undefined;

  constructor(ports: [number, number]) {
    super();
    this.slots = [
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: ports[0], tcp: null },
      { type: DEFAULT_TYPE, state: 'waiting', name: '', ip: '', port: ports[1], tcp: null },
    ];
    void this.startListening(0);
    void this.startListening(1);
  }

  async setClientType(slot: 0 | 1, type: ClientType, processConfig?: ProcessConfig): Promise<void> {
    const info = this.slots[slot];
    disconnect(info);
    info.type = type;
    // processConfig を持つのは process のときだけ。他の型に移ったら必ず捨てる
    info.processConfig = type === 'process' ? processConfig : undefined;

    if (markLocalReady(info)) {
      // cpu / manual は接続を待たないのでここで完了。listening も張らない
      this.emitChange();
      return;
    }

    this.emitChange();
    await this.startListening(slot);
  }

  deleteProgram(slot: 0 | 1): void {
    const info = this.slots[slot];
    disconnect(info);
    info.processConfig = undefined;
    this.emitChange();
    void this.startListening(slot);
  }

  /** requestReset 用: type を含めて完全に初期状態へ戻す (listening の再開始は呼び出し元が行う) */
  resetAllToDefault(): void {
    for (const slot of this.slots) {
      disconnect(slot);
      slot.type          = DEFAULT_TYPE;
      slot.processConfig = undefined;
    }
  }

  /** requestNextRound 用: type (スワップ済み) は維持したまま接続状態だけ初期化する */
  resetForNextRound(): void {
    for (const slot of this.slots) {
      disconnect(slot);
    }
  }

  /** 両スロットの type と processConfig を入れ替える (2ゲーム制の先後入れ替え用) */
  swapSlotConfigs(): void {
    [this.slots[0].type, this.slots[1].type] =
      [this.slots[1].type, this.slots[0].type];
    [this.slots[0].processConfig, this.slots[1].processConfig] =
      [this.slots[1].processConfig, this.slots[0].processConfig];
    console.log(`[SlotManager] slots swapped: slot0=${this.slots[0].type}, slot1=${this.slots[1].type}`);
  }

  /** 次に spawnProgram するプロセスから有効になる (実行中のプロセスには影響しない) */
  setPythonCommand(command: string | undefined): void {
    this.pythonCommandOverride = command;
  }

  /** 実行中の接続にも即座に反映する。次に生成するクライアントの既定値としても使う。 */
  setTcpTimeout(ms: number): void {
    this.timeoutMs = ms;
    for (const slot of this.slots) {
      slot.tcp?.updateTimeout(ms);
    }
  }

  allReady(): boolean {
    return this.slots.every(s => s.state === 'ready');
  }

  getPlayerNames(): [string, string] {
    return [this.slots[0].name, this.slots[1].name];
  }

  getStatuses(): [ClientStatusPayload, ClientStatusPayload] {
    return [toPayload(this.slots[0]), toPayload(this.slots[1])];
  }

  buildClients(): [BaseClient, BaseClient] {
    return this.slots.map((slot, i) => {
      if (slot.type === 'cpu') {
        const com = new ComClient(i as 0 | 1);
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
    }) as unknown as [BaseClient, BaseClient];
  }

  /** 両スロットの listening を順番に (再) 開始する */
  async startListeningBoth(): Promise<void> {
    await this.startListening(0);
    await this.startListening(1);
  }

  shutdown(): void {
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp = null;
    }
  }

  private async startListening(slot: 0 | 1): Promise<void> {
    const info = this.slots[slot];

    // cpu / manual は接続を待たない (setClientType でも同じ扱いをする)
    if (markLocalReady(info)) {
      this.emitChange();
      return;
    }
    if (info.type !== 'tcp' && info.type !== 'process') return;

    const tcp = info.type === 'process' ? new ProcessClient(this.timeoutMs) : new TcpClient(this.timeoutMs);
    info.tcp = tcp;

    // 非同期の待ち合わせから戻ってきた時点で、待っている間に setClientType 等で
    // スロットが差し替わっていることがある。その場合は古い接続の結果を書き戻さない。
    const ifCurrent = (fn: () => void) => {
      if (info.tcp !== tcp) return;
      fn();
      this.emitChange();
    };

    try {
      await tcp.listen(info.port);
    } catch (e) {
      const msg = (e as Error).message;
      ifCurrent(() => {
        console.error(`[slot ${slot}] listen failed on port ${info.port}:`, msg);
        info.state = 'waiting';
        info.error = `ポート ${info.port} のリッスンに失敗: ${msg}`;
      });
      return;
    }

    if (info.tcp !== tcp) return;
    console.log(`[slot ${slot}] listening on port ${info.port}`);
    info.state = 'waiting';
    info.error = undefined;
    this.emitChange();

    tcp.on('connected', () => {
      info.state = 'connected';
      info.ip    = tcp.ip;
      this.emitChange();
    });

    // 対戦開始後 (waitForClient() 成立後) に Python プロセスが異常終了した場合、
    // spawnProgram() の catch では拾えないため、ここで受けて管理画面にエラーを表示する。
    if (tcp instanceof ProcessClient) {
      tcp.on('crashed', ({ message }: { message: string }) => {
        ifCurrent(() => {
          console.error(`[slot ${slot}] process crashed:`, message);
          info.error = message;
        });
      });
    }

    if (info.type === 'process' && info.processConfig) {
      void this.spawnProgram(slot, tcp as ProcessClient, info.processConfig, ifCurrent);
    } else {
      tcp.waitForClient()
        .then(() => ifCurrent(() => markConnected(info, tcp)))
        .catch(() => {});
    }
  }

  private async spawnProgram(
    slot: 0 | 1,
    tcp: ProcessClient,
    cfg: NonNullable<SlotInfo['processConfig']>,
    ifCurrent: (fn: () => void) => void,
  ): Promise<void> {
    const info = this.slots[slot];
    try {
      await tcp.startProgram(info.port, cfg.programType, cfg.programPath, cfg.runtimeCommand, cfg.libPath, this.pythonCommandOverride);
      ifCurrent(() => {
        markConnected(info, tcp);
        info.error = undefined;
      });
    } catch (e) {
      const msg = (e as Error).message;
      ifCurrent(() => {
        console.error(`[slot ${slot}] process failed:`, msg);
        info.state = 'waiting';
        info.error = `プログラムの起動に失敗: ${msg}`;
      });
    }
  }

  private emitChange(): void {
    this.emit('change');
  }
}

/** 接続を切って「誰も繋がっていない」状態に戻す (type と processConfig はそのまま) */
function disconnect(info: SlotInfo): void {
  info.tcp?.close();
  info.tcp   = null;
  info.state = 'waiting';
  info.name  = '';
  info.ip    = '';
  info.error = undefined;
}

/**
 * cpu / manual なら接続を待たずに ready にして true を返す。
 * それ以外の型なら何もせず false (呼び出し側が listening を張る)。
 */
function markLocalReady(info: SlotInfo): boolean {
  const label = LOCAL_CLIENT_LABEL[info.type];
  if (!label) return false;
  info.state = 'ready';
  info.name  = label.name;
  info.ip    = label.ip;
  return true;
}

/** TCP 越しの相手が名乗り終わった状態にする */
function markConnected(info: SlotInfo, tcp: TcpClient): void {
  info.state = 'ready';
  info.name  = tcp.name;
  info.ip    = tcp.ip;
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
