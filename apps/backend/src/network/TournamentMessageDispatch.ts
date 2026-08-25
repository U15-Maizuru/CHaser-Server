import type { WebSocket } from 'ws';
import type { TournamentOrchestrator } from '../tournament/TournamentOrchestrator.js';
import type { FrontendMessage } from '@u15/ws-types';

export interface TournamentMessageDispatchDeps {
  sendError: (ws: WebSocket, message: string) => void;
  /** 大会運営。未配線なら大会メッセージは黙って無視される */
  getTournament: () => TournamentOrchestrator | null | undefined;
}

/**
 * ルーム内の大会運営メッセージ (tournament_*) を TournamentOrchestrator へ転送する。
 *
 * 操作は運営の意図どおりに通るか、理由付きで断られるかのどちらかであるべきなので、
 * 他のゲームメッセージと違い失敗を握りつぶさず sendError で返す。
 *
 * 参照を getTournament で遅延して引くのは、WsServer の配線順 (setTournament を
 * setRoomManager より先に呼ぶ) に依存しないため。以前は生成時にスナップショットしており、
 * 順序を逆にすると大会メッセージが無言で無視されていた。
 */
export class TournamentMessageDispatch {
  constructor(private readonly deps: TournamentMessageDispatchDeps) {}

  /** 処理したら true。false なら呼び出し側がゲームメッセージとして扱う */
  handle(ws: WebSocket, roomId: string, msg: FrontendMessage): boolean {
    switch (msg.type) {
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
      case 'tournament_set_match_map':
        this.tournament(ws, t =>
          t.setMatchMap(roomId, msg.payload.matchId, msg.payload.mapCatalogId));
        break;
      case 'tournament_swap_sides':
        this.tournament(ws, t => t.swapSides(roomId, msg.payload.matchId));
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
      default:
        return false;
    }
    return true;
  }

  private tournament(ws: WebSocket, fn: (t: TournamentOrchestrator) => void): void {
    const t = this.deps.getTournament();
    if (!t) return;
    try {
      fn(t);
    } catch (e) {
      this.deps.sendError(ws, (e as Error).message);
    }
  }

  private tournamentAsync(ws: WebSocket, fn: (t: TournamentOrchestrator) => Promise<void>): void {
    const t = this.deps.getTournament();
    if (!t) return;
    fn(t).catch((e: Error) => this.deps.sendError(ws, e.message));
  }
}
