import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import iconv from 'iconv-lite';
import { TcpClient } from '../network/TcpClient.js';
import { ensureLibDir } from '../libTemplates.js';

const MAX_STDERR_CHARS = 4000;

// 'crashed' イベント発行時のペイロード: 対戦中 (waitForClient() 成立後) にプロセスが
// 異常終了した際、管理画面へ表示できるようエラー内容を伝える。
export interface ProcessCrashInfo {
  message: string;
}

export class ProcessClient extends TcpClient {
  private proc: ChildProcess | null = null;
  private stderrBuf = '';

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
    // detached は付けない: このプロセスは電子側の backend spawn (main.ts) が
    // 作ったプロセスグループに属したままにしておくことで、backend を木ごと kill
    // したときに一緒に落ちる (ここを detached にすると別グループの孤児になり killTree が届かなくなる)
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    this.proc = proc;
    // 対戦プログラム (Python / 参加者提供の BOT exe) は、パイプ経由の標準出力では
    // Windows のシステムロケール既定である CP932 (Shift_JIS) で日本語を出力するため、
    // UTF-8 前提の Buffer#toString() だと文字化けする。CP932 として明示的に decode する。
    proc.stdout?.on('data', (d: Buffer) =>
      process.stdout.write(`[proc] ${iconv.decode(d, 'cp932').trimEnd()}\n`),
    );
    proc.stderr?.on('data', (d: Buffer) => {
      const text = iconv.decode(d, 'cp932');
      process.stderr.write(`[proc] ${text.trimEnd()}\n`);
      // 管理画面にエラー原因 (Python の例外メッセージ等) を表示するため、直近の出力を保持しておく。
      this.stderrBuf = (this.stderrBuf + text).slice(-MAX_STDERR_CHARS);
    });

    // spawn() 失敗 (ENOENT 等) や異常終了を Promise の reject に変換する。
    // 'error'/'close' にリスナーを付けないと、失敗時に未捕捉例外としてバックエンド全体が落ちてしまう。
    // 'exit' ではなく 'close' を使うことで、標準エラー出力の 'data' イベントが
    // 確実に届いた後に終了理由を判定できる。
    const failure = new Promise<never>((_, reject) => {
      proc.on('error', (err) => {
        reject(new Error(`プロセスの起動に失敗しました (${command}): ${err.message}`));
      });
      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[proc] exit: ${code}`);
          reject(new Error(this.buildExitMessage(code)));
        }
      });
    });
    // waitForClient() が先に成立した (＝対戦中に発生した) 失敗はここでのみ捕捉できる。
    // race() 呼び出し時点で内部的に .then/.catch 済みのため、ここで拾っても未捕捉例外にはならない。
    failure.catch((err: Error) => {
      this.emit('crashed', { message: err.message } satisfies ProcessCrashInfo);
    });

    await Promise.race([this.waitForClient(), failure]);
  }

  private buildExitMessage(code: number): string {
    const tail = this.stderrBuf.trim();
    return tail ? `プロセスが終了しました (code ${code}):\n${tail}` : `Process exited with code ${code}`;
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
  // ライブラリ管理画面を一度も開いていない slot でも `import lib.pyCHaser` が
  // 確実に成功するよう、起動直前に既定ライブラリを配置しておく。
  ensureLibDir(path.join(absLib, 'lib'));
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
