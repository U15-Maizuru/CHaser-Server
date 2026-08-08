import type { WebSocket } from 'ws';
import type { RoomManager } from '../RoomManager.js';
import type { ManualClient } from '../clients/ManualClient.js';
import type { TournamentOrchestrator } from '../tournament/TournamentOrchestrator.js';
import type { FrontendMessage } from '@u15/ws-types';

export interface GameMessageDispatchDeps {
  getRoomManualClients: (roomId: string) => Map<0 | 1, ManualClient> | undefined;
  sendError:            (ws: WebSocket, message: string) => void;
  /** 大会運営 (未配線なら大会メッセージは無視される) */
  tournament?:          TournamentOrchestrator;
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
        manager.loadMap(msg.payload.catalogId);
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
      case 'set_display_prefs':
        manager.setDisplayPrefs(msg.payload);
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

      // ── 大会運営 ──
      // 操作は運営の意図どおりに通るか、理由付きで断られるかのどちらかであるべきなので、
      // 他のゲームメッセージと違い失敗を握りつぶさず sendError で返す。
      case 'tournament_bind':
        this.tournament(ws, t => t.bind(roomId, msg.payload.tournamentId));
        break;
      case 'tournament_unbind':
        this.tournament(ws, t => t.unbind(roomId));
        break;
      case 'tournament_arm_match':
        this.tournamentAsync(ws, t => t.armMatch(roomId, msg.payload.matchId));
        break;
      case 'tournament_confirm_result':
        this.tournament(ws, t =>
          t.confirmResult(roomId, msg.payload.matchId, msg.payload.winnerSide, msg.payload.note));
        break;
      case 'tournament_discard_result':
        this.tournament(ws, t =>
          t.discardResult(roomId, msg.payload.matchId, msg.payload.rematchMapCatalogId));
        break;
      case 'tournament_reopen_match':
        this.tournament(ws, t =>
          t.reopenMatch(roomId, msg.payload.matchId, msg.payload.cascade ?? false));
        break;
      case 'tournament_set_walkover':
        this.tournament(ws, t =>
          t.setWalkover(roomId, msg.payload.matchId, msg.payload.winnerSide));
        break;
      case 'tournament_assign_program':
        this.tournament(ws, t =>
          t.assignProgram(roomId, msg.payload.participantId, msg.payload.catalogId));
        break;
      case 'tournament_set_stage_map':
        this.tournament(ws, t =>
          t.setStageMap(roomId, msg.payload.stage, msg.payload.mapCatalogId));
        break;
      case 'tournament_set_qualifier':
        this.tournament(ws, t =>
          t.setQualifier(
            roomId, msg.payload.group, msg.payload.rank,
            msg.payload.participantId, msg.payload.cascade ?? false,
          ));
        break;
      case 'tournament_exclude_qualifier':
        this.tournament(ws, t =>
          t.setQualifierExclusion(
            roomId, msg.payload.participantId, msg.payload.excluded,
            msg.payload.cascade ?? false,
          ));
        break;
      case 'tournament_confirm_qualifiers':
        this.tournament(ws, t => t.confirmQualifiers(roomId, msg.payload.confirmed));
        break;
      case 'tournament_set_display_view':
        this.tournament(ws, t => t.setDisplayView(roomId, msg.payload.view));
        break;
      case 'tournament_set_auto_play':
        this.tournament(ws, t => t.setAutoPlay(roomId, msg.payload.enabled, msg.payload.loop));
        break;
      case 'tournament_rescan':
        this.tournament(ws, t => t.rescan(roomId));
        break;
    }
  }

  private tournament(ws: WebSocket, fn: (t: TournamentOrchestrator) => void): void {
    const t = this.deps.tournament;
    if (!t) return;
    try {
      fn(t);
    } catch (e) {
      this.deps.sendError(ws, (e as Error).message);
    }
  }

  private tournamentAsync(ws: WebSocket, fn: (t: TournamentOrchestrator) => Promise<void>): void {
    const t = this.deps.tournament;
    if (!t) return;
    fn(t).catch((e: Error) => this.deps.sendError(ws, e.message));
  }
}
