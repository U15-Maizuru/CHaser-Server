import type { CatalogEntry, InlineMapData, MapCatalogEntry, MapParams, SoundKey } from '@u15/ws-types';

// バックエンドの HTTP API を叩く場所。
//
// 以前は fetch が12ファイル16箇所に直書きされていて、特に「一覧を取って uploadedAt の
// 降順に並べる」が4箇所で完全に同じコードだった。URL とレスポンスの形を知るのはここだけにする。
//
// 失敗の扱いは呼び出し元の都合に合わせる: 一覧・取得系は「取れなければ空/ null」を返して
// 画面を壊さない (元の .catch(() => {}) と同じ)。副作用系は Promise<void> を返す。

/** 一覧は新しい順 (アップロード日時の降順) に見せる */
function byNewest<T extends { uploadedAt: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

async function sendJson<T>(url: string, method: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

async function send(url: string, method: string): Promise<void> {
  try {
    await fetch(url, { method });
  } catch {
    // 一覧の取り直しで実際の状態に追いつくので、ここでは黙って諦める
  }
}

/** ファイルを1つ POST する。成功なら null、失敗ならユーザーに見せるエラーメッセージ */
async function uploadFile(url: string, file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(url, { method: 'POST', body: fd });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({})) as { error?: string };
    return body.error ?? `アップロードに失敗しました (${res.status})`;
  } catch (e) {
    return `アップロードに失敗しました: ${(e as Error).message}`;
  }
}

// ── プログラムライブラリ ───────────────────────────────────────────────────

export async function fetchPrograms(httpBase: string): Promise<CatalogEntry[]> {
  const body = await getJson<{ entries: CatalogEntry[] }>(`${httpBase}/api/programs`);
  return body ? byNewest(body.entries) : [];
}

export async function setProgramDemoEnabled(
  httpBase: string, id: string, demoEnabled: boolean,
): Promise<CatalogEntry | null> {
  const body = await sendJson<{ entry: CatalogEntry }>(
    `${httpBase}/api/programs/${id}`, 'PATCH', { demoEnabled },
  );
  return body?.entry ?? null;
}

export function deleteProgram(httpBase: string, id: string): Promise<void> {
  return send(`${httpBase}/api/programs/${id}`, 'DELETE');
}

// ── マップライブラリ ───────────────────────────────────────────────────────

export async function fetchMaps(httpBase: string): Promise<MapCatalogEntry[]> {
  const body = await getJson<{ entries: MapCatalogEntry[] }>(`${httpBase}/api/maps`);
  return body ? byNewest(body.entries) : [];
}

export function deleteMap(httpBase: string, id: string): Promise<void> {
  return send(`${httpBase}/api/maps/${id}`, 'DELETE');
}

/** その部屋で今出ているマップ */
export async function fetchCurrentMap(
  httpBase: string, roomId: string,
): Promise<InlineMapData | null> {
  const body = await getJson<{ data: InlineMapData }>(`${httpBase}/api/maps/current?room=${roomId}`);
  return body?.data ?? null;
}

/** どのルームにも影響しないランダム生成 (マップエディタのプレビュー用) */
export async function generateRandomMap(
  httpBase: string, params: Partial<MapParams>,
): Promise<InlineMapData | null> {
  const body = await sendJson<{ data: InlineMapData }>(`${httpBase}/api/maps/random`, 'POST', params);
  return body?.data ?? null;
}

export async function saveMapToLibrary(
  httpBase: string, displayName: string, data: InlineMapData,
): Promise<void> {
  await sendJson(`${httpBase}/api/maps/save-inline`, 'POST', { displayName, data });
}

/** ライブラリに残さず .map ファイルとして落とす */
export async function downloadMapFile(
  httpBase: string, displayName: string, data: InlineMapData,
): Promise<void> {
  const res = await fetch(`${httpBase}/api/maps/export`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ displayName, data }),
  }).catch(() => null);
  if (!res?.ok) return;

  const url = URL.createObjectURL(await res.blob());
  const a   = document.createElement('a');
  a.href     = url;
  a.download = `${displayName}.map`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── ルーム内のカスタムライブラリ (.py) ─────────────────────────────────────

export function libUploadUrl(httpBase: string, roomId: string, slot: 0 | 1): string {
  return `${httpBase}/api/upload/library?slot=${slot}&room=${roomId}`;
}

export async function fetchLibFiles(
  httpBase: string, roomId: string, slot: 0 | 1,
): Promise<string[]> {
  const body = await getJson<{ files: string[] }>(`${httpBase}/api/libs?slot=${slot}&room=${roomId}`);
  return body?.files ?? [];
}

export function deleteLibFile(
  httpBase: string, roomId: string, slot: 0 | 1, filename: string,
): Promise<void> {
  return send(
    `${httpBase}/api/libs/${encodeURIComponent(filename)}?slot=${slot}&room=${roomId}`,
    'DELETE',
  );
}

// ── BGM / SE ──────────────────────────────────────────────────────────────
//
// どちらの一覧も空でありえる。BGM は空なら無音、SE は空なら同梱の音が鳴る。

export async function fetchMusicFiles(httpBase: string): Promise<string[]> {
  const body = await getJson<{ files: string[] }>(`${httpBase}/api/music`);
  return body?.files ?? [];
}

export async function fetchSoundFiles(httpBase: string): Promise<string[]> {
  const body = await getJson<{ files: string[] }>(`${httpBase}/api/sounds`);
  return body?.files ?? [];
}

export function uploadMusic(httpBase: string, file: File): Promise<string | null> {
  return uploadFile(`${httpBase}/api/upload/music`, file);
}

/** BGM ライブラリから削除する */
export function deleteMusicFile(httpBase: string, filename: string): Promise<void> {
  return send(`${httpBase}/api/music/${encodeURIComponent(filename)}`, 'DELETE');
}

/** SE を1つ差し替える。保存名はサーバー側で key に強制されるので、ファイル名は問わない */
export function uploadSound(httpBase: string, key: SoundKey, file: File): Promise<string | null> {
  return uploadFile(`${httpBase}/api/upload/sounds/${encodeURIComponent(key)}`, file);
}

/** 差し替え済みの SE を削除し、同梱の音に戻す */
export function deleteSoundFile(httpBase: string, filename: string): Promise<void> {
  return send(`${httpBase}/api/sounds/${encodeURIComponent(filename)}`, 'DELETE');
}
