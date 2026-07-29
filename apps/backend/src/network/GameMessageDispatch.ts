import type { WebSocket } from 'ws';
import type { RoomManager } from '../RoomManager.js';
import type { ManualClient } from '../clients/ManualClient.js';
import type { FrontendMessage } from '@u15/ws-types';

export interface GameMessageDispatchDeps {
  getRoomManualClients: (roomId: string) => Map<0 | 1, ManualClient> | undefined;
  sendError:            (ws: WebSocket, message: string) => void;
}

/** ルーム内専用のゲームメッセージ (set_client / request_start / manual_action など) を処理する。 */
export class GameMessageDispatch {
  constructor(private readonly rm: RoomManager, private readonly deps: GameMessageDispatchDeps) {}

  handle(ws: WebSocket, roomId: string, msg: FrontendMessage): void {
    const room = this.rm.getRoom(roomId);
    if (!room) return;
    this.rm.touchRoom(roomId);

    const manager = room.manager;

    switch (msg.type) {
      case 'set_client':
        void manager.setClientType(msg.payload.slot, msg.payload.clientType, msg.payload.processConfig);
        break;
      case 'delete_program':
        manager.deleteProgram(msg.payload.slot);
        break;
      case 'request_start':
        this.deps.getRoomManualClients(roomId)?.clear();
        manager.requestStart().catch((e) => this.deps.sendError(ws, `ゲーム開始に失敗しました: ${(e as Error).message}`));
        break;
      case 'request_reset':
        this.deps.getRoomManualClients(roomId)?.clear();
        manager.requestReset().catch((e) => this.deps.sendError(ws, `リセットに失敗しました: ${(e as Error).message}`));
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
      case 'set_repeat_mode':
        manager.setRepeatMode(msg.payload.enabled);
        break;
      case 'set_demo_mode':
        manager.setDemoMode(msg.payload.enabled);
        break;
      case 'request_repeat':
        this.deps.getRoomManualClients(roomId)?.clear();
        manager.requestRepeat().catch((e) => this.deps.sendError(ws, `リピート開始に失敗しました: ${(e as Error).message}`));
        break;
      case 'set_dark_mode':
        manager.setDarkMode(msg.payload.enabled);
        break;
      case 'set_turn_delay':
        manager.setTurnDelay(msg.payload.ms);
        break;
      case 'set_tcp_timeout':
        manager.setTcpTimeout(msg.payload.ms);
        break;
      case 'set_log_dir':
        manager.setLogDir(msg.payload.dir);
        break;
      case 'set_python_command':
        manager.setPythonCommand(msg.payload.command);
        break;
      case 'request_next_round':
        this.deps.getRoomManualClients(roomId)?.clear();
        manager.requestNextRound().catch((e) => this.deps.sendError(ws, `次試合の開始に失敗しました: ${(e as Error).message}`));
        break;
      case 'manual_action': {
        const mc = this.deps.getRoomManualClients(roomId)?.get(msg.payload.slot);
        if (mc) mc.receiveAction(msg.payload.action, msg.payload.rote);
        break;
      }
    }
  }
}
