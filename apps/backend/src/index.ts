import { ServerManager } from './game/ServerManager.js';
import { WsServer } from './network/WsServer.js';

const PORT_WS = 8765;

async function main() {
  console.log('U15 Server starting...');
  console.log(`  COOL TCP port : 12031`);
  console.log(`  HOT  TCP port : 12032`);
  console.log(`  WebSocket port: ${PORT_WS}  (ws://localhost:${PORT_WS})`);

  const ws      = new WsServer(PORT_WS);
  const manager = new ServerManager();

  // Broadcast server status whenever it changes
  manager.on('status', (payload) => ws.broadcastStatus(payload));

  // Wire up WS commands to ServerManager
  ws.on('set_client', (slot: 0 | 1, clientType: 'tcp' | 'cpu' | 'process', processConfig?: import('./network/ws-types.js').ProcessConfig) => {
    void manager.setClientType(slot, clientType, processConfig);
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

  ws.on('set_map_params', (params: import('./network/ws-types.js').MapParams) => {
    manager.setMapParams(params);
  });

  ws.on('load_map_data', (data: import('./network/ws-types.js').InlineMapData) => {
    manager.loadMapData(data);
  });

  // Attach each new game session to the WS server for event broadcasting
  manager.on('session_created', (session, playerNames) => {
    ws.attach(session, playerNames);
  });
}

main().catch(console.error);
