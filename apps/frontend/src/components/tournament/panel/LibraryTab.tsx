import { useState } from 'react';
import type { TournamentFormat, TournamentStatePayload, TournamentSummary } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { alertDialog, confirmDialog } from '../../../lib/nativeDialog';
import { deleteTournament } from '../../../lib/api';
import { TournamentEditorDialog } from '../editor/TournamentEditorDialog';
import {
  BG_ROOT, RADIUS_SM, TEXT_SECONDARY, WIN_BASE,
  Button, ButtonLabel, Callout, EmptyState, Hint, Section,
} from '../../../ui';

// 運営する大会を選ぶ・作る・持ち出す。bind の前後どちらでも使う。

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  'single-elimination': 'トーナメント',
  'league':             'リーグ',
  'group-then-bracket': '予選リーグ + 決勝トーナメント',
  'bot-then-bracket':   'BOT対戦予選 + 決勝トーナメント',
};

export interface LibraryTabProps {
  state:      TournamentStatePayload | null;
  summaries:  TournamentSummary[];
  scanErrors: { id: string; message: string }[];
  httpBase:   string;
  commands:   TournamentCommands;
  refresh:    () => Promise<void>;
}

export function LibraryTab({
  state, summaries, scanErrors, httpBase, commands, refresh,
}: LibraryTabProps) {
  const [busy, setBusy] = useState(false);
  /** 作成・編集ダイアログ。'new' なら新規、大会 id なら編集 */
  const [editing, setEditing] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch(`${httpBase}/api/tournament/upload`, { method: 'POST', body: fd });
      const body = await res.json() as { error?: string };
      if (body.error) alertDialog(`取り込みに失敗しました:\n${body.error}`);
      commands.rescan();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  /**
   * 大会データを .zip で書き出す (= この「ファイルを読み込む」に食わせられる形)。
   *
   * 同梱できなかったプログラムはヘッダ (X-Bundle-Skipped) で返ってくるので、
   * <a href> ではなく fetch + Blob で受けて内容を読む。
   */
  const exportBundle = async (t: TournamentSummary) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${httpBase}/api/tournament/${encodeURIComponent(t.id)}/export?format=bundle.zip`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        alertDialog(`書き出しに失敗しました:\n${body.error ?? res.statusText}`);
        return;
      }

      const url = URL.createObjectURL(await res.blob());
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${t.name.replace(/[\\/:*?"<>|]/g, '_')}_大会データ.zip`;
      a.click();
      URL.revokeObjectURL(url);

      const raw     = res.headers.get('X-Bundle-Skipped');
      const skipped = raw ? JSON.parse(decodeURIComponent(raw)) as string[] : [];
      if (skipped.length > 0) {
        alertDialog(`一部のプログラムは同梱できませんでした:\n${skipped.join('\n')}`);
      }
    } catch (e) {
      alertDialog(`書き出しに失敗しました:\n${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t: TournamentSummary) => {
    // 上書き保存すると進行状態を作り直すので、実施済みの試合があれば断りを入れる
    if (t.progress[0] > 0 && !confirmDialog(
      `「${t.name}」は ${t.progress[0]} 試合が確定済みです。\n`
      + '編集して上書き保存すると、進行状態は最初からやり直しになります。続けますか？')) {
      return;
    }
    setEditing(t.id);
  };

  const handleDelete = (t: TournamentSummary) => {
    const ok = confirmDialog(
      `「${t.name}」をライブラリから削除します。\n`
      + '進行状態・参加プログラムを含めて完全に削除され、元に戻せません。よろしいですか？',
    );
    if (!ok) return;
    void deleteTournament(httpBase, t.id).then(refresh);
  };

  return (
    <>
      <Section
        title="大会データ"
        actions={
          <>
            <Button size="sm" variant="accent" onClick={() => setEditing('new')}>+ 新規作成</Button>
            <Button size="sm" onClick={() => { commands.rescan(); void refresh(); }}>再スキャン</Button>
            <ButtonLabel size="sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? '取り込み中…' : 'ファイルを読み込む'}
              <input
                type="file" accept=".zip,.json" style={{ display: 'none' }} disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
              />
            </ButtonLabel>
          </>
        }
      >
        <Hint>
          server/tournament/&lt;大会名&gt;/ に tournament.json と programs/*.py を置くか、
          .zip / .json を読み込んでください。「書き出し」で保存した .zip は、そのまま
          別の PC で読み込めばすぐ運営できます（進行状態は引き継がれず、最初からになります）。
        </Hint>

        {scanErrors.map(e => (
          <Callout key={e.id} tone="warn">{e.id}: {e.message}</Callout>
        ))}

        {summaries.length === 0 && <EmptyState>大会データがありません</EmptyState>}

        {summaries.map(t => {
          const active = state?.tournamentId === t.id;
          return (
            <div key={t.id} style={{ ...s.row, ...(active ? s.rowActive : null) }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={s.name}>{t.name}</div>
                <div style={s.meta}>
                  {FORMAT_LABEL[t.format]} ・ {t.participants}人 ・
                  {' '}{t.progress[0]}/{t.progress[1]} 試合完了
                </div>
              </div>
              <Button
                size="sm" noShrink disabled={busy}
                title="この大会データを .zip で書き出す (別の PC で読み込めばそのまま運営できます)"
                onClick={() => void exportBundle(t)}
              >
                書き出し
              </Button>
              <Button
                size="sm" noShrink disabled={!!t.boundRoomId}
                title={t.boundRoomId ? '運営中の大会は編集できません' : '内容を編集する'}
                onClick={() => startEdit(t)}
              >
                編集
              </Button>
              <Button
                size="sm" variant="danger" noShrink disabled={!!t.boundRoomId}
                title={t.boundRoomId ? '運営中の大会は削除できません' : '大会データを削除する'}
                onClick={() => handleDelete(t)}
              >
                削除
              </Button>
              {active
                ? <Button size="sm" variant="danger" noShrink onClick={commands.unbind}>運営を終了</Button>
                : <Button
                    size="sm" variant="accent" noShrink disabled={!!t.boundRoomId}
                    onClick={() => commands.bind(t.id)}
                  >
                    {t.boundRoomId ? '他の部屋で運営中' : 'この大会を運営'}
                  </Button>}
            </div>
          );
        })}
      </Section>

      {editing && (
        <TournamentEditorDialog
          httpBase={httpBase}
          editId={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); commands.rescan(); void refresh(); }}
        />
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
    padding: '8px 10px', borderRadius: RADIUS_SM, background: BG_ROOT, flexWrap: 'wrap',
  },
  rowActive: { outline: `2px solid ${WIN_BASE}` },
  name: {
    fontSize: 13, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 10, color: TEXT_SECONDARY },
};
