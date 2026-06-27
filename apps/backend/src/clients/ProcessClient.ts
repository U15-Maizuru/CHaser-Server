import { spawn, type ChildProcess } from 'node:child_process';
import { TcpClient } from '../network/TcpClient.js';

/**
 * Python / Bot プログラムを child_process で起動し、
 * その後 TCP 接続を待つクライアント。
 *
 * プロトコル:
 *   Python: python.exe player.py --host 127.0.0.1 --port <port>
 *   Bot:    Bot.exe a:127.0.0.1 p:<port> n:BotProgram
 */
export class ProcessClient extends TcpClient {
  private proc: ChildProcess | null = null;

  constructor(timeout = 10_000) {
    super(timeout);
  }

  /**
   * TCP サーバーを起動し、外部プロセスを spawn して接続を待つ。
   * listen + waitForClient をまとめて行う。
   */
  async startProgram(
    port: number,
    programType: 'python' | 'bot',
    programPath: string,
    runtimeCommand: string,
  ): Promise<void> {
    await this.listen(port);

    const [command, args] = buildCommand(programType, programPath, runtimeCommand, port);
    this.proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout?.on('data', (d: Buffer) =>
      process.stdout.write(`[proc] ${d.toString().trimEnd()}\n`),
    );
    this.proc.stderr?.on('data', (d: Buffer) =>
      process.stderr.write(`[proc] ${d.toString().trimEnd()}\n`),
    );
    this.proc.on('exit', (code) => console.log(`[proc] exit: ${code}`));

    await this.waitForClient();
  }

  close(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
      this.proc = null;
    }
    super.close();
  }
}

function buildCommand(
  type: 'python' | 'bot',
  programPath: string,
  runtime: string,
  port: number,
): [string, string[]] {
  if (type === 'python') {
    return [runtime, [programPath, '--host', '127.0.0.1', '--port', String(port)]];
  }
  // Bot.exe 形式: a:127.0.0.1 p:<port> n:BotProgram
  return [runtime, [`a:127.0.0.1`, `p:${port}`, `n:BotProgram`]];
}
