import { useCallback, useEffect, useRef, useState } from 'react';
import type { LobbyMessage, RoomSummary, FrontendMessage } from '@u15/ws-types';

export interface LobbyHook {
  rooms:       RoomSummary[];
  isConnected: boolean;
  createRoom:  () => void;
}

export function useLobby(wsUrl: string): LobbyHook {
  const [rooms,       setRooms]       = useState<RoomSummary[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef    = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((msg: FrontendMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: 'list_rooms' } satisfies FrontendMessage));
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as LobbyMessage;
      switch (msg.type) {
        case 'room_list':
          setRooms(msg.payload.rooms);
          break;
        case 'room_created':
          // 作成者は control モードとして入室
          window.location.href = `?room=${msg.payload.roomId}&mode=control`;
          break;
        case 'room_joined':
          // 観戦者として display モードで入室
          window.location.href = `?room=${msg.payload.roomId}&mode=display`;
          break;
        case 'error':
          console.error('[Lobby]', msg.payload.message);
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
    rooms,
    isConnected,
    createRoom: () => send({ type: 'create_room' }),
  };
}
