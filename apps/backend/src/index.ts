import { ServerManager } from './game/ServerManager.js';
import { WsServer } from './network/WsServer.js';
import { handleHttpRequest, ensureDirectories } from './network/HttpServer.js';
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

  manager.on('status', (payload) => ws.broadcastStatus(payload));

  ws.on('set_client', (slot: 0 | 1, clientType: 'tcp' | 'cpu' | 'process', processConfig?: ProcessConfig) => {
    void manager.setClientType(slot, clientType, processConfig);
  });

  ws.on('delete_program', (slot: 0 | 1) => {
    manager.deleteProgram(slot);
  });

  ws.on('request_start', () => {
    manager.requestStart().catch(console.error);
  });

  ws.on('request_reset', () => {
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

  manager.on('session_created', (session, playerNames) => {
    ws.attach(session, playerNames);
  });
}

main().catch(console.error);
