import type { StandingRow, TournamentMatch } from '@u15/ws-types';
import { compareByPlayOrder, groupLabel, hasBotStage } from '@u15/ws-types';
import { computeStandings } from './standings.js';
import {
  groupStandingsOf, leaguePointsOf, qualifiersOf, rankByOf, resolveParticipants,
  type LoadedTournament,
} from './TournamentStore.js';

// 大会結果の書き出し。大会後の記録・表彰に使う。

/** Excel が UTF-8 と判別できるよう BOM を付ける (日本語が化けるのを防ぐ) */
const BOM = '﻿';

/** RFC4180: カンマ・二重引用符・改行を含む値は " で囲み、" は "" にする */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return BOM + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const REASON_LABEL = [
  'アイテム数', '閉じ込め', '自縛', 'アタック', '衝突', '通信エラー', '—',
];

const DECIDED_LABEL: Record<string, string> = {
  wins:     '勝利数',
  points:   '合計ポイント',
  walkover: '不戦勝',
  manual:   '審判裁定',
};

function statusLabel(m: TournamentMatch): string {
  switch (m.status) {
    case 'done':             return '確定';
    case 'awaiting_confirm': return '結果確認待ち';
    case 'in_progress':      return '対戦中';
    case 'armed':            return '準備完了';
    case 'ready':            return '実施可能';
    default:                 return '未定';
  }
}

/** 試合一覧の CSV。1行1試合 (ゲーム内訳は列に展開する) */
export function matchesCsv(loaded: LoadedTournament): string {
  const ps     = resolveParticipants(loaded);
  const nameOf = (id: string | null) => (id ? ps.find(p => p.id === id)?.name ?? id : '');

  const header = [
    '試合ID', '区分', '回戦', '試合名', '状態',
    'プレイヤーA', 'プレイヤーB',
    'A勝利数', 'B勝利数', '引分',
    'A合計ポイント', 'B合計ポイント',
    '勝者', '決め手', '備考',
    'G1決着理由', 'G1Aアイテム', 'G1Bアイテム', 'G1A一撃', 'G1B一撃', 'G1A総取り', 'G1B総取り',
    'G2決着理由', 'G2Aアイテム', 'G2Bアイテム', 'G2A一撃', 'G2B一撃', 'G2A総取り', 'G2B総取り',
  ];

  const rows: unknown[][] = [header];

  // 行の並びは実施順。運営が当日の進行をそのまま追える
  for (const m of [...loaded.state.matches].sort(compareByPlayOrder)) {
    const r    = m.result;
    const set  = r?.set ?? null;
    const win  = r?.winnerSide;
    // 予選と決勝トーナメントは stage 番号が地続きなので、区分を出さないと
    // 「予選 第1節」と「決勝T 1回戦」が同じ数字で並んで見分けられない
    const base: unknown[] = [
      m.id,
      m.group === undefined         ? '決勝T'
      : hasBotStage(loaded.def.stage.format) ? '予選'
      :                                `予選${groupLabel(m.group)}`,
      m.stage + 1, m.label, statusLabel(m),
      m.byeA ? '(不戦)' : nameOf(m.resolvedA),
      m.byeB ? '(不戦)' : nameOf(m.resolvedB),
      set?.wins[0] ?? '', set?.wins[1] ?? '', set?.draws ?? '',
      set?.totals[0] ?? '', set?.totals[1] ?? '',
      win === 0 ? nameOf(m.resolvedA) : win === 1 ? nameOf(m.resolvedB) : (r ? '決着なし' : ''),
      r ? DECIDED_LABEL[r.decidedBy] ?? r.decidedBy : '',
      r?.note ?? '',
    ];

    // ゲームごとの内訳。side 基準に直して並べる (slotA=side0, slotB=side1)
    for (let g = 0; g < 2; g++) {
      const rr = r?.roundResults[g];
      if (!rr) { base.push('', '', '', '', '', '', ''); continue; }
      // RoundResult の配列は team-index 基準なので side へ引き直す
      const i0 = ((0 + rr.round) % 2) as 0 | 1;
      const i1 = ((1 + rr.round) % 2) as 0 | 1;
      base.push(
        REASON_LABEL[rr.reason] ?? String(rr.reason),
        rr.scores[i0], rr.scores[i1],
        rr.strikeBonus[i0], rr.strikeBonus[i1],
        rr.sweepBonus[i0], rr.sweepBonus[i1],
      );
    }

    rows.push(base);
  }

  return toCsv(rows);
}

const STANDINGS_HEADER = [
  '順位', 'プレイヤー', '試合数', '勝', '分', '敗', '勝ち点', '合計ポイント', '同順位',
];

// BOT対戦予選は勝ち点で順位を付けないので勝ち点列を出さず、代わりに順位を決めた内訳を出す
// (「合計 → 一撃 → アイテム」の順に見れば、同点がどこで割れたのかが読める)
const BOT_STANDINGS_HEADER = [
  '順位', 'プレイヤー', '結果', '合計ポイント', '一撃ボーナス', 'アイテムポイント', '総取りボーナス', '同順位',
];

/**
 * 順位表の CSV。
 *
 * 予選がある大会ではグループごとに見出し行を挟んで続けて出す。1つのファイルに
 * まとめるのは、運営が「予選の結果」として1枚で持ち帰れるようにするため。
 */
export function standingsCsv(loaded: LoadedTournament): string {
  const ps     = resolveParticipants(loaded);
  const nameOf = (id: string) => ps.find(p => p.id === id)?.name ?? id;
  const bot    = hasBotStage(loaded.def.stage.format);

  const row = (s: StandingRow): unknown[] => (bot
    ? [
        s.rank, nameOf(s.participantId), resultMark(s),
        s.totalPoints, s.strikePoints, s.itemPoints, s.sweepPoints, s.tied ? 'はい' : '',
      ]
    : [
        s.rank, nameOf(s.participantId), s.played, s.wins, s.draws, s.losses,
        s.points, s.totalPoints, s.tied ? 'はい' : '',
      ]);

  const header = bot ? BOT_STANDINGS_HEADER : STANDINGS_HEADER;

  const groups = groupStandingsOf(loaded);
  if (groups) {
    const rows: unknown[][] = [];
    for (const g of groups) {
      // BOT対戦予選は1グループしか無いので「Aリーグ」と名乗る意味が無い
      rows.push([bot ? 'BOT対戦予選' : `${g.label}リーグ`]);
      rows.push(header);
      for (const s of g.standings) rows.push(row(s));
      rows.push([]);
    }
    return toCsv(rows);
  }

  return toCsv([header, ...standingsOf(loaded).map(row)]);
}

/** BOT に勝ったか (1試合しかないので○△●の1文字で足りる) */
function resultMark(s: StandingRow): string {
  if (s.played === 0) return '';
  if (s.wins   > 0)   return '○';
  if (s.draws  > 0)   return '△';
  return '●';
}

function standingsOf(loaded: LoadedTournament): StandingRow[] {
  const ps = resolveParticipants(loaded);
  return computeStandings(
    ps.filter(p => !p.isBot).map(p => p.id),
    loaded.state.matches, leaguePointsOf(loaded.def), rankByOf(loaded.def),
  );
}

/** 全部入りの JSON (定義 + 進行 + 順位) */
export function resultJson(loaded: LoadedTournament): string {
  const ps = resolveParticipants(loaded);
  return JSON.stringify({
    id:           loaded.def.id,
    name:         loaded.def.name,
    format:       loaded.def.stage.format,
    match:        loaded.def.match,
    stage:        loaded.def.stage,
    participants: ps,
    matches:      loaded.state.matches,
    standings:    loaded.def.stage.format === 'league' ? standingsOf(loaded) : null,
    groups:       groupStandingsOf(loaded),
    qualifiers:   qualifiersOf(loaded),
    exportedAt:   new Date().toISOString(),
  }, null, 2);
}
