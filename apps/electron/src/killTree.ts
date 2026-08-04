import { spawnSync } from 'node:child_process';

// 子プロセスを「木ごと」終わらせるための共通処理。main.ts と dev.js (require) の両方から使う。
//
// **Windows には POSIX のプロセスグループが無く、child.kill() は指定した PID しか殺さない。**
// dev 起動の実体は孫・ひ孫にいるため、直接の子だけを kill するとサーバーが生き残り、
// ポートを握ったままのゴーストになる:
//
//   node dev.js
//   ├── vite (node)              … 5173
//   │   └── esbuild.exe          … vite が起動するサービス
//   └── electron
//       └── node tsx/cli.cjs     … ここを kill しても
//           └── node backend     … こちらが残って 8765 を握り続ける
//
// この状態で次に dev すると、新しいバックエンドは 8765 を取れず、画面は前回の
// ゴーストにつながる (前の対戦状態が見える・変更が反映されない) ため、原因が非常に分かりにくい。

/** 子プロセスとその子孫をまとめて終了させる (同期。終了処理から呼べる) */
export function killTree(pid: number | undefined): void {
  if (!pid) return;

  if (process.platform === 'win32') {
    // /T = 子孫も対象、/F = 強制。Windows ではシグナルで graceful に落とす手段が無い
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  // POSIX: detached で起動していればプロセスグループごと落とせる。
  // グループ長でない場合は ESRCH になるので、その時は本体だけを落とす。
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 既に終了している
    }
  }
}
