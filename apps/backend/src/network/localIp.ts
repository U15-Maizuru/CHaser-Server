import os from 'node:os';

/**
 * LAN 内の他 PC から到達できる自分の IPv4 アドレス。
 *
 * 起動ログの案内 (対戦プログラムの接続先) と ServerStatusPayload.localIP の両方が使う。
 * 以前は index.ts と ServerManager.ts に別々の実装があり、NIC が見つからないときの
 * 戻り値が 'localhost' と '127.0.0.1' で食い違っていた。
 */
export function getLocalIP(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}
