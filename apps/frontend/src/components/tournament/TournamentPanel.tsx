import { useEffect, useMemo, useState } from 'react';
import type {
  CatalogEntry, TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../hooks/useGameState';
import { MatchCard } from './MatchCard';
import { ResultConfirmDialog } from './ResultConfirmDialog';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI, GOLD_BASE, HOT_COLOR,
  RADIUS_MD, RADIUS_SM, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../styles/tokens';

// 運営操作パネル。コントロール画面のダイアログとしても、専用ウィンドウの一部としても使う。

export interface TournamentPanelProps {
  state:      TournamentStatePayload | null;
  httpBase:   string;
  commands:   TournamentCommands;
  lastError:  string | null;
  clearError: () => void;
  /** 一覧・インポートのUIを出すか (bind 前の運営操作) */
  showLibrary?: boolean;
  onClose?:   () => void;
}

export function TournamentPanel({
  state, httpBase, commands, lastError, clearError, showLibrary = true, onClose,
}: TournamentPanelProps) {
  const [summaries, setSummaries] = useState<TournamentSummary[]>([]);
  const [scanErrors, setScanErrors] = useState<{ id: string; message: string }[]>([]);
  const [programs, setPrograms]   = useState<CatalogEntry[]>([]);
  const [busy, setBusy]           = useState(false);

  const refresh = async () => {
    try {
      const res  = await fetch(`${httpBase}/api/tournament`);
      const body = await res.json() as { imported: TournamentSummary[]; errors: typeof scanErrors };
      setSummaries(body.imported ?? []);
      setScanErrors(body.errors ?? []);
    } catch { /* オフラインなら一覧は空のまま */ }
    try {
      const res = await fetch(`${httpBase}/api/programs`);
      setPrograms((await res.json() as { entries: CatalogEntry[] }).entries ?? []);
    } catch { /* 同上 */ }
  };

  useEffect(() => { void refresh(); }, [httpBase, state?.tournamentId]);

  const armed = state?.matches.find(m => m.id === state.armedMatchId) ?? null;
  const awaiting = state?.matches.find(m => m.status === 'awaiting_confirm') ?? null;
  const nextReady = useMemo(() => {
    if (!state) return null;
    return [...state.matches]
      .filter(m => m.status === 'ready')
      .sort((a, b) => a.stage - b.stage || a.order - b.order)[0] ?? null;
  }, [state]);

  const unassigned = state?.participants.filter(p => !p.builtinCpu && !p.programCatalogId) ?? [];

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch(`${httpBase}/api/tournament/upload`, { method: 'POST', body: fd });
      const body = await res.json() as { error?: string };
      if (body.error) window.alert(`取り込みに失敗しました:\n${body.error}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={root}>
      <div style={head}>
        <h2 style={title}>大会運営</h2>
        {onClose && <button style={btnGhost} onClick={onClose}>閉じる</button>}
      </div>

      {lastError && (
        <div style={errorBar} onClick={clearError} title="クリックで閉じる">
          ⚠ {lastError}
        </div>
      )}

      {/* ── 大会の選択・取り込み ── */}
      {showLibrary && (
        <section style={card}>
          <div style={sectionHead}>
            <span style={sectionTitle}>大会データ</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btnSmall} onClick={() => { commands.rescan(); void refresh(); }}>
                再スキャン
              </button>
              <label style={{ ...btnSmall, cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? '取り込み中…' : 'ファイルを読み込む'}
                <input
                  type="file" accept=".zip,.json" style={{ display: 'none' }} disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
                />
              </label>
            </div>
          </div>

          <p style={hint}>
            server/tournament/&lt;大会名&gt;/ に tournament.json と programs/*.py を置くか、
            .zip / .json を読み込んでください。
          </p>

          {scanErrors.map(e => (
            <div key={e.id} style={warnRow}>⚠ {e.id}: {e.message}</div>
          ))}

          {summaries.length === 0 && <div style={empty}>大会データがありません</div>}

          {summaries.map(s => {
            const active = state?.tournamentId === s.id;
            return (
              <div key={s.id} style={{ ...cupRow, ...(active ? cupRowActive : null) }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={cupName}>{s.name}</div>
                  <div style={cupMeta}>
                    {s.format === 'league' ? 'リーグ' : 'トーナメント'} ・
                    {s.participants}人 ・ {s.progress[0]}/{s.progress[1]} 試合完了
                  </div>
                </div>
                {active
                  ? <button style={btnDanger} onClick={commands.unbind}>運営を終了</button>
                  : <button style={btnPrimary} disabled={!!s.boundRoomId}
                            onClick={() => commands.bind(s.id)}>
                      {s.boundRoomId ? '他の部屋で運営中' : 'この大会を運営'}
                    </button>}
              </div>
            );
          })}
        </section>
      )}

      {!state && showLibrary && (
        <div style={empty}>大会を選ぶと、対戦カードの割り当てができます。</div>
      )}

      {state && (
        <>
          {/* ── 未提出プログラムの紐付け ── */}
          {unassigned.length > 0 && (
            <section style={card}>
              <div style={sectionTitle}>プログラム未登録の参加者</div>
              <p style={hint}>当日届いたプログラムをライブラリに追加してから割り当ててください。</p>
              {unassigned.map(p => (
                <div key={p.id} style={assignRow}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </span>
                  <select
                    style={select}
                    defaultValue=""
                    onChange={e => e.target.value && commands.assignProgram(p.id, e.target.value)}
                  >
                    <option value="">プログラムを選ぶ…</option>
                    {programs.map(pr => (
                      <option key={pr.id} value={pr.id}>{pr.displayName}</option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          )}

          {/* ── 次の一手 ── */}
          <section style={card}>
            <div style={sectionTitle}>いま操作する試合</div>

            {awaiting ? (
              <>
                <p style={hint}>対戦が終わりました。結果を確認して確定してください。</p>
                <MatchCard match={awaiting} participants={state.participants} style={{ width: '100%' }} />
              </>
            ) : armed ? (
              <>
                <p style={hint}>
                  両者の割り当てが済みました。フッターの「ゲームスタート」で開始してください。
                </p>
                <MatchCard match={armed} participants={state.participants} style={{ width: '100%' }} />
              </>
            ) : nextReady ? (
              <>
                <p style={hint}>次の試合です。「この試合を準備」でプログラムを自動割り当てします。</p>
                <MatchCard match={nextReady} participants={state.participants} style={{ width: '100%' }} />
                <button style={btnPrimaryWide} onClick={() => commands.arm(nextReady.id)}>
                  この試合を準備 ▶
                </button>
              </>
            ) : (
              <div style={empty}>
                {state.matches.every(m => m.status === 'done')
                  ? '全ての試合が終了しました 🎉'
                  : '実施できる試合がありません'}
              </div>
            )}
          </section>
        </>
      )}

      {/* 結果確定ダイアログ */}
      {state && awaiting && (
        <ResultConfirmDialog
          match={awaiting}
          participants={state.participants}
          isLeague={state.format === 'league'}
          httpBase={httpBase}
          requireMapChangeOnRematch={state.rules.mapCatalogId !== null}
          onConfirm={(winnerSide, note) => commands.confirm(awaiting.id, winnerSide, note)}
          onRematch={mapId => commands.discard(awaiting.id, mapId)}
          onWalkover={winnerSide => commands.walkover(awaiting.id, winnerSide)}
        />
      )}
    </div>
  );
}

const root: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
};

const head: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

const title: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };

const card: React.CSSProperties = {
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_MD, boxShadow: SHADOW_MD, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 8,
  minWidth: 0, boxSizing: 'border-box',
};

const sectionHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
};

const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700 };

const hint: React.CSSProperties = {
  margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6,
  overflowWrap: 'anywhere',
};

const empty: React.CSSProperties = {
  padding: 14, textAlign: 'center', color: TEXT_MUTED, fontSize: 12,
};

const cupRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
  padding: '8px 10px', borderRadius: RADIUS_SM, background: BG_ROOT,
};

const cupRowActive: React.CSSProperties = {
  outline: `2px solid ${WIN_BASE}`,
};

const cupName: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const cupMeta: React.CSSProperties = { fontSize: 10, color: TEXT_SECONDARY };

const assignRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
};

const select: React.CSSProperties = {
  fontSize: 11, padding: '4px 6px', borderRadius: 8,
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, fontFamily: FONT_UI,
};

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: 999, cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, color: '#fff',
};

const btnSmall: React.CSSProperties = {
  ...btnBase, background: COOL_COLOR, fontSize: 11, padding: '5px 12px',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase, background: COOL_COLOR, fontSize: 11, padding: '6px 14px', flexShrink: 0,
};

const btnPrimaryWide: React.CSSProperties = {
  ...btnBase, background: WIN_BASE, fontSize: 14, padding: '10px 16px', marginTop: 4,
};

const btnDanger: React.CSSProperties = {
  ...btnBase, background: HOT_COLOR, fontSize: 11, padding: '6px 14px', flexShrink: 0,
};

const btnGhost: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 12, padding: '6px 12px',
};

const errorBar: React.CSSProperties = {
  background: '#fff0f0', border: `1px solid ${HOT_COLOR}`, color: HOT_COLOR,
  borderRadius: RADIUS_SM, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
};

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: 8, padding: '6px 10px', fontSize: 11,
};
