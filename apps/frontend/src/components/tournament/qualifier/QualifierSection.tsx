import type { QualifierSlot, TournamentStatePayload } from '@u15/ws-types';
import { groupLabel, hasBotStage } from '@u15/ws-types';
import { confirmDialog } from '../../../lib/nativeDialog';
import {
  BG_CARD, BORDER_COLOR, FONT_UI, GOLD_BASE, RADIUS_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../../ui';

// 決勝トーナメントの進出者。
//
// 自動判定は順位表の位置から必ず決定的に枠を埋めるので、放っておいても決勝は始められる。
// ここが要るのは、公式ルールの同点処理 (勝ち点 → 合計ポイント → 直接対決) でも並びが
// 決まらなかったときに、運営が最終的に決め直すため。あやしい枠には印を出す。

export type SetQualifier = (participantId: string | null, cascade?: boolean) => void;

/** 枠の呼び名。BOT対戦予選は1グループしか無いのでリーグ名を付けない */
export function slotLabelOf(state: TournamentStatePayload, group: number, rank: number): string {
  return hasBotStage(state.stage.format)
    ? `予選 ${rank}位`
    : `${groupLabel(group)}リーグ ${rank}位`;
}

/** その枠に入れられる候補 (同じ予選リーグの参加者)。既に別の枠に入っている人は除く */
function candidatesFor(
  state: TournamentStatePayload, group: number, rank: number,
): { id: string; name: string }[] {
  const g = state.groups?.find(x => x.group === group);
  if (!g) return [];
  const taken = new Set(
    (state.qualifiers ?? [])
      .filter(q => !(q.group === group && q.rank === rank))
      .map(q => q.participantId)
      .filter((id): id is string => id !== null),
  );
  return g.participantIds
    .filter(id => !taken.has(id))
    .map(id => ({ id, name: state.participants.find(p => p.id === id)?.name ?? id }));
}

/** その枠を使う1回戦が、もう動いてしまっているか */
function lockedBy(state: TournamentStatePayload, group: number, rank: number) {
  const m = state.matches.find(x =>
    [x.slotA, x.slotB].some(r => r.kind === 'group-rank' && r.group === group && r.rank === rank));
  if (!m) return null;
  if (m.status === 'pending' || m.status === 'ready') return null;
  if (m.status === 'done' && (m.byeA || m.byeB)) return null;   // 不戦は巻き戻しても失うものが無い
  return m;
}

function noteOf(slot: QualifierSlot): { text: string; tone: 'warn' | 'info' | 'ok' } {
  if (slot.bye)       return { text: '不戦 (人数不足)', tone: 'info' };
  if (slot.pending)   return { text: '予選の結果待ち', tone: 'info' };
  if (slot.manualParticipantId) return { text: '手動で変更', tone: 'warn' };
  if (slot.ambiguous) return { text: '同点 — 要確認', tone: 'warn' };
  if (slot.tied)      return { text: '同着', tone: 'info' };
  return { text: '自動', tone: 'ok' };
}

export interface QualifierPickerProps {
  state:    TournamentStatePayload;
  group:    number;
  rank:     number;
  onChange: SetQualifier;
  compact?: boolean;
}

/** 枠1つぶんのプルダウン。運営パネルと、トーナメント表の選択バーの両方で使う */
export function QualifierPicker({
  state, group, rank, onChange, compact = false,
}: QualifierPickerProps) {
  const slot = state.qualifiers?.find(q => q.group === group && q.rank === rank);
  if (!slot || slot.bye) return null;

  const locked = lockedBy(state, group, rank);

  const change = (value: string) => {
    const pid = value === '' ? null : value;
    if (locked) {
      const ok = confirmDialog(
        `「${locked.label}」は実施済みです。\n変更するとその結果は取り消されます。続けますか？`,
      );
      if (!ok) return;
      onChange(pid, true);
      return;
    }
    onChange(pid);
  };

  return (
    <select
      style={{ ...select, ...(compact ? selectCompact : null) }}
      aria-label={slotLabelOf(state, group, rank)}
      value={slot.manualParticipantId ?? ''}
      onChange={e => change(e.target.value)}
    >
      <option value="">
        自動{slot.autoParticipantId
          ? `（${state.participants.find(p => p.id === slot.autoParticipantId)?.name ?? '—'}）`
          : '（結果待ち）'}
      </option>
      {candidatesFor(state, group, rank).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

export interface QualifierSectionProps {
  state:    TournamentStatePayload;
  onChange: (group: number, rank: number, participantId: string | null, cascade?: boolean) => void;
  /** 確定 / 確定の取り消し。渡さなければ確定操作を出さない */
  onConfirm?: (confirmed: boolean) => void;
}

export function QualifierSection({ state, onChange, onConfirm }: QualifierSectionProps) {
  const slots = state.qualifiers ?? [];
  if (slots.length === 0) return null;

  const anyAmbiguous = slots.some(s => s.ambiguous);
  // 予選が終わっていない = まだ確定できない。枠の pending がそのまま指標になる
  const waiting   = slots.some(s => s.pending);
  const confirmed = state.qualifiersConfirmed;

  return (
    <section style={card}>
      <div style={sectionTitle}>決勝進出者</div>
      <p style={hint}>
        予選の順位から自動で決まります。同点で決められないときはここで選び直してください
        （トーナメント表のカードからも変更できます）。
      </p>
      {anyAmbiguous && (
        <div style={warnRow}>
          ⚠ 勝ち点・合計ポイント・直接対決まで並んだ枠があります。運営で決めてください。
        </div>
      )}

      {slots.map(s => {
        const note = noteOf(s);
        return (
          <div key={`${s.group}:${s.rank}`} style={row}>
            <span style={slotLabel}>{slotLabelOf(state, s.group, s.rank)}</span>
            {s.bye ? (
              <span style={{ ...noteText, color: TEXT_MUTED, flex: 1 }}>不戦 (人数不足)</span>
            ) : (
              <QualifierPicker
                state={state} group={s.group} rank={s.rank}
                onChange={(pid, cascade) => onChange(s.group, s.rank, pid, cascade)}
              />
            )}
            <span style={{
              ...noteText,
              color: note.tone === 'warn' ? GOLD_BASE : note.tone === 'ok' ? WIN_BASE : TEXT_MUTED,
            }}>
              {note.text}
            </span>
          </div>
        );
      })}

      {/* 確定 — 予選が終わってから決勝トーナメントに移るための一手 */}
      {onConfirm && (waiting ? (
        <p style={hint} data-testid="qualifier-waiting">
          予選リーグが全部終わると、ここで決勝進出者を確定できます。
        </p>
      ) : confirmed ? (
        <div style={confirmRow}>
          <span style={{ ...noteText, color: WIN_BASE, flex: 1, minWidth: 180, fontSize: 12 }}>
            ✓ 確定済み — 閲覧画面は決勝トーナメント表になりました
          </span>
          <button style={btnGhost} onClick={() => onConfirm(false)}>確定を取り消す</button>
        </div>
      ) : (
        <div style={confirmRow}>
          <span style={{ ...hint, flex: 1, minWidth: 200 }}>
            閲覧画面には<strong>予選リーグの最終結果</strong>を出しています。
            上の顔ぶれでよければ確定してください。確定すると決勝トーナメント表に切り替わり、
            決勝の試合を準備できるようになります。
          </span>
          <button style={btnPrimary} onClick={() => onConfirm(true)}>
            この顔ぶれで確定 ▶
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

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0,
};

const slotLabel: React.CSSProperties = { width: 96, flexShrink: 0, fontWeight: 600 };

const noteText: React.CSSProperties = { fontSize: 10, flexShrink: 0, minWidth: 64 };

const select: React.CSSProperties = {
  fontSize: 11, padding: '4px 6px', borderRadius: 8, flex: 1, minWidth: 0,
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, fontFamily: FONT_UI,
};

const selectCompact: React.CSSProperties = { flex: 'none', maxWidth: 160 };

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

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: RADIUS_SM, padding: '6px 10px', fontSize: 11,
};
