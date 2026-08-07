import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientType,
  DisplayPrefs,
  FrontendMessage,
  GameEndPayload,
  GameStateSnapshot,
  InlineMapData,
  LobbyMessage,
  MapParams,
  ProcessConfig,
  ServerStatusPayload,
  TournamentDisplayView,
  TournamentStatePayload,
  TurnStartPayload,
  WsMessage,
} from '@u15/ws-types';

/** 大会運営の操作。サーバーが受け付けなければ error メッセージで理由が返る */
export interface TournamentCommands {
  bind:     (tournamentId: string) => void;
  unbind:   () => void;
  arm:      (matchId: string) => void;
  confirm:  (matchId: string, winnerSide?: 0 | 1, note?: string) => void;
  discard:  (matchId: string, rematchMapCatalogId?: string) => void;
  reopen:   (matchId: string, cascade?: boolean) => void;
  walkover: (matchId: string, winnerSide: 0 | 1 | null) => void;
  assignProgram: (participantId: string, catalogId: string | null) => void;
  /** 回戦ごとのマップ差し替え。null は「大会の設定に従う」 */
  setStageMap: (stage: number, mapCatalogId: string | null) => void;
  /** 決勝進出者の手動差し替え。participantId: null は「自動判定に戻す」 */
  setQualifier: (
    group: number, rank: number, participantId: string | null, cascade?: boolean,
  ) => void;
  /** 決勝進出者の確定 / 確定の取り消し。確定するまで観戦画面は予選の結果を出し続ける */
  confirmQualifiers: (confirmed: boolean) => void;
  /** 観戦画面に出すものの切り替え (運営席の表示とは連動しない) */
  setDisplayView: (view: TournamentDisplayView) => void;
  rescan:   () => void;
}

export interface GameStateHook {
  snapshot:     GameStateSnapshot   | null;
  turnInfo:     TurnStartPayload    | null;
  gameEnd:      GameEndPayload      | null;
  serverStatus: ServerStatusPayload | null;
  isConnected:  boolean;
  manualRequest: { slot: 0 | 1; aroundData: number[] } | null;
  /** この部屋で運営中の大会。紐付いていなければ null */
  tournamentState: TournamentStatePayload | null;
  /** サーバーが操作を断った理由 (表示したら clearError で消す) */
  lastError:    string | null;
  clearError:   () => void;
  // Commands
  setClient:        (slot: 0 | 1, type: ClientType, processConfig?: ProcessConfig) => void;
  deleteProgram:    (slot: 0 | 1) => void;
  requestStart:     () => void;
  requestReset:     () => void;
  requestNextRound: () => void;
  setDoubleMode:    (enabled: boolean) => void;
  setRepeatMode:    (enabled: boolean) => void;
  requestRepeat:    () => void;
  setDemoMode:      (enabled: boolean) => void;
  setDarkMode:      (enabled: boolean) => void;
  setDisplayPrefs:  (patch: Partial<DisplayPrefs>) => void;
  setTurnDelay:     (ms: number) => void;
  setTcpTimeout:    (ms: number) => void;
  setLogDir:        (dir: string) => void;
  setPythonCommand: (command: string) => void;
  sendManualAction: (slot: 0 | 1, action: number, rote: number) => void;
  loadMap:          (catalogId: string) => void;
  setMapParams:     (params: MapParams) => void;
  loadMapData:      (data: InlineMapData) => void;
  tournament:       TournamentCommands;
}

export function useGameState(wsUrl: string, roomId: string): GameStateHook {
  const [snapshot,      setSnapshot]      = useState<GameStateSnapshot   | null>(null);
  const [turnInfo,      setTurnInfo]      = useState<TurnStartPayload    | null>(null);
  const [gameEnd,       setGameEnd]       = useState<GameEndPayload      | null>(null);
  const [serverStatus,  setServerStatus]  = useState<ServerStatusPayload | null>(null);
  const [isConnected,   setIsConnected]   = useState(false);
  const [manualRequest, setManualRequest] = useState<{ slot: 0 | 1; aroundData: number[] } | null>(null);
  const [tournamentState, setTournamentState] = useState<TournamentStatePayload | null>(null);
  const [lastError,     setLastError]     = useState<string | null>(null);

  const wsRef    = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((msg: FrontendMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // 接続直後にルームに参加する
      ws.send(JSON.stringify({ type: 'join_room', payload: { roomId } } satisfies FrontendMessage));
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage | LobbyMessage;
      switch (msg.type) {
        // ロビー向けメッセージ。ルーム参加後のこのフックでは扱わない (呼び出し側の
        // ロビー画面が別途 WebSocket を張って処理する)
        case 'room_joined':
        case 'room_list':
        case 'room_created':
          break;
        // 大会運営の操作が断られた理由などが届く (黙って消さず UI に見せる)
        case 'error':
          setLastError(msg.payload.message);
          break;
        case 'tournament_state':
          setTournamentState(msg.payload);
          break;
        case 'server_status':
          setServerStatus(msg.payload);
          if (msg.payload.phase === 'setup') {
            setSnapshot(null);
            setTurnInfo(null);
            setGameEnd(null);
          }
          break;
        case 'game_state':
          setSnapshot(msg.payload);
          setGameEnd(null);
          break;
        case 'turn_start':
          setTurnInfo(msg.payload);
          break;
        // スコアは game_state (snapshot) 経由で伝わるため、通知のみで状態更新は不要
        case 'score_update':
          break;
        case 'manual_request':
          setManualRequest(msg.payload);
          break;
        case 'game_end':
          setGameEnd(msg.payload);
          break;
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      setIsConnected(false);
      retryRef.current = setTimeout(connect, 2000);
    };
  }, [wsUrl, roomId]);

  useEffect(() => {
    connect();
    return () => {
      retryRef.current && clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    snapshot,
    turnInfo,
    gameEnd,
    serverStatus,
    isConnected,
    manualRequest,
    tournamentState,
    lastError,
    clearError:       ()                           => setLastError(null),
    setClient:        (slot, type, processConfig) => send({ type: 'set_client',        payload: { slot, clientType: type, processConfig } }),
    deleteProgram:    (slot)                       => send({ type: 'delete_program',    payload: { slot } }),
    requestStart:     ()                           => send({ type: 'request_start' }),
    requestReset:     ()                           => send({ type: 'request_reset' }),
    requestNextRound: ()                           => send({ type: 'request_next_round' }),
    setDoubleMode:    (enabled)                    => send({ type: 'set_double_mode',   payload: { enabled } }),
    setRepeatMode:    (enabled)                    => send({ type: 'set_repeat_mode',   payload: { enabled } }),
    requestRepeat:    ()                           => send({ type: 'request_repeat' }),
    setDemoMode:      (enabled)                    => send({ type: 'set_demo_mode',     payload: { enabled } }),
    setDarkMode:      (enabled)                    => send({ type: 'set_dark_mode',     payload: { enabled } }),
    setDisplayPrefs:  (patch)                      => send({ type: 'set_display_prefs', payload: patch }),
    setTurnDelay:     (ms)                         => send({ type: 'set_turn_delay',    payload: { ms } }),
    setTcpTimeout:    (ms)                         => send({ type: 'set_tcp_timeout',   payload: { ms } }),
    setLogDir:        (dir)                        => send({ type: 'set_log_dir',       payload: { dir } }),
    setPythonCommand: (command)                    => send({ type: 'set_python_command', payload: { command } }),
    sendManualAction: (slot, action, rote)         => send({ type: 'manual_action',     payload: { slot, action, rote } }),
    loadMap:          (catalogId)                  => send({ type: 'load_map',          payload: { catalogId } }),
    setMapParams:     (params)                     => send({ type: 'set_map_params',    payload: params }),
    loadMapData:      (data)                       => send({ type: 'load_map_data',     payload: data }),
    tournament: {
      bind:     (tournamentId)        => send({ type: 'tournament_bind',           payload: { tournamentId } }),
      unbind:   ()                    => send({ type: 'tournament_unbind' }),
      arm:      (matchId)             => send({ type: 'tournament_arm_match',      payload: { matchId } }),
      confirm:  (matchId, winnerSide, note) =>
        send({ type: 'tournament_confirm_result', payload: { matchId, winnerSide, note } }),
      discard:  (matchId, rematchMapCatalogId) =>
        send({ type: 'tournament_discard_result', payload: { matchId, rematchMapCatalogId } }),
      reopen:   (matchId, cascade)    => send({ type: 'tournament_reopen_match',   payload: { matchId, cascade } }),
      walkover: (matchId, winnerSide) => send({ type: 'tournament_set_walkover',   payload: { matchId, winnerSide } }),
      assignProgram: (participantId, catalogId) =>
        send({ type: 'tournament_assign_program', payload: { participantId, catalogId } }),
      setStageMap: (stage, mapCatalogId) =>
        send({ type: 'tournament_set_stage_map', payload: { stage, mapCatalogId } }),
      setQualifier: (group, rank, participantId, cascade) =>
        send({ type: 'tournament_set_qualifier', payload: { group, rank, participantId, cascade } }),
      confirmQualifiers: (confirmed) =>
        send({ type: 'tournament_confirm_qualifiers', payload: { confirmed } }),
      setDisplayView: (view) =>
        send({ type: 'tournament_set_display_view', payload: { view } }),
      rescan:   ()                    => send({ type: 'tournament_rescan' }),
    },
  };
}
