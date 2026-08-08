import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import type { ParticipantDef, ParticipantProgram, TournamentDefinition } from '@u15/ws-types';
import { BOT_PARTICIPANT_ID, hasBotStage } from '@u15/ws-types';
import { getCatalogEntry } from '../programCatalog.js';
import { DEFAULT_ZIP_LIMITS, writeZip, type ZipWriteEntry } from './zip.js';
import { tournamentRootDir, type LoadedTournament } from './TournamentStore.js';

// 大会データそのものの書き出し。「そのまま /api/tournament/upload に食わせれば
// 別の PC で即運営できる .zip」を作るのが目的で、結果の書き出し (exporter.ts) とは別物。
//
//   <大会名>.zip
//   ├ tournament.json   … 定義。program は programs/ を指すよう書き換える
//   └ programs/*.py     … 参加者のプログラムの実体
//
// state.json は入れない。移動先ではまっさらな大会として始まる
// (進行状態はこの PC のライブラリ ID を握っているので持って行っても噛み合わない)。

/** 取り込み側 (extractZip) が受け付ける拡張子。ここを外れる実体は同梱しても捨てられる */
const BUNDLABLE_EXT = '.py';

export interface BundleResult {
  zip: Buffer;
  /** 同梱できなかったプログラムの理由 (参加者ごとに日本語一文) */
  skipped: string[];
}

/** プログラムの実体の在処と、tournament.json に残す表示名 */
interface ProgramSource {
  srcPath:      string;
  displayName?: string;
}

/**
 * 参加者のプログラムの実体を探す。
 *
 * 定義に program.file が書いてある大会 (フォルダ/zip 由来) と、作成 UI で
 * ライブラリから割り当てただけの大会 (state.programs 由来) の両方を拾う。
 * 後者を拾わないと、画面で作った大会が「参加者だけの空の .zip」になってしまう。
 */
function findProgram(
  loaded: LoadedTournament, id: string, program: ParticipantProgram,
): ProgramSource | null {
  if (program?.kind === 'file') {
    const src: ProgramSource = {
      srcPath: path.join(tournamentRootDir(), loaded.def.id, program.file),
    };
    if (program.displayName !== undefined) src.displayName = program.displayName;
    return src;
  }

  const assigned = loaded.state.programs[id];
  if (!assigned) return null;

  const entry = getCatalogEntry(assigned.catalogId);
  if (!entry) return null;
  return { srcPath: entry.programPath, displayName: entry.displayName };
}

/** 参加者 id を ZIP のファイル名に使える形へ落とす (id は slugify 由来で任意の文字が入りうる) */
function safeBaseName(participantId: string, index: number, taken: Set<string>): string {
  const cleaned = participantId.replace(/[^A-Za-z0-9._-]/g, '');
  let base = cleaned === '' ? `p${index + 1}` : cleaned;
  let n    = 2;
  while (taken.has(base)) base = `${cleaned === '' ? `p${index + 1}` : cleaned}-${n++}`;
  taken.add(base);
  return base;
}

/** 大会データを .zip に固める。取り込み直せない実体は同梱せず、理由を skipped に積む */
export function buildTournamentBundle(loaded: LoadedTournament): BundleResult {
  const skipped: string[]        = [];
  const files:   ZipWriteEntry[] = [];
  const taken    = new Set<string>();

  /**
   * プログラム1つぶんを同梱し、tournament.json に残す指定を返す。
   * 運営BOT (bot-then-bracket) も参加者と全く同じ扱いなので、この1関数を共用する。
   */
  const bundleProgram = (
    id: string, name: string, program: ParticipantProgram, index: number,
  ): ParticipantProgram => {
    // 組み込み CPU は実体を持たないのでそのまま運べる
    if (program?.kind === 'builtin') return program;

    const found = findProgram(loaded, id, program);
    if (!found) return null;

    const ext = path.extname(found.srcPath).toLowerCase();
    if (ext !== BUNDLABLE_EXT) {
      // .exe を ZIP から展開しないのは取り込み側の防御線 (zip.ts の allowedExtensions)。
      // 同梱しても捨てられるだけなので、ここで断って運営に知らせる
      skipped.push(`${name}: ${ext} のプログラムは同梱できません (移動先で割り当て直してください)`);
      return null;
    }

    let data: Buffer;
    try {
      data = fs.readFileSync(found.srcPath);
    } catch {
      skipped.push(`${name}: プログラムの実体が見つかりませんでした`);
      return null;
    }

    // 自分の importer が弾く .zip を作らない
    if (data.length > DEFAULT_ZIP_LIMITS.maxEntryBytes) {
      skipped.push(
        `${name}: プログラムが大きすぎます (上限 ${DEFAULT_ZIP_LIMITS.maxEntryBytes / 1024}KB)`,
      );
      return null;
    }

    const file = `programs/${safeBaseName(id, index, taken)}${BUNDLABLE_EXT}`;
    files.push({ name: file, data });
    return found.displayName === undefined
      ? { kind: 'file', file }
      : { kind: 'file', file, displayName: found.displayName };
  };

  const bundled: ParticipantDef[] = loaded.def.participants.map((p, i) => ({
    ...p,
    program: bundleProgram(p.id, p.name, p.program, i),
  }));

  // rules.mapCatalogId / rules.stageMaps / rules.botStageMap はこの PC のマップライブラリ ID
  // なので移動先では解決しない。それでも残す — 見つからない ID は黙って無視される決まり
  // (definition.ts) で、消すと元の PC で読み直したときにマップ設定が飛んでしまう。
  const def: TournamentDefinition = { ...loaded.def, participants: bundled };

  if (hasBotStage(loaded.def.format)) {
    def.rules = {
      ...loaded.def.rules,
      botProgram: bundleProgram(
        BOT_PARTICIPANT_ID, loaded.def.rules.botName ?? '運営BOT',
        loaded.def.rules.botProgram, loaded.def.participants.length,
      ),
    };
  }

  const zip = writeZip([
    { name: 'tournament.json', data: Buffer.from(JSON.stringify(def, null, 2), 'utf-8') },
    ...files,
  ]);

  return { zip, skipped };
}
