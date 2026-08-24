import type { TournamentStatePayload } from '@u15/ws-types';
import { advancePerGroupOf } from '@u15/ws-types';
import { confirmDialog } from '../../../lib/nativeDialog';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, FONT_NUM, FONT_UI, GOLD_BASE, HOT_COLOR, RADIUS_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../../ui';

// BOT対戦予選の決勝進出者を決める「最終決定確認リスト」。
//
// 予選リーグ側 (QualifierSection) は枠ごとのプルダウンで差し替える UX だが、こちらは
// **多めに並べて削る**。BOT対戦予選は全員が同じ BOT としか戦わないので直接対決が存在せず、
// ポイントの内訳 (一撃 → アイテム) まで並ぶと機械的に決める手が無くなる。
// そこでボーダーで並んだ人を全員リストに載せ、運営が定員まで削って決める。
//
// 削除は「その枠を空ける」ではなく「繰り上げる」— 削った人が居なかったものとして
// 下の順位が上がる。取り消せるよう、削除済みの行もリストに残す。

export interface BotQualifierSectionProps {
  state:      TournamentStatePayload;
  /** 削除 / 取り消し */
  onExclude:  (participantId: string, excluded: boolean, cascade?: boolean) => void;
  /** 確定 / 確定の取り消し。渡さなければ確定操作を出さない */
  onConfirm?: (confirmed: boolean) => void;
}

export function BotQualifierSection({ state, onExclude, onConfirm }: BotQualifierSectionProps) {
  const candidates = state.qualifierCandidates ?? [];
  const advance    = advancePerGroupOf(state.stage);
  const nameOf     = (id: string) => state.participants.find(p => p.id === id)?.name ?? id;
  // 交流大会ルールは一撃/アイテムの内訳制度が無いので、得点そのものだけで並べる
  // (packages/ws-types の standings.ts rankByKoryuBotScore と同じ考え方)
  const isKoryu = state.ruleSet === 'koryu';

  // 予選が終わっていなければ候補が出ない (バックエンドが空を配る)
  const waiting = candidates.length === 0;

  const remaining = candidates.filter(c => !c.excluded);
  const over      = remaining.length - advance;
  const confirmed = state.qualifiersConfirmed;

  /** その削除で決勝進出者が変わる決勝トーナメントが、もう動いてしまっているか */
  const locked = state.matches.find(m =>
    [m.slotA, m.slotB].some(r => r.kind === 'group-rank')
    && m.status !== 'pending' && m.status !== 'ready'
    && !(m.status === 'done' && (m.byeA || m.byeB)));

  const toggle = (participantId: string, excluded: boolean) => {
    if (locked) {
      const ok = confirmDialog(
        `「${locked.label}」は実施済み・準備中です。\n変更するとその結果は取り消されます。続けますか？`,
      );
      if (!ok) return;
      onExclude(participantId, excluded, true);
      return;
    }
    onExclude(participantId, excluded);
  };

  return (
    <section style={card}>
      <div style={sectionTitle}>決勝進出者</div>
      <p style={hint}>
        {isKoryu
          ? '予選の得点（アイテム数×3±残りターン数）から候補を並べています。'
          : '予選の順位（合計ポイント → 一撃ボーナス → アイテムポイント）から候補を並べています。'}
        <strong>同{isKoryu ? '得点' : 'ポイント'}で並んだ人は全員載せている</strong>ので、
        上位 {advance} 名になるまで削ってください。
      </p>

      {waiting ? (
        <p style={hint} data-testid="bot-qualifier-waiting">
          BOT対戦予選が全部終わると、ここに決勝進出者の確認リストが出ます。
        </p>
      ) : (
        <>
          {over > 0 && (
            <div style={warnRow} data-testid="bot-qualifier-over">
              ⚠ 同ポイントで並んでいます。あと <strong>{over}</strong> 名を削ってください
              （定員 {advance} 名 / 現在 {remaining.length} 名）。
            </div>
          )}

          <table style={table}>
            <thead>
              <tr>
                <th style={th}>順位</th>
                <th style={{ ...th, textAlign: 'left' }}>プレイヤー</th>
                <th style={th}>{isKoryu ? '得点' : 'ポイント'}</th>
                {isKoryu && <th style={th}>アイテム数</th>}
                {isKoryu && <th style={th}>残りターン</th>}
                {!isKoryu && <th style={th}>一撃</th>}
                {!isKoryu && <th style={th}>アイテム</th>}
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.participantId} style={c.excluded ? rowExcluded : undefined}>
                  <td style={{ ...td, fontWeight: 700 }}>{c.rank}</td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    {nameOf(c.participantId)}
                    {c.onBorder && <span style={borderTag}>同点</span>}
                  </td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{c.totalPoints}</td>
                  {isKoryu && <td style={tdNum}>{c.items}</td>}
                  {isKoryu && <td style={tdNum}>{c.remainingTurns}</td>}
                  {!isKoryu && <td style={tdNum}>{c.strikePoints}</td>}
                  {!isKoryu && <td style={tdNum}>{c.itemPoints}</td>}
                  <td style={td}>
                    {c.excluded ? (
                      <button
                        style={btnUndo}
                        aria-label={`${nameOf(c.participantId)} を戻す`}
                        onClick={() => toggle(c.participantId, false)}
                      >
                        戻す
                      </button>
                    ) : (
                      <button
                        style={btnRemove}
                        aria-label={`${nameOf(c.participantId)} を削除`}
                        onClick={() => toggle(c.participantId, true)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 確定 — 予選が終わってから決勝トーナメントに移るための一手 */}
      {onConfirm && !waiting && (confirmed ? (
        <div style={confirmRow}>
          <span style={{ ...noteText, color: WIN_BASE, flex: 1, minWidth: 180 }}>
            ✓ 確定済み — 閲覧画面は決勝トーナメント表になりました
          </span>
          <button style={btnGhost} onClick={() => onConfirm(false)}>確定を取り消す</button>
        </div>
      ) : (
        <div style={confirmRow}>
          <span style={{ ...hint, flex: 1, minWidth: 200 }}>
            閲覧画面には<strong>BOT対戦予選の最終結果</strong>を出しています。
            上の決勝進出者でよければ確定してください。確定すると決勝トーナメント表に切り替わり、
            決勝の試合を準備できるようになります。
          </span>
          <button
            style={{ ...btnPrimary, ...(over > 0 ? btnMuted : null) }}
            disabled={over > 0}
            title={over > 0 ? `あと ${over} 名を削ってください` : undefined}
            onClick={() => onConfirm(true)}
          >
            この決勝進出者で確定 ▶
          </button>
        </div>
      ))}
    </section>
  );
}

const card: React.CSSProperties = {
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: 12, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 8,
  minWidth: 0, boxSizing: 'border-box', fontFamily: FONT_UI, color: TEXT_PRIMARY,
};

const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700 };

const hint: React.CSSProperties = {
  margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6, overflowWrap: 'anywhere',
};

const noteText: React.CSSProperties = { fontSize: 12, flexShrink: 0 };

const table: React.CSSProperties = {
  borderCollapse: 'collapse', fontSize: 12, width: '100%',
};

const th: React.CSSProperties = {
  padding: '5px 6px', fontSize: 10, fontWeight: 700, color: TEXT_SECONDARY,
  borderBottom: `1px solid ${BORDER_COLOR}`, textAlign: 'center', whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '5px 6px', borderBottom: `1px solid ${BORDER_COLOR}`,
  textAlign: 'center', whiteSpace: 'nowrap',
};

const tdNum: React.CSSProperties = { ...td, fontFamily: FONT_NUM };

// 削除済み。取り消せるよう行は残すが、勘定に入っていないことが一目で分かるようにする
const rowExcluded: React.CSSProperties = {
  background: BG_ROOT, color: TEXT_MUTED, textDecoration: 'line-through',
};

const borderTag: React.CSSProperties = {
  marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#8a6d1f',
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`,
  borderRadius: 99, padding: '1px 6px',
};

// 運営パネルは細い窓でも使うので、入りきらなければボタンを下の行へ折り返す
const confirmRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap',
  borderTop: `1px solid ${BORDER_COLOR}`, paddingTop: 10, marginTop: 2,
};

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: 999, cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, flexShrink: 0,
};

const btnPrimary: React.CSSProperties = {
  ...btnBase, background: WIN_BASE, color: '#fff', fontSize: 12, padding: '8px 16px',
};

const btnGhost: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_COLOR}`, fontWeight: 400, fontSize: 11, padding: '5px 12px',
};

const btnRemove: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: HOT_COLOR, fontSize: 12, padding: '2px 8px',
};

const btnUndo: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_COLOR}`, fontWeight: 400, fontSize: 10, padding: '2px 8px',
};

const btnMuted: React.CSSProperties = {
  background: BG_ROOT, color: TEXT_MUTED, cursor: 'not-allowed',
};

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: RADIUS_SM, padding: '6px 10px', fontSize: 11,
};
