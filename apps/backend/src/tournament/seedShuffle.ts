import type { ParticipantDef, TournamentDefinition } from '@u15/ws-types';

// デモモード (自動進行の「繰り返す」) で、繰り返すたびに組み合わせを変えるための純関数。
//
// 組み合わせは選手番号 (`ParticipantDef.seed`) の並びから自動で決まる。
// 番号を振り直せば、1回戦の並び・予選リーグの振り分け・リーグ戦の対戦順がまとめて変わる。
//
// **tournament.json は書き換えない。** 振り直した並びは `TournamentState.seedOrder` に持ち、
// 読み込み時に定義へ重ねる (`withSeedOrder`)。定義側へ書き戻すと配布物が変わってしまうし、
// 重ねずに state だけへ持つと、再スキャンのたびに骨組みが食い違って進行状態が消える。

/**
 * 組み合わせを運営が手で決めているか。手で決めたものは、繰り返しでも勝手に崩さない。
 *
 * - `bracket.slots`     … 決勝トーナメントの1回戦の並び
 * - `schedule.pairs`    … リーグ戦の対戦カード
 * - 参加者の `group`    … 予選リーグの振り分け (大会作成 UI は自動振り分けの結果も
 *                          明示で書き出すので、UI 経由の大会は手動として扱われる)
 */
export function isPairingManual(def: TournamentDefinition): boolean {
  if (def.bracket?.slots) return true;
  if (def.schedule?.pairs) return true;
  return def.participants.some(p => p.group !== undefined);
}

/**
 * 組み合わせをシャッフルする形式か。BOT対戦予選は全員が同じ BOT と戦うので、
 * 「誰と誰が当たるか」が無い (選手番号は表の並びにしか効かない)。
 */
function isShufflable(def: TournamentDefinition): boolean {
  return def.stage.format !== 'bot-then-bracket';
}

/**
 * 繰り返しのたびに使う、新しい選手番号の並び (participant id の列。先頭が選手番号 1)。
 * シャッフルしない大会 (手動 / BOT対戦予選) では null — 今の並びを保つ。
 */
export function shuffledSeedOrder(
  def: TournamentDefinition, rng: () => number = Math.random,
): string[] | null {
  if (!isShufflable(def) || isPairingManual(def)) return null;

  const ids = def.participants.map(p => p.id);
  // Fisher-Yates
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/**
 * 選手番号の並びを定義へ重ねる。`order` が今の参加者の並べ替えになっていなければ
 * (参加者を差し替えた古い state.json など) 何もしない。
 */
export function withSeedOrder(
  def: TournamentDefinition, order: readonly string[] | null | undefined,
): TournamentDefinition {
  if (!order) return def;
  const known = new Set(def.participants.map(p => p.id));
  if (order.length !== known.size || !order.every(id => known.has(id)) || new Set(order).size !== known.size) {
    return def;
  }
  const seedOf = new Map(order.map((id, i) => [id, i + 1]));
  const participants: ParticipantDef[] = def.participants.map(p => ({ ...p, seed: seedOf.get(p.id)! }));
  return { ...def, participants };
}
