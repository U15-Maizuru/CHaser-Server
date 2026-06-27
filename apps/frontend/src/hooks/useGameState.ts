import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientType,
  FrontendMessage,
  GameEndPayload,
  GameStateSnapshot,
  InlineMapData,
  MapParams,
  ProcessConfig,
  ServerStatusPayload,
  TurnStartPayload,
  WsMessage,
} from '@u15/ws-types';

export interface GameStateHook {
  snapshot:     GameStateSnapshot   | null;
  turnInfo:     TurnStartPayload    | null;
  gameEnd:      GameEndPayload      | null;
  serverStatus: ServerStatusPayload | null;
  isConnected:  boolean;
  manualRequest: { slot: 0 | 1; aroundData: number[] } | null;
  // Commands
  setClient:       (slot: 0 | 1, type: ClientType, processConfig?: ProcessConfig) => void;
  deleteProgram:   (slot: 0 | 1) => void;
  requestStart:    () => void;
  requestReset:    () => void;
  requestNextRound:() => void;
  setDoubleMode:   (enabled: boolean) => void;
  setTurnDelay:    (ms: number) => void;
  sendManualAction:(slot: 0 | 1, action: number, rote: number) => void;
  loadMap:         (filePath: string) => void;
  setMapParams:    (params: MapParams) => void;
  loadMapData:     (data: InlineMapData) => void;
}

export function useGameState(wsUrl: string): GameStateHook {
  const [snapshot,      setSnapshot]      = useState<GameStateSnapshot   | null>(null);
  const [turnInfo,      setTurnInfo]      = useState<TurnStartPayload    | null>(null);
  const [gameEnd,       setGameEnd]       = useState<GameEndPayload      | null>(null);
  const [serverStatus,  setServerStatus]  = useState<ServerStatusPayload | null>(null);
  const [isConnected,   setIsConnected]   = useState(false);
  const [manualRequest, setManualRequest] = useState<{ slot: 0 | 1; aroundData: number[] } | null>(null);

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

    ws.onopen = () => setIsConnected(true);

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage;
      switch (msg.type) {
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
  }, [wsUrl]);

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
    setClient:        (slot, type, processConfig) => send({ type: 'set_client',        payload: { slot, clientType: type, processConfig } }),
    deleteProgram:    (slot)                       => send({ type: 'delete_program',    payload: { slot } }),
    requestStart:     ()                           => send({ type: 'request_start' }),
    requestReset:     ()                           => send({ type: 'request_reset' }),
    requestNextRound: ()                           => send({ type: 'request_next_round' }),
    setDoubleMode:    (enabled)                    => send({ type: 'set_double_mode',   payload: { enabled } }),
    setTurnDelay:     (ms)                         => send({ type: 'set_turn_delay',    payload: { ms } }),
    sendManualAction: (slot, action, rote)         => send({ type: 'manual_action',     payload: { slot, action, rote } }),
    loadMap:          (filePath)                   => send({ type: 'load_map',          payload: { filePath } }),
    setMapParams:     (params)                     => send({ type: 'set_map_params',    payload: params }),
    loadMapData:      (data)                       => send({ type: 'load_map_data',     payload: data }),
  };
}
