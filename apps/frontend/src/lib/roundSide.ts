// 2試合制: 画面の物理的な左右 (side) と試合番号 (round) から、その画面側に表示すべき
// チーム番号 (team-index, 0=COOL/1=HOT) を求める。2試合目は先攻/後攻が入れ替わるため、
// 同じ side でも round が変われば idx も入れ替わる。
export function idxForSide(side: 0 | 1, round: 0 | 1): 0 | 1 {
  return ((side + round) % 2) as 0 | 1;
}
