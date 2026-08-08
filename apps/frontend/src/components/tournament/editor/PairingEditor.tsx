import { autoSlots, slotPairs } from '../../../lib/bracketSlots';
import { TEXT_MUTED, Checkbox, Hint, Section, Select } from '../../../ui';
import type { TournamentDraft } from './draft';

// 1回戦の組み合わせ (トーナメントのみ)。
// 既定は標準シード配置の自動生成で、実行委員会が決めた組み合わせがある場合だけ手で並べる。

export interface PairingEditorProps {
  draft: TournamentDraft;
  patch: (p: Partial<TournamentDraft>) => void;
}

export function PairingEditor({ draft, patch }: PairingEditorProps) {
  if (draft.format !== 'single-elimination') return null;

  const ids    = draft.participants.map(p => p.id);
  const nameOf = (pid: string | null) =>
    (pid === null ? '— bye —' : draft.participants.find(p => p.id === pid)?.name || '(名前未入力)');

  const setSlotAt = (i: number, value: string | null) => {
    const next = [...draft.slots];
    // 同じ参加者が2箇所に入らないよう、元いた枠を空ける
    if (value !== null) {
      const dup = next.indexOf(value);
      if (dup >= 0 && dup !== i) next[dup] = null;
    }
    next[i] = value;
    patch({ slots: next });
  };

  return (
    <Section
      title="組み合わせ"
      actions={
        <label style={s.toggle}>
          <Checkbox
            checked={draft.manualBracket}
            aria-label="組み合わせを手動で指定する"
            onChange={e => patch({
              manualBracket: e.target.checked,
              slots: e.target.checked ? autoSlots(ids) : [],
            })}
          />
          <span>手動で指定する</span>
        </label>
      }
    >
      {!draft.manualBracket ? (
        <Hint>
          参加者の並び順から標準シード配置で自動生成します
          （第1シードと第2シードが決勝まで当たらない配置）。
          実行委員会が決めた組み合わせがある場合は「手動で指定する」を使ってください。
        </Hint>
      ) : (
        <>
          <Hint>1回戦の対戦カードです。空きは bye（不戦勝）になります。</Hint>
          {slotPairs(draft.slots).map(([a, b], i) => (
            <div key={i} style={s.pair}>
              <span style={s.no}>第{i + 1}試合</span>
              {[a, b].map((v, k) => (
                <Select
                  key={k} value={v ?? ''}
                  aria-label={`1回戦 第${i + 1}試合 の${k === 0 ? '先攻' : '後攻'}`}
                  onChange={e => setSlotAt(i * 2 + k, e.target.value || null)}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <option value="">— bye —</option>
                  {draft.participants.map(p => (
                    <option key={p.id} value={p.id}>{p.name || '(名前未入力)'}</option>
                  ))}
                </Select>
              ))}
            </div>
          ))}
          {slotPairs(draft.slots)
            .filter(([a, b]) => a === null || b === null)
            .map(([a, b], i) => (
              <Hint key={i}>{nameOf(a === null ? b : a)} は不戦勝で次の回戦へ進みます</Hint>
            ))}
        </>
      )}
    </Section>
  );
}

const s: Record<string, React.CSSProperties> = {
  toggle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' },
  pair:   { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  no:     { width: 56, flexShrink: 0, fontSize: 11, color: TEXT_MUTED },
};
