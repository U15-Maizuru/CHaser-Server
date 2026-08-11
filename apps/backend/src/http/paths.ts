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

// 音源の置き場。ルームに紐付かないグローバル共有。
// **どちらも空でありえる** — BGM は空なら無音、SE は空ならフロントエンド同梱の音が鳴る。

/** BGM 用 (原本の ./Music フォルダに相当)。ここに置かれたものが選択肢になる */
export const MUSIC_DIR = path.resolve('server/music');
export const MUSIC_EXTENSIONS = ['.mp3', '.wav'];

/** SE の差し替え用。同梱の音と同じ名前で置くと、そちらが優先される */
export const SOUND_DIR = path.resolve('server/sounds');
export const SOUND_EXTENSIONS = ['.mp3', '.wav'];
