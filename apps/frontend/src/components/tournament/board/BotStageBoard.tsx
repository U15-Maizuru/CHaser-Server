import type { StandingRow, TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import { advancePerGroupOf } from '@u15/ws-types';
import { FitArea } from '../../FitArea';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_PALE, FONT_NUM, FONT_UI, GOLD_BASE, GOLD_LIGHT,
  RADIUS_SM, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE, WIN_LIGHT,
} from '../../../ui';

// BOT対戦予選の進行画面。エントリーリスト (左) と 試合結果の順位リスト (右) の2枚。
//
// 星取表を出さないのは、全員が同じ BOT としか戦わないから — 対戦相手の軸が1本しかない
// 表は情報を持たない。代わりに「誰が終わって誰が残っているか」(エントリー) と
// 「終わった人がどう並んだか」(順位) の2つを見せる。
//
// **順位リストには終わった人だけを載せる。** 予選が進むにつれてリストが伸びていくのが
// この画面の要点で、未実施の人を0ポイントで先頭から並べると通過ラインが動かなくなる。
//
// 順位は「合計ポイント → 一撃ボーナス → アイテムポイント」で決まる (backend の
// computeStandings)。内訳を列に出すのは、同点がどこで割れたのかを観客と運営が読めるようにするため。

export interface BotStageBoardProps {
  state:    TournamentStatePayload;
  maxScale?: number;
  interactive?: boolean;
  onSelect?: (matchId: string) => void;
  /** たった今確定した試合 */
  finishedMatchId?: string | null;
}

export function BotStageBoard({
  state, maxScale = 3, interactive = false, onSelect, finishedMatchId = null,
}: BotStageBoardProps) {
  const group     = state.groups?.[0];
  const standings = group?.standings ?? [];
  const entryIds  = group?.participantIds ?? [];

  const nameOf = (id: string) => state.participants.find(p => p.id === id)?.name ?? id;
  const botName = state.participants.find(p => p.isBot)?.name ?? '運営BOT';

  const qualifying = state.matches.filter(m => m.group !== undefined);
  /** その参加者の BOT 戦 */
  const matchOf = (id: string): TournamentMatch | undefined =>
    qualifying.find(m => m.resolvedA === id || m.resolvedB === id);

  const excluded = new Set(
    (state.qualifierCandidates ?? []).filter(c => c.excluded).map(c => c.participantId),
  );

  const advanceCount = advancePerGroupOf(state.stage);
  // 通過圏は「削除されていない人の中での位置」で塗る。削除は運営が確認リストで行う操作なので、
  // その結果がそのまま観客の見る通過ラインに反映される
  const ranked = standings.filter(s => !excluded.has(s.participantId));
  const advances = (id: string) => ranked.findIndex(s => s.participantId === id) < advanceCount
    && ranked.some(s => s.participantId === id);

  const done = new Set(standings.filter(s => s.played > 0).map(s => s.participantId));

  // ── エントリーリスト ──
  const entryTable = (
    <div style={block}>
      <div style={tableTitle}>エントリー（{entryIds.length}名）</div>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>No.</th>
            <th style={{ ...th, textAlign: 'left' }}>プレイヤー</th>
            <th style={th}>状態</th>
          </tr>
        </thead>
        <tbody>
          {entryIds.map((id, i) => {
            const m = matchOf(id);
            const isUpcoming = !!m && m.id === state.armedMatchId;
            const clickable  = interactive && !!onSelect && !!m;
            return (
              <tr
                key={id}
                style={{
                  ...(isUpcoming ? rowUpcoming : null),
                  ...(finishedMatchId && m?.id === finishedMatchId ? rowFinished : null),
                  cursor: clickable ? 'pointer' : undefined,
                }}
                onClick={clickable ? () => onSelect!(m!.id) : undefined}
                title={m?.label}
              >
                <td style={{ ...tdNum, color: TEXT_MUTED }}>{i + 1}</td>
                <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{nameOf(id)}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {isUpcoming ? '▶ 対戦' : done.has(id) ? '済' : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={note}>対戦相手は全員 {botName}（同じマップ）</div>
    </div>
  );

  // ── 順位リスト ──
  const standingsTable = (
    <div style={block}>
      <div style={tableTitle}>
        試合結果（{done.size} / {entryIds.length}）
      </div>
      {done.size === 0 ? (
        <div style={empty}>まだ結果がありません</div>
      ) : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>順位</th>
              <th style={{ ...th, textAlign: 'left' }}>プレイヤー</th>
              <th style={th}>結果</th>
              <th style={th}>ポイント</th>
              <th style={th}>一撃</th>
              <th style={th}>アイテム</th>
            </tr>
          </thead>
          <tbody>
            {ranked.filter(s => s.played > 0).map((s, i) => {
              const up = advances(s.participantId);
              // 通過ラインは位置で引く。最下位の下には引かない (全員通過なら線に意味が無い)
              const cut = i === advanceCount - 1 && i < ranked.length - 1;
              const cell    = { ...td,    ...(cut ? cutLine : null) };
              const cellNum = { ...tdNum, ...(cut ? cutLine : null) };
              const m = matchOf(s.participantId);
              return (
                <tr
                  key={s.participantId}
                  style={{
                    ...(up ? rowTop : null),
                    ...(finishedMatchId && m?.id === finishedMatchId ? rowFinished : null),
                  }}
                >
                  <td style={{ ...cell, fontWeight: 700 }}>{s.rank}{s.tied ? '=' : ''}</td>
                  <td style={{ ...cell, textAlign: 'left' }}>{nameOf(s.participantId)}</td>
                  <td style={cell}>{resultMark(s)}</td>
                  <td style={{ ...cellNum, fontWeight: 700 }}>{s.totalPoints}</td>
                  <td style={cellNum}>{s.strikePoints}</td>
                  <td style={cellNum}>{s.itemPoints}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={note}>
        <span style={advanceSwatch} />上位 {advanceCount} 名が決勝トーナメントへ進出
        {' ・ '}○ BOTに勝ち / △ 引き分け / ● 負け
      </div>
    </div>
  );

  return (
    <FitArea maxScale={maxScale}>
      <div style={row}>
        {entryTable}
        {standingsTable}
      </div>
    </FitArea>
  );
}

/** BOT に勝ったか。1試合しかないので1文字で足りる */
function resultMark(s: StandingRow): string {
  if (s.played === 0) return '';
  if (s.wins   > 0)   return '○';
  if (s.draws  > 0)   return '△';
  return '●';
}

const row: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 24,
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
};

const block: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', minWidth: 0,
};

const tableTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT_PRIMARY };

const table: React.CSSProperties = {
  borderCollapse: 'collapse', fontSize: 12, background: BG_CARD,
  borderRadius: RADIUS_SM, minWidth: 'max-content',
};

const th: React.CSSProperties = {
  padding: '6px 10px', fontSize: 10, fontWeight: 700, color: TEXT_SECONDARY,
  borderBottom: `1px solid ${BORDER_COLOR}`, textAlign: 'center', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '6px 10px', borderBottom: `1px solid ${BORDER_COLOR}`,
  textAlign: 'center', whiteSpace: 'nowrap',
};

const tdNum: React.CSSProperties = { ...td, fontFamily: FONT_NUM };

// 決勝トーナメントへ上がる行
const rowTop: React.CSSProperties = { background: GOLD_LIGHT };

// 通過ライン。ここから下は上がれない、を1本の線で示す
const cutLine: React.CSSProperties = { borderBottom: `2px solid ${GOLD_BASE}` };

// これから行う試合
const rowUpcoming: React.CSSProperties = { background: GOLD_BASE, color: '#fff', fontWeight: 700 };

// たった今確定した試合
const rowFinished: React.CSSProperties = {
  background: WIN_LIGHT, outline: `2px solid ${WIN_BASE}`, outlineOffset: -2,
};

const note: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  fontSize: 10, color: TEXT_MUTED, background: COOL_PALE,
  borderRadius: 8, padding: '6px 10px', alignSelf: 'flex-start',
};

const advanceSwatch: React.CSSProperties = {
  display: 'inline-block', width: 12, height: 12, borderRadius: 2,
  background: GOLD_LIGHT, borderBottom: `2px solid ${GOLD_BASE}`, boxSizing: 'border-box',
};

const empty: React.CSSProperties = {
  padding: '18px 24px', color: TEXT_MUTED, fontSize: 12,
  background: BG_ROOT, borderRadius: RADIUS_SM,
};
