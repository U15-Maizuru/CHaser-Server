/** value を [min, max] に収める。レイアウト寸法の計算で繰り返し使う */
export function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
