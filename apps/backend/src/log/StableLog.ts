import fs from 'node:fs';
import path from 'node:path';

/** ログの既定の保存先。指定が無いときにリポジトリ直下へ散らばらないようまとめる */
export const DEFAULT_LOG_DIR = 'server/logs';

export class StableLog {
  private filename: string;

  constructor(filename = '') {
    this.filename = filename;
    if (filename) {
      fs.writeFileSync(filename, '--Stable Log--\r\n', { encoding: 'utf8', flag: 'w' });
    }
  }

  write(str: string): void {
    if (!this.filename) return;
    fs.appendFileSync(this.filename, str, { encoding: 'utf8' });
  }
}

/**
 * ゲームごとに一意なログファイルを開く (日時 + 部屋 + ゲーム番号)。保存先ディレクトリも用意する。
 * パスの組み立てをログ側に置くことで、ServerManager は「どこへ何という名前で書くか」を知らずに済む。
 *
 * **部屋の名前を必ず入れる。** 大会を並列実行すると複数の対戦が同時に始まるので、
 * 日時 (ミリ秒) とゲーム番号だけでは同じ名前になり、片方のログがもう片方に上書きされる。
 */
export function openGameLog(logDir: string, round: number, roomId = 'local'): StableLog {
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeRoom  = roomId.replace(/[^A-Za-z0-9_-]/g, '_');
  return new StableLog(path.join(logDir, `game-${timestamp}-${safeRoom}-round${round}.log`));
}
