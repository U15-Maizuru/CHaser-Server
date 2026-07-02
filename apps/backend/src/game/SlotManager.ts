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
    info.type = type;
    info.error = undefined;

    if (type === 'cpu') {
      info.tcp?.close();
      info.tcp = null;
      info.state = 'ready';
      info.name  = 'CPU';
      info.ip    = 'ローカル';
      info.processConfig = undefined;
      this.emitChange();
      return;
    }

    if (type === 'manual') {
      info.tcp?.close();
      info.tcp = null;
      info.state = 'ready';
      info.name  = '手動操作';
      info.ip    = 'ローカル';
      info.processConfig = undefined;
      this.emitChange();
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

    this.emitChange();
    await this.startListening(slot);
  }

  deleteProgram(slot: 0 | 1): void {
    const info = this.slots[slot];
    info.tcp?.close();
    info.tcp           = null;
    info.processConfig = undefined;
    info.state         = 'waiting';
    info.name          = '';
    info.ip            = '';
    info.error         = undefined;
    this.emitChange();
    void this.startListening(slot);
  }

  /** requestReset 用: type を含めて完全に初期状態へ戻す (listening の再開始は呼び出し元が行う) */
  resetAllToDefault(): void {
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
  }

  /** requestNextRound 用: type (スワップ済み) は維持したまま接続状態だけ初期化する */
  resetForNextRound(): void {
    for (const slot of this.slots) {
      slot.tcp?.close();
      slot.tcp   = null;
      slot.state = 'waiting';
      slot.name  = '';
      slot.ip    = '';
      slot.error = undefined;
    }
  }

  swapSlotConfigs(): void {
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
    console.log(`[SlotManager] slots swapped: slot0=${this.slots[0].type}, slot1=${this.slots[1].type}`);
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
    if (info.type === 'cpu') {
      // CPU は再起動不要 (setClientType で ready にされる)
      info.state = 'ready';
      info.name  = 'CPU';
      info.ip    = 'ローカル';
      this.emitChange();
      return;
    }
    if (info.type === 'manual') {
      info.state = 'ready';
      info.name  = '手動操作';
      info.ip    = 'ローカル';
      this.emitChange();
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
      this.emitChange();
      return;
    }

    console.log(`[slot ${slot}] listening on port ${info.port}`);
    info.state = 'waiting';
    info.error = undefined;
    this.emitChange();

    tcp.on('connected', () => {
      info.state = 'connected';
      info.ip    = tcp.ip;
      this.emitChange();
    });

    if (info.type === 'process' && info.processConfig) {
      void this.spawnProgram(slot, tcp as ProcessClient, info.processConfig);
    } else {
      tcp.waitForClient().then(() => {
        if (info.tcp !== tcp) return;
        info.state = 'ready';
        info.name  = tcp.name;
        info.ip    = tcp.ip;
        this.emitChange();
      }).catch(() => {});
    }
  }

  private async spawnProgram(slot: 0 | 1, tcp: ProcessClient, cfg: NonNullable<SlotInfo['processConfig']>): Promise<void> {
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
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change');
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
