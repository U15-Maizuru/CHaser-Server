import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProcessClient } from './ProcessClient.js';

const TEST_PORT = 19995;

function writeTempScript(source: string): string {
  const file = path.join(os.tmpdir(), `u15-proc-test-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, source);
  return file;
}

describe('ProcessClient', () => {
  let client: ProcessClient | null = null;
  const tempFiles: string[] = [];

  afterEach(() => {
    client?.close();
    client = null;
    for (const f of tempFiles.splice(0)) fs.rmSync(f, { force: true });
  });

  it('存在しない実行コマンドを指定した場合、プロセス全体を落とさず startProgram が reject する', async () => {
    client = new ProcessClient(500);
    await client.listen(TEST_PORT);

    // type: 'bot' はビルドされるコマンドが runtime そのままになるため、
    // 存在しないコマンドを指定して spawn() の ENOENT を直接再現できる。
    await expect(
      client.startProgram(TEST_PORT, 'bot', 'unused', 'this-command-does-not-exist-xyz'),
    ).rejects.toThrow();
  });

  it('起動したプロセスが0以外の終了コードで即終了した場合、startProgram が reject する', async () => {
    client = new ProcessClient(500);
    await client.listen(TEST_PORT);

    // 実在するコマンド (node 自身) を、存在しないスクリプトパスを渡して即座に失敗させる。
    await expect(
      client.startProgram(TEST_PORT, 'bot', 'unused', process.execPath),
    ).rejects.toThrow();
  });

  it('起動失敗時、標準エラー出力の内容が reject されたエラーメッセージに含まれる', async () => {
    client = new ProcessClient(500);
    await client.listen(TEST_PORT);

    const script = writeTempScript("console.error('boom: something went wrong'); process.exit(1);");
    tempFiles.push(script);

    await expect(
      client.startProgram(TEST_PORT, 'python', script, process.execPath),
    ).rejects.toThrow(/boom: something went wrong/);
  });

  it('接続成立後にプロセスが異常終了した場合、プロセス全体を落とさず crashed イベントで通知される', async () => {
    client = new ProcessClient(2000);
    await client.listen(TEST_PORT);

    // --port 引数で受け取ったポートに接続し、名前を送ってから (waitForClient を成立させてから)
    // 少し待ってエラー出力とともに異常終了する、擬似的な Python プログラムを模したスクリプト。
    const script = writeTempScript(`
      const net = require('net');
      const idx = process.argv.indexOf('--port');
      const port = Number(process.argv[idx + 1]);
      const sock = net.createConnection({ port }, () => {
        sock.write('TestBot\\n');
        setTimeout(() => {
          console.error('crash after connect');
          process.exit(1);
        }, 100);
      });
    `);
    tempFiles.push(script);

    const crashed = new Promise<{ message: string }>((resolve) => {
      client!.once('crashed', resolve);
    });

    await client.startProgram(TEST_PORT, 'python', script, process.execPath);

    const crash = await crashed;
    expect(crash.message).toContain('crash after connect');
  });
});
