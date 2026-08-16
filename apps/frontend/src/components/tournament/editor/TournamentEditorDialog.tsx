import { useEffect, useState } from 'react';
import type {
  CatalogEntry, MapCatalogEntry, TournamentDefinition, TournamentFormat,
  TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import { FormatRulesEditor } from './FormatRulesEditor';
import { ParticipantEditor } from './ParticipantEditor';
import { PairingEditor } from './PairingEditor';
import {
  FORMATS, FORMAT_LABEL, defaultId, definitionFromDraft, doubleModeSummary, draftFromDefinition,
  emptyDraft, libraryAssignments, previewMatchCount, suggestCopyId, validateDraft,
  type TournamentDraft,
} from './draft';
import {
  TEXT_SECONDARY, Button, Callout, ChipRow, Dialog, EmptyState, Field, Hint, Section, TextInput,
} from '../../../ui';

// 大会データ (tournament.json) を画面で作る / 直すためのダイアログ。
//
// 保存先は既存の取り込み口と同じ POST /api/tournament/import。つまりこの画面は
// 「tournament.json をフォームで書くための道具」であって、独自の保存経路を持たない。
// 手で書いた JSON・zip で取り込んだ大会と、出来上がるものは完全に同じ。
//
// プログラムの割り当てだけは別扱い: プログラムライブラリの ID はこの PC でしか通じないため
// 配布物である tournament.json には書かず、POST /api/tournament/:id/assign で
// state.json 側へ保存する (内蔵CPU と同梱ファイルは移植できるので定義に残す)。
//
// 下書きの形と検証・組み立ては draft.ts (純関数)。ここは読み込み・保存と画面の組み立て。

export interface TournamentEditorDialogProps {
  httpBase: string;
  /** 編集する大会 id。null なら新規作成 */
  editId:   string | null;
  onClose:  () => void;
  onSaved:  (id: string) => void;
}

export function TournamentEditorDialog({
  httpBase, editId, onClose, onSaved,
}: TournamentEditorDialogProps) {
  const [draft, setDraft] = useState<TournamentDraft>(() => emptyDraft(editId ?? defaultId()));

  const [programs, setPrograms]       = useState<CatalogEntry[]>([]);
  const [maps, setMaps]               = useState<MapCatalogEntry[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);

  /** 別名保存 (元の大会を残したまま新しい id で複製する) */
  const [saveAs, setSaveAs]   = useState(false);
  const [loading, setLoading] = useState(editId !== null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const patch = (p: Partial<TournamentDraft>) => setDraft(d => ({ ...d, ...p }));

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${httpBase}/api/programs`);
        setPrograms((await res.json() as { entries: CatalogEntry[] }).entries ?? []);
      } catch { /* ライブラリが取れなくても未提出のまま作れる */ }
      try {
        const res = await fetch(`${httpBase}/api/maps`);
        setMaps((await res.json() as { entries: MapCatalogEntry[] }).entries ?? []);
      } catch { /* 同上 */ }
      try {
        const res  = await fetch(`${httpBase}/api/tournament`);
        const body = await res.json() as { imported: TournamentSummary[] };
        setExistingIds((body.imported ?? []).map(t => t.id));
      } catch { /* 重複チェックができないだけ */ }
    })();
  }, [httpBase]);

  useEffect(() => {
    if (editId === null) return;
    void (async () => {
      try {
        const res  = await fetch(`${httpBase}/api/tournament/${encodeURIComponent(editId)}`);
        const body = await res.json() as {
          state?: TournamentStatePayload; definition?: TournamentDefinition; error?: string;
        };
        if (!res.ok || !body.definition) {
          setError(body.error ?? '大会データを読み込めませんでした');
          return;
        }
        setDraft(draftFromDefinition(body.definition, body.state ?? null));
      } catch (e) {
        setError(`大会データを読み込めませんでした: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [httpBase, editId]);

  const validation = validateDraft(draft, { editId, existingIds, saveAs });
  /** 上書き保存のまま大会IDを書き換えたか (= フォルダごと改名する) */
  const renaming = editId !== null && !saveAs && draft.id !== editId;
  /** 保存すると新しい大会が増えるか */
  const creatingNew = editId === null || saveAs;

  const save = async () => {
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      // 上書き保存のときは進行状態も作り直す (形式やルールだけ変えた場合を取りこぼさないため)。
      // 別名保存は新しいフォルダを作るだけなので、元の大会の進行状態には触れない
      const params = new URLSearchParams();
      if (!creatingNew || existingIds.includes(draft.id)) params.set('reset', '1');
      // ID を書き換えたときは、バックエンドに先にフォルダを改名させる
      // (取り込み直しでは programs/*.py が新しいフォルダに付いてこない)
      if (renaming) params.set('from', editId);
      const qs = params.toString();

      const res = await fetch(`${httpBase}/api/tournament/import${qs ? `?${qs}` : ''}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(definitionFromDraft(draft)),
      });
      const body = await res.json() as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? '保存に失敗しました');
        return;
      }

      const assignments = libraryAssignments(draft);
      if (Object.keys(assignments).length > 0) {
        const ares = await fetch(
          `${httpBase}/api/tournament/${encodeURIComponent(body.id)}/assign`,
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ assignments }),
          },
        );
        if (!ares.ok) {
          const abody = await ares.json() as { error?: string };
          setError(`大会は保存しましたが、プログラムの割り当てに失敗しました: ${abody.error ?? ''}`);
          return;
        }
      }

      onSaved(body.id);
    } catch (e) {
      setError(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveLabel =
      saving          ? '保存中…'
    : editId === null ? 'この内容で作成'
    : saveAs          ? '別名で保存'
    : renaming        ? 'IDを変えて保存'
    :                   '上書き保存';

  return (
    <Dialog
      title={editId === null ? '大会データを作る' : '大会データを編集'}
      onClose={onClose}
      width={760}
      bodyStyle={s.body}
      footer={
        <>
          <span style={s.preview} data-testid="editor-preview">
            {FORMAT_LABEL[draft.format]} ・ {draft.participants.length}人 ・
            {' '}全 {previewMatchCount(draft)} 試合{doubleModeSummary(draft)}
          </span>
          <Button variant="ghost" onClick={onClose}>キャンセル</Button>
          {editId !== null && (
            <Button
              size="sm" disabled={saving}
              onClick={() => setSaveAs(v => {
                // 別名保存に切り替えた瞬間に、そのままでは重複する id をずらしておく
                patch({ id: v ? editId : suggestCopyId(draft.id, existingIds) });
                return !v;
              })}
            >
              {saveAs ? '上書き保存に戻す' : '別名で保存'}
            </Button>
          )}
          <Button
            variant="primary" size="md"
            disabled={validation !== null || saving}
            title={validation ?? ''}
            onClick={() => void save()}
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      <div data-testid="tournament-editor" style={s.sections}>
        {loading ? (
          <EmptyState>読み込み中…</EmptyState>
        ) : (
          <>
            {error && <Callout tone="error" testId="editor-error">{error}</Callout>}

            <Section title="大会">
              <Field label="大会名">
                <TextInput
                  aria-label="大会名" value={draft.name}
                  placeholder="第N回 U15プログラミング大会 舞鶴"
                  onChange={e => patch({ name: e.target.value })}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </Field>
              <Field label="大会ID">
                <TextInput
                  aria-label="大会ID" value={draft.id}
                  onChange={e => patch({ id: e.target.value })}
                  style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }}
                />
              </Field>
              <Hint>
                大会ID は server/tournament/ の下に作られるフォルダ名です。
                {saveAs && ' 別名保存: 新しいIDで複製します。元の大会はそのまま残ります。'}
              </Hint>
              {renaming && (
                <Callout tone="warn">
                  大会ID を「{editId}」から「{draft.id}」へ変更します。フォルダごと名前が変わるので、
                  元のIDは残りません。元を残したまま複製したいときは「別名で保存」を使ってください。
                </Callout>
              )}

              <ChipRow>
                {FORMATS.map(f => (
                  <Button
                    key={f} variant="choice" size="sm"
                    selected={draft.format === f}
                    onClick={() => patch({ format: f as TournamentFormat })}
                  >
                    {FORMAT_LABEL[f]}
                  </Button>
                ))}
              </ChipRow>
            </Section>

            <FormatRulesEditor draft={draft} programs={programs} maps={maps} patch={patch} />
            <ParticipantEditor draft={draft} programs={programs} patch={patch} />
            <PairingEditor draft={draft} patch={patch} />

            {validation && (
              <Callout tone="warn" testId="editor-validation">{validation}</Callout>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

const s: Record<string, React.CSSProperties> = {
  body:     { background: '#faf7ff' },
  sections: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  preview:  { flex: 1, minWidth: 0, fontSize: 12, color: TEXT_SECONDARY },
};
