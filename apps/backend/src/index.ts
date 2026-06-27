import { ServerManager } from './game/ServerManager.js';
import { WsServer } from './network/WsServer.js';
import { handleHttpRequest, ensureDirectories } from './network/HttpServer.js';
import type { ManualClient } from './clients/ManualClient.js';
import type { ProcessConfig, MapParams, InlineMapData } from '@u15/ws-types';

const PORT = 8765;

async function main() {
  ensureDirectories();

  console.log('U15 Server starting...');
  console.log(`  COOL TCP port : 12031`);
  console.log(`  HOT  TCP port : 12032`);
  console.log(`  WebSocket/HTTP: ${PORT}  (ws://localhost:${PORT})`);

  const ws      = new WsServer(PORT);
  const manager = new ServerManager();

  // Attach HTTP handler to the shared http.Server inside WsServer
  ws.httpServer.on('request', handleHttpRequest);

  // 現在アクティブな ManualClient を追跡
  const manualClients = new Map<0 | 1, ManualClient>();

  manager.on('status', (payload) => ws.broadcastStatus(payload));

  ws.on('set_client', (slot: 0 | 1, clientType: 'tcp' | 'cpu' | 'process' | 'manual', processConfig?: ProcessConfig) => {
    void manager.setClientType(slot, clientType, processConfig);
  });

  ws.on('delete_program', (slot: 0 | 1) => {
    manager.deleteProgram(slot);
  });

  ws.on('request_start', () => {
    manualClients.clear();
    manager.requestStart().catch(console.error);
  });

  ws.on('request_reset', () => {
    manualClients.clear();
    manager.requestReset().catch(console.error);
  });

  ws.on('load_map', (filePath: string) => {
    manager.loadMap(filePath);
  });

  ws.on('set_map_params', (params: MapParams) => {
    manager.setMapParams(params);
  });

  ws.on('load_map_data', (data: InlineMapData) => {
    manager.loadMapData(data);
  });

  ws.on('set_double_mode', (enabled: boolean) => {
    manager.setDoubleMode(enabled);
  });

  ws.on('set_turn_delay', (ms: number) => {
    manager.setTurnDelay(ms);
  });

  ws.on('request_next_round', () => {
    manualClients.clear();
    manager.requestNextRound().catch(console.error);
  });

  ws.on('manual_action', (slot: 0 | 1, action: number, rote: number) => {
    const mc = manualClients.get(slot);
    if (mc) mc.receiveAction(action, rote);
  });

  // ManualClient が作られたら登録し、need_input イベントを WS でブロードキャスト
  manager.on('manual_client_created', (mc: ManualClient) => {
    manualClients.set(mc.currentSlot, mc);
    mc.on('need_input', (slot: 0 | 1, aroundData: number[]) => {
      ws.broadcastManualRequest(slot, aroundData);
    });
  });

  manager.on('session_created', (session, playerNames) => {
    ws.attach(session, playerNames);
  });
}

main().catch(console.error);
