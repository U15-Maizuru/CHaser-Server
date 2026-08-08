import { useEffect, useMemo, useState } from 'react';
import type {
  CatalogEntry, MapCatalogEntry, TournamentDisplayView, TournamentFormat,
  TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import {
  compareByPlayOrder, hasBotStage, hasBracket, hasQualifying, hasThirdPlaceMatch,
} from '@u15/ws-types';
import type { TournamentCommands } from '../../hooks/useGameState';
import { MatchCard } from './MatchCard';
import { ResultConfirmDialog } from './ResultConfirmDialog';
import { BotQualifierSection } from './BotQualifierSection';
import { QualifierSection } from './QualifierSection';
import { TournamentEditorDialog } from './TournamentEditorDialog';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI, GOLD_BASE, HOT_COLOR,
  RADIUS_MD, RADIUS_SM, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../ui';

// 運営操作パネル。コントロール画面のダイアログとしても、専用ウィンドウの一部としても使う。

const DISPLAY_VIEWS = (botStage: boolean): [TournamentDisplayView, string][] => [
  ['auto',    '進行に合わせる'],
  ['groups',  botStage ? 'BOT対戦予選の表' : '予選リーグ表'],
  ['bracket', '決勝トーナメント表'],
];

const FORMAT_LABEL: Record<TournamentFormat, string> = {
  'single-elimination': 'トーナメント',
  'league':             'リーグ',
  'group-then-bracket': '予選リーグ + 決勝トーナメント',
  'bot-then-bracket':   'BOT対戦予選 + 決勝トーナメント',
};

/**
 * 決勝進出者の確定待ちで、その試合をまだ準備できないか。
 *
 * バックエンドの armMatch も同じ条件で弾く。ここで出し分けるのは、押してから
 * エラーで跳ね返されるより「まず確定してください」と見えている方が分かるため。
 */
function blockedByQualifiers(
  state: TournamentStatePayload, match: TournamentStatePayload['matches'][number],
): boolean {
  return hasQualifying(state.stage.format) && match.group === undefined && !state.qualifiersConfirmed;
}

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
  const [maps, setMaps]           = useState<MapCatalogEntry[]>([]);
  const [busy, setBusy]           = useState(false);
  /** 大会データ作成/編集ダイアログ。'new' なら新規、大会 id なら編集 */
  const [editing, setEditing]     = useState<string | null>(null);

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
    try {
      const res = await fetch(`${httpBase}/api/maps`);
      setMaps((await res.json() as { entries: MapCatalogEntry[] }).entries ?? []);
    } catch { /* 回戦ごとのマップを選べないだけ */ }
  };

  useEffect(() => { void refresh(); }, [httpBase, state?.tournamentId]);

  const armed = state?.matches.find(m => m.id === state.armedMatchId) ?? null;
  const awaiting = state?.matches.find(m => m.status === 'awaiting_confirm') ?? null;
  const nextReady = useMemo(() => {
    if (!state) return null;
    // 実施順はバックエンドの nextReadyMatch と同じ規則 (3位決定戦は決勝より先)
    return [...state.matches].filter(m => m.status === 'ready').sort(compareByPlayOrder)[0] ?? null;
  }, [state]);

  const unassigned = state?.participants.filter(p => !p.builtinCpu && !p.programCatalogId) ?? [];

  // 予選の節数 = 決勝トーナメントの stage のゲタ。予選を持たない形式では 0
  const groupStageCount = state
    ? state.matches.reduce((max, m) => (m.group === undefined ? max : Math.max(max, m.stage + 1)), 0)
    : 0;

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

  /**
   * 大会データを .zip で書き出す (= この「ファイルを読み込む」に食わせられる形)。
   *
   * 同梱できなかったプログラムはヘッダ (X-Bundle-Skipped) で返ってくるので、
   * <a href> ではなく fetch + Blob で受けて内容を読む。
   */
  const exportBundle = async (s: TournamentSummary) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${httpBase}/api/tournament/${encodeURIComponent(s.id)}/export?format=bundle.zip`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        window.alert(`書き出しに失敗しました:\n${body.error ?? res.statusText}`);
        return;
      }

      const url = URL.createObjectURL(await res.blob());
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${s.name.replace(/[\\/:*?"<>|]/g, '_')}_大会データ.zip`;
      a.click();
      URL.revokeObjectURL(url);

      const raw     = res.headers.get('X-Bundle-Skipped');
      const skipped = raw ? JSON.parse(decodeURIComponent(raw)) as string[] : [];
      if (skipped.length > 0) {
        window.alert(`一部のプログラムは同梱できませんでした:\n${skipped.join('\n')}`);
      }
    } catch (e) {
      window.alert(`書き出しに失敗しました:\n${(e as Error).message}`);
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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button style={btnSmall} onClick={() => setEditing('new')}>+ 新規作成</button>
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
            「書き出し」で保存した .zip は、そのまま別の PC で読み込めばすぐ運営できます
            （進行状態は引き継がれず、最初からになります）。
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
                    {FORMAT_LABEL[s.format]} ・
                    {s.participants}人 ・ {s.progress[0]}/{s.progress[1]} 試合完了
                  </div>
                </div>
                <button
                  style={btnGhostSmall}
                  disabled={busy}
                  title="この大会データを .zip で書き出す (別の PC で読み込めばそのまま運営できます)"
                  onClick={() => void exportBundle(s)}
                >
                  書き出し
                </button>
                <button
                  style={{ ...btnGhostSmall, ...(s.boundRoomId ? btnMuted : null) }}
                  disabled={!!s.boundRoomId}
                  title={s.boundRoomId ? '運営中の大会は編集できません' : '内容を編集する'}
                  onClick={() => {
                    // 上書き保存すると進行状態を作り直すので、実施済みの試合があれば断りを入れる
                    if (s.progress[0] > 0
                      && !window.confirm(
                        `「${s.name}」は ${s.progress[0]} 試合が確定済みです。\n`
                        + '編集して上書き保存すると、進行状態は最初からやり直しになります。続けますか？')) {
                      return;
                    }
                    setEditing(s.id);
                  }}
                >
                  編集
                </button>
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
                    {p.isBot ? `🤖 ${p.name}（運営BOT）` : p.name}
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

          {/* ── 観戦画面の表示 (予選があるときだけ) ── */}
          {hasQualifying(state.stage.format) && (
            <section style={card}>
              <div style={sectionTitle}>閲覧画面の表示</div>
              <p style={hint}>
                観客席の画面 (対戦画面) に出すものを選びます。
                <strong>この運営画面の表示とは連動しません</strong> —
                観客には予選表を出したまま、手元で決勝の組み合わせを確認できます。
                対戦中は盤面が優先されます。
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DISPLAY_VIEWS(hasBotStage(state.stage.format)).map(([view, label]) => (
                  <button
                    key={view}
                    style={{ ...btnChoice, ...(state.displayView === view ? btnChoiceOn : null) }}
                    onClick={() => commands.setDisplayView(view)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {state.displayView === 'auto' && (
                <p style={hint}>
                  進行に追従します。予選が終わっても自動では切り替わらず、
                  下の「決勝進出者」を<strong>確定するまで予選の最終結果を出し続けます</strong>。
                </p>
              )}
            </section>
          )}

          {/* ── 決勝進出者 (予選があるときだけ) ──
              予選リーグは枠ごとの差し替え、BOT対戦予選は確認リストからの削除。
              同点の決め方が違うので UI ごと分ける (詳しくは各コンポーネントの冒頭) */}
          {hasBotStage(state.stage.format) ? (
            <BotQualifierSection
              state={state}
              onExclude={commands.excludeQualifier}
              onConfirm={commands.confirmQualifiers}
            />
          ) : hasQualifying(state.stage.format) && (
            <QualifierSection
              state={state}
              onChange={commands.setQualifier}
              onConfirm={commands.confirmQualifiers}
            />
          )}

          {/* ── 回戦ごとのマップ (勝ち上がりがある形式のみ) ── */}
          {hasBracket(state.stage.format) && state.stageMaps.length > 0 && (
            <section style={card}>
              <div style={sectionTitle}>回戦ごとのマップ</div>
              <p style={hint}>
                ここでの変更はこの大会の進行状態に保存され、次に「この試合を準備」したときから使われます。
                準備済みの試合が同じ回戦なら、その場で読み直します。
              </p>
              {hasBotStage(state.stage.format) && (
                <p style={hint}>
                  BOT対戦予選は<strong>全参加者が同じマップ</strong>で戦うのが前提です。
                  1試合でも実施したあとは変更できません。
                </p>
              )}
              {/* 予選リーグの節は「大会の設定」に従うだけなので出さない。BOT対戦予選だけは
                  予選のマップそのものが競技条件なので出す。回戦名はバックエンドが
                  組み立てた stageLabels を使う (UI 側で節数を数え直さない) */}
              {state.stageMaps.map((mapId, stage) => {
                if (stage < groupStageCount && !hasBotStage(state.stage.format)) return null;
                const label = state.stageLabels[stage] ?? `第${stage + 1}回戦`;
                return (
                  <div key={stage} style={assignRow}>
                    <span style={{ width: 88, flexShrink: 0 }}>{label}</span>
                    <select
                      style={{ ...select, flex: 1, minWidth: 0 }}
                      aria-label={`${label} のマップ`}
                      value={mapId ?? ''}
                      onChange={e => commands.setStageMap(stage, e.target.value || null)}
                    >
                      <option value="">
                        大会の設定に従う（{state.stage.map.catalogId ? '固定マップ' : '毎回ランダム生成'}）
                      </option>
                      {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                    </select>
                  </div>
                );
              })}
              {hasThirdPlaceMatch(state.stage) && (
                <p style={hint}>3位決定戦は決勝と同じ回戦なので、決勝と同じマップになります。</p>
              )}
            </section>
          )}

          {/* ── オートプレイ ── */}
          <section style={card}>
            <div style={sectionTitle}>オートプレイ</div>
            <p style={hint}>
              「この試合を準備」→「ゲームスタート」→「結果を確定」を自動で行い、大会を最後まで進めます。
              画面が切り替わるたびに数秒ずつ間を置くので、観客が対戦カードと結果を目で追えます。
              <strong>同点で勝者が決まらないときは止まります</strong> —
              再試合か審判裁定かは運営が決めるものなので、自動では決めません。
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                style={{ ...btnChoice, ...(state.autoPlay.enabled ? btnChoiceOn : null) }}
                onClick={() => commands.setAutoPlay(!state.autoPlay.enabled)}
              >
                {state.autoPlay.enabled ? '自動進行を止める' : '自動で進める ▶'}
              </button>
              <button
                style={{ ...btnChoice, ...(state.autoPlay.loop ? btnChoiceOn : null) }}
                onClick={() => commands.setAutoPlay(state.autoPlay.enabled, !state.autoPlay.loop)}
              >
                デモモード（繰り返す）
              </button>
            </div>
            {state.autoPlay.loop && (
              <p style={hint}>
                全試合が終わると表彰画面をしばらく出したあと、
                <strong>進行状態を消して同じ大会データを最初からやり直します</strong>。
                無人展示向けの設定なので、本番の運営では切ってください。
              </p>
            )}
            {state.autoPlay.stoppedReason && (
              <div style={warnRow}>⚠ 自動進行を止めました: {state.autoPlay.stoppedReason}</div>
            )}
          </section>

          {/* ── 次の一手 ── */}
          <section style={card}>
            <div style={sectionTitle}>対戦中の試合</div>

            {awaiting ? (
              <>
                <p style={hint}>対戦が終わりました。結果を確認して確定してください。</p>
                <MatchCard match={awaiting} participants={state.participants} format={state.stage.format} style={{ width: '100%' }} />
              </>
            ) : armed ? (
              <>
                <p style={hint}>
                  両者の割り当てが済みました。フッターの「ゲームスタート」で開始してください。
                </p>
                <MatchCard match={armed} participants={state.participants} format={state.stage.format} style={{ width: '100%' }} />
              </>
            ) : nextReady ? (
              <>
                {blockedByQualifiers(state, nextReady) ? (
                  <p style={hint}>
                    予選リーグが終わりました。上の「決勝進出者」で顔ぶれを確定すると、
                    決勝トーナメントの試合を準備できます。
                  </p>
                ) : (
                  <p style={hint}>次の試合です。「この試合を準備」でプログラムを自動割り当てします。</p>
                )}
                <MatchCard match={nextReady} participants={state.participants} format={state.stage.format} style={{ width: '100%' }} />
                <button
                  style={{ ...btnPrimaryWide, ...(blockedByQualifiers(state, nextReady) ? btnMuted : null) }}
                  disabled={blockedByQualifiers(state, nextReady)}
                  onClick={() => commands.arm(nextReady.id)}
                >
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

      {/* 大会データ作成 / 編集 */}
      {editing && (
        <TournamentEditorDialog
          httpBase={httpBase}
          editId={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); commands.rescan(); void refresh(); }}
        />
      )}

      {/* 結果確定ダイアログ */}
      {state && awaiting && (
        <ResultConfirmDialog
          match={awaiting}
          participants={state.participants}
          // 予選リーグの試合は引き分けをそのまま確定できる。1つの大会に予選と決勝が
          // 同居するので、形式ではなくその試合が予選かどうかで決める
          isLeague={awaiting.group !== undefined || state.stage.format === 'league'}
          httpBase={httpBase}
          // 回戦ごとのマップも「固定マップ運用」— リセットしても引き直されないので
          // 同点の再試合では別マップを選ばせる (バックエンドの discardResult と同じ判定)
          requireMapChangeOnRematch={
            (state.stageMaps[awaiting.stage] ?? state.stage.map.catalogId) !== null
          }
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

// 3択のトグル。選択中だけ塗る
const btnChoice: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
  fontSize: 11, padding: '6px 12px',
};

const btnChoiceOn: React.CSSProperties = {
  background: COOL_COLOR, borderColor: COOL_COLOR, color: '#fff',
};

const btnGhost: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 12, padding: '6px 12px',
};

const btnGhostSmall: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  border: `1px solid ${BORDER_COLOR}`, fontSize: 11, padding: '5px 10px', flexShrink: 0,
};

const btnMuted: React.CSSProperties = {
  color: TEXT_MUTED, cursor: 'not-allowed',
};

const errorBar: React.CSSProperties = {
  background: '#fff0f0', border: `1px solid ${HOT_COLOR}`, color: HOT_COLOR,
  borderRadius: RADIUS_SM, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
};

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: 8, padding: '6px 10px', fontSize: 11,
};
