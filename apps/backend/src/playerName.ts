/**
 * プレイヤー名として受け入れられる形に整える。
 *
 * TCP で送られてきた名前 (network/TcpClient) と、プログラムのソースから拾った名前
 * (programName.ts) の両方でこれを通し、表示される値が経路によってブレないようにする。
 *
 * 経路をまたぐドメイン規則なので、以前置かれていた TcpClient (トランスポート層) ではなく
 * ここに置く。programName.ts が TcpClient を import し返す形になっていた。
 */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/[\r\n\u2028\u2029\u202A-\u202F\u200B\t\f\v\uFFFD]/g, "")
    .slice(0, 100);
}
