// jsdom は inline style の hex 色を rgb() へ正規化して返すので、比較用に変換する
export function toRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
