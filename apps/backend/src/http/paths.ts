import path from 'node:path';

// ルームごとのディレクトリ規約。ここだけが `server/rooms/<id>/...` の形を知っている。

export function roomDirs(roomId: string) {
  return {
    'program-0': path.resolve(`server/rooms/${roomId}/programs/cool`),
    'program-1': path.resolve(`server/rooms/${roomId}/programs/hot`),
    // Python 側で `from lib.pyCHaser import *` のようにパッケージとして import できるよう、
    // PYTHONPATH (ProcessClient.buildEnv の libPath = このひとつ上の階層) の直下に
    // 実体を "lib" という名前のディレクトリとして配置する。
    'library-0': path.resolve(`server/rooms/${roomId}/libs/cool/lib`),
    'library-1': path.resolve(`server/rooms/${roomId}/libs/hot/lib`),
  } as const;
}

/** BGM 再生用 (原本の ./Music フォルダに相当)。ルームに紐付かないグローバル共有 */
export const MUSIC_DIR = path.resolve('server/music');
export const MUSIC_EXTENSIONS = ['.mp3', '.wav'];
