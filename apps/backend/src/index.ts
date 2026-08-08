import { RoomManager } from './RoomManager.js';
import { WsServer }    from './network/WsServer.js';
import { getLocalIP }  from './network/localIp.js';
import { handleHttpRequest, ensureDirectories } from './http/router.js';
import { TournamentOrchestrator } from './tournament/TournamentOrchestrator.js';

const PORT       = Number(process.env['PORT'] ?? 8765);
const U15_MODE   = process.env['U15_MODE'] ?? 'local';   // 'local' | 'web'
const LOCAL_PORTS: [number, number] = [2009, 2010];
const WEB_PORTS:  [number, number]  = [13000, 14999];    // 1000ポート = 500並列ルーム

async function main() {
  ensureDirectories();
  const localIP = getLocalIP();

  const ws = new WsServer(PORT);
  const rm = new RoomManager(U15_MODE === 'web' ? WEB_PORTS : undefined);

  // 大会運営。ServerManager 等には手を入れず、公開 API と 'status' イベントだけで駆動する
  const tournament = new TournamentOrchestrator({
    rm,
    broadcast: (roomId, msg) => ws.broadcastToRoom(roomId, msg),
  });
  ws.setTournament(tournament);

  ws.httpServer.on('request', (req, res) =>
    handleHttpRequest(req, res, rm, { boundRoomOf: id => tournament.boundRoomOf(id) }));
  ws.setRoomManager(rm);

  if (U15_MODE === 'local') {
    const room = rm.createRoom('local', LOCAL_PORTS);
    if (!room) throw new Error('ローカルルームの作成に失敗しました');
    console.log('CHaser Server starting... (ローカルモード)');
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  ブラウザアクセス: http://${localIP}:5173         (dev / Vite)`);
    console.log(`                   http://${localIP}:${PORT}          (prod / static)`);
    console.log(`  オペレーター:     URL に ?room=local&mode=control を追加`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  COOL AI 接続先: ${localIP}:${LOCAL_PORTS[0]}`);
    console.log(`  HOT  AI 接続先: ${localIP}:${LOCAL_PORTS[1]}`);
    console.log(`  WebSocket:      ws://${localIP}:${PORT}`);
  } else {
    console.log('CHaser Server starting... (Webサービスモード)');
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  ロビー:   http://${localIP}:${PORT}`);
    console.log(`  WebSocket: ws://${localIP}:${PORT}`);
    console.log(`  ポートプール: ${WEB_PORTS[0]}–${WEB_PORTS[1]} (最大${(WEB_PORTS[1] - WEB_PORTS[0] + 1) >> 1}並列ルーム)`);
  }

  process.on('SIGINT',  () => { tournament.shutdown(); rm.shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { tournament.shutdown(); rm.shutdown(); process.exit(0); });
}

main().catch(console.error);
