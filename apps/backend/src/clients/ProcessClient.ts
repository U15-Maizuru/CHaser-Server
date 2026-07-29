import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { TcpClient } from '../network/TcpClient.js';

export class ProcessClient extends TcpClient {
  private proc: ChildProcess | null = null;

  constructor(timeout = 10_000) {
    super(timeout);
  }

  async startProgram(
    port:               number,
    programType:        'python' | 'bot',
    programPath:        string,
    runtimeCommand:     string,
    libPath?:           string,
    pythonExeOverride?: string,
  ): Promise<void> {
    // 呼び出し元 (SlotManager.startListening) が既に listen() 済みのソケットを渡す前提

    const env = buildEnv(libPath);
    const [command, args] = buildCommand(programType, programPath, runtimeCommand, port, pythonExeOverride);
    this.proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    this.proc.stdout?.on('data', (d: Buffer) =>
      process.stdout.write(`[proc] ${d.toString().trimEnd()}\n`),
    );
    this.proc.stderr?.on('data', (d: Buffer) =>
      process.stderr.write(`[proc] ${d.toString().trimEnd()}\n`),
    );
    this.proc.on('exit', (code) => {
      console.log(`[proc] exit: ${code}`);
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Process exited with code ${code}`));
      }
    });

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

function buildEnv(libPath?: string): NodeJS.ProcessEnv {
  if (!libPath) return process.env;
  const absLib = path.resolve(libPath);
  const existing = process.env.PYTHONPATH ?? '';
  return {
    ...process.env,
    PYTHONPATH: existing ? `${absLib}${path.delimiter}${existing}` : absLib,
  };
}

function buildCommand(
  type:               'python' | 'bot',
  programPath:        string,
  runtime:            string,
  port:               number,
  pythonExeOverride?: string,
): [string, string[]] {
  if (type === 'python') {
    // フロントエンドは常に既定値 'python' を送る。優先順位: 管理画面での上書き
    // > 同梱 Python (main.ts が本番起動時にセットする U15_PYTHON_EXE) > PATH の python。
    const command = runtime === 'python'
      ? (pythonExeOverride || process.env.U15_PYTHON_EXE || runtime)
      : runtime;
    return [command, [programPath, '--host', '127.0.0.1', '--port', String(port)]];
  }
  return [runtime, [`a:127.0.0.1`, `p:${port}`, `n:BotProgram`]];
}
