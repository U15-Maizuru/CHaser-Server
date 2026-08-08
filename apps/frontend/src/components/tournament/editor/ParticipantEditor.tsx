import { useState } from 'react';
import type { CatalogEntry } from '@u15/ws-types';
import { groupLabel } from '@u15/ws-types';
import { fitSlots } from '../../../lib/bracketSlots';
import {
  HOT_COLOR, TEXT_MUTED, Button, EmptyState, Hint, Section, Select, TextInput,
} from '../../../ui';
import { autoGroupsOf, newParticipant, type DraftParticipant, type TournamentDraft } from './draft';

// 参加者の名簿。**上から順が選手番号**で、番号の小さい方が第1ゲームで先攻になる。

export interface ParticipantEditorProps {
  draft:    TournamentDraft;
  programs: CatalogEntry[];
  patch:    (p: Partial<TournamentDraft>) => void;
}

export function ParticipantEditor({ draft, programs, patch }: ParticipantEditorProps) {
  const [bulk, setBulk]         = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const { participants, format } = draft;
  const autoGroups = autoGroupsOf(draft);

  /** 参加者を差し替え、手動組み合わせなら配置も追従させる */
  const update = (next: DraftParticipant[]) => {
    patch({
      participants: next,
      ...(draft.manualBracket ? { slots: fitSlots(draft.slots, next.map(p => p.id)) } : {}),
    });
  };

  const patchAt = (i: number, p: Partial<DraftParticipant>) =>
    update(participants.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const addOne = () =>
    update([...participants, newParticipant(new Set(participants.map(p => p.id)), '')]);

  const addBulk = () => {
    const names = bulk.split('\n').map(s => s.trim()).filter(s => s !== '');
    if (names.length === 0) return;
    const taken = new Set(participants.map(p => p.id));
    const added = names.map(n => {
      const p = newParticipant(taken, n);
      taken.add(p.id);
      return p;
    });
    update([...participants, ...added]);
    setBulk('');
    setShowBulk(false);
  };

  const moveAt = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= participants.length) return;
    const next = [...participants];
    [next[i], next[j]] = [next[j]!, next[i]!];
    update(next);
  };

  /**
   * プログラムを選び直す。プログラム側に名前が書かれていれば、それをプレイヤー名の
   * 初期値として入れる。対象は「空欄」か「前回そうやって自動で入れた値のまま」のときだけで、
   * 一度手で書いた名前はプログラムを替えても上書きしない。自動で入れた名前は、名前を
   * 書いていないプログラムに替えたら空欄へ戻す。
   */
  const selectProgramAt = (i: number, program: string) => {
    const declared = program.startsWith('lib:')
      ? programs.find(pr => pr.id === program.slice(4))?.declaredName
      : undefined;

    update(participants.map((p, j) => {
      if (j !== i) return p;
      const autoFilled = p.nameFromProgram !== undefined && p.name === p.nameFromProgram;
      const next: DraftParticipant = {
        ...p, program,
        name: p.name === '' || autoFilled ? declared ?? '' : p.name,
      };
      if (declared === undefined) delete next.nameFromProgram;
      else next.nameFromProgram = declared;
      return next;
    }));
  };

  const setGroupAt = (i: number, group: number | undefined) =>
    patch({
      participants: participants.map((p, k) => {
        if (k !== i) return p;
        const next = { ...p };
        if (group === undefined) delete next.group;
        else next.group = group;
        return next;
      }),
    });

  const reassignGroups = () =>
    patch({
      participants: participants.map(p => {
        const next = { ...p };
        delete next.group;
        return next;
      }),
    });

  return (
    <Section
      title={`参加者 (${participants.length}人)`}
      actions={
        <>
          {format === 'group-then-bracket' && (
            <Button size="sm" onClick={reassignGroups}>自動で振り分け直す</Button>
          )}
          <Button size="sm" onClick={addOne}>+ 1人追加</Button>
          <Button size="sm" onClick={() => setShowBulk(v => !v)}>まとめて追加</Button>
        </>
      }
    >
      <Hint>
        上から順が選手番号です。番号の小さい方が第1ゲームで先攻になります。
        {format === 'group-then-bracket'
          && ' 予選リーグは選手番号順に蛇行 (A,B,B,A…) で振り分けます。個別に変えられます。'}
      </Hint>

      {showBulk && (
        <div style={s.bulk}>
          <textarea
            style={s.textarea} value={bulk}
            aria-label="参加者をまとめて追加"
            placeholder={'1行に1プレイヤー\n舞鶴A\n舞鶴B'}
            onChange={e => setBulk(e.target.value)}
          />
          <Button size="sm" onClick={addBulk}>この内容で追加</Button>
        </div>
      )}

      {participants.length === 0 && <EmptyState>参加者がまだいません</EmptyState>}

      {participants.map((p, i) => (
        <div key={p.key} style={s.row} data-testid="participant-row">
          <span style={s.seed}>{i + 1}</span>
          <TextInput
            value={p.name} aria-label={`参加者${i + 1} の名前`} placeholder="プレイヤー名"
            onChange={e => patchAt(i, { name: e.target.value })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Select
            value={p.program} aria-label={`参加者${i + 1} のプログラム`}
            onChange={e => selectProgramAt(i, e.target.value)}
            style={{ width: 190 }}
          >
            <option value="">未提出（当日割り当て）</option>
            <option value="cpu">内蔵CPU</option>
            {p.file && <option value="file">同梱: {p.file.file}</option>}
            {programs.map(pr => (
              <option key={pr.id} value={`lib:${pr.id}`}>{pr.displayName}</option>
            ))}
          </Select>
          {format === 'group-then-bracket' && (
            <Select
              aria-label={`参加者${i + 1} の予選リーグ`}
              value={p.group ?? ''}
              onChange={e => setGroupAt(i, e.target.value === '' ? undefined : Number(e.target.value))}
              style={{ width: 84 }}
            >
              <option value="">自動（{groupLabel(autoGroups[i] ?? 0)}）</option>
              {Array.from({ length: draft.groupCount }, (_, g) => (
                <option key={g} value={g}>{groupLabel(g)}リーグ</option>
              ))}
            </Select>
          )}
          <Button
            variant="ghost" size="sm" aria-label={`参加者${i + 1} を上へ`}
            disabled={i === 0} onClick={() => moveAt(i, -1)}
          >↑</Button>
          <Button
            variant="ghost" size="sm" aria-label={`参加者${i + 1} を下へ`}
            disabled={i === participants.length - 1} onClick={() => moveAt(i, 1)}
          >↓</Button>
          <Button
            variant="ghost" size="sm" aria-label={`参加者${i + 1} を削除`}
            style={{ color: HOT_COLOR }}
            onClick={() => update(participants.filter((_, j) => j !== i))}
          >✕</Button>
        </div>
      ))}
    </Section>
  );
}

const s: Record<string, React.CSSProperties> = {
  row:  { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  seed: { width: 20, flexShrink: 0, fontSize: 11, color: TEXT_MUTED, textAlign: 'right' },
  bulk: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' },
  textarea: {
    width: '100%', minHeight: 72, resize: 'vertical', boxSizing: 'border-box',
    padding: '5px 8px', background: '#faf7ff',
    border: '1px solid rgba(140,120,210,0.18)', borderRadius: 12, fontSize: 12,
  },
};
