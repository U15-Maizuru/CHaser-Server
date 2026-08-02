import { useEffect, useMemo, useState } from 'react';
import type {
  CatalogEntry, MapCatalogEntry, ParticipantDef, TournamentDefinition,
  TournamentFormat, TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import { autoSlots, fitSlots, matchCountOf, slotPairs } from '../../lib/bracketSlots';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI, GOLD_BASE, HOT_COLOR,
  RADIUS_MD, RADIUS_SM, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../styles/tokens';

// 大会データ (tournament.json) を画面で作る / 直すためのダイアログ。
//
// 保存先は既存の取り込み口と同じ POST /api/tournament/import。つまりこの画面は
// 「tournament.json をフォームで書くための道具」であって、独自の保存経路を持たない。
// 手で書いた JSON・zip で取り込んだ大会と、出来上がるものは完全に同じ。
//
// プログラムの割り当てだけは別扱い: プログラムライブラリの ID はこの PC でしか通じないため
// 配布物である tournament.json には書かず、POST /api/tournament/:id/assign で
// state.json 側へ保存する (内蔵CPU と同梱ファイルは移植できるので定義に残す)。

export interface TournamentEditorDialogProps {
  httpBase: string;
  /** 編集する大会 id。null なら新規作成 */
  editId:   string | null;
  onClose:  () => void;
  onSaved:  (id: string) => void;
}

/** 参加者1人ぶんの編集状態 */
interface DraftParticipant {
  /** React の key。id を書き換えても行が作り直されないように別に持つ */
  key:  string;
  id:   string;
  name: string;
  /** '' 未提出 / 'cpu' 内蔵CPU / 'file' 同梱ファイル / 'lib:<catalogId>' ライブラリ */
  program: string;
  /** program==='file' のときの元指定。編集で失わないよう保持する */
  file?: { file: string; displayName?: string };
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

/** 既定の大会 id (フォルダ名になるので ASCII のみ) */
function defaultId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `cup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
       + `-${p(now.getHours())}${p(now.getMinutes())}`;
}

function nextParticipantId(taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    if (!taken.has(id)) return id;
  }
}

function newParticipant(taken: Set<string>, name: string): DraftParticipant {
  const id = nextParticipantId(taken);
  return { key: `${id}-${Math.random().toString(36).slice(2, 8)}`, id, name, program: '' };
}

export function TournamentEditorDialog({
  httpBase, editId, onClose, onSaved,
}: TournamentEditorDialogProps) {
  const [id, setId]         = useState(editId ?? defaultId());
  const [name, setName]     = useState('');
  const [format, setFormat] = useState<TournamentFormat>('single-elimination');

  const [doubleMode, setDoubleMode]             = useState(true);
  const [thirdPlaceMatch, setThirdPlaceMatch]   = useState(false);
  const [doubleRoundRobin, setDoubleRoundRobin] = useState(false);
  const [mapCatalogId, setMapCatalogId]         = useState('');
  const [leaguePoints, setLeaguePoints]         = useState({ win: 3, draw: 1, loss: 0 });

  const [participants, setParticipants] = useState<DraftParticipant[]>([]);
  const [manualBracket, setManualBracket] = useState(false);
  const [slots, setSlots] = useState<(string | null)[]>([]);

  const [programs, setPrograms] = useState<CatalogEntry[]>([]);
  const [maps, setMaps]         = useState<MapCatalogEntry[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);

  const [bulk, setBulk]       = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(editId !== null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── 読み込み ──
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
        setExistingIds((body.imported ?? []).map(s => s.id));
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
        applyDefinition(body.definition, body.state ?? null);
      } catch (e) {
        setError(`大会データを読み込めませんでした: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [httpBase, editId]);

  function applyDefinition(def: TournamentDefinition, state: TournamentStatePayload | null) {
    setId(def.id);
    setName(def.name);
    setFormat(def.format);
    setDoubleMode(def.rules.doubleMode);
    setThirdPlaceMatch(def.rules.thirdPlaceMatch);
    setDoubleRoundRobin(def.rules.doubleRoundRobin);
    setMapCatalogId(def.rules.mapCatalogId ?? '');
    setLeaguePoints(def.rules.leaguePoints);

    // 表示順 = 選手番号順 (小さいほど第1ゲームで先攻)。seed 未指定は記載順で後ろへ
    const ordered = [...def.participants]
      .map((p, i) => ({ p, i }))
      .sort((a, b) =>
        (a.p.seed ?? Number.POSITIVE_INFINITY) - (b.p.seed ?? Number.POSITIVE_INFINITY) || a.i - b.i)
      .map(x => x.p);

    const assigned = new Map(
      (state?.participants ?? []).map(p => [p.id, p.programCatalogId] as const),
    );

    setParticipants(ordered.map((p): DraftParticipant => {
      const base = { key: p.id, id: p.id, name: p.name };
      if (p.program?.kind === 'builtin') return { ...base, program: 'cpu' };
      if (p.program?.kind === 'file') {
        const file = p.program.displayName === undefined
          ? { file: p.program.file }
          : { file: p.program.file, displayName: p.program.displayName };
        return { ...base, program: 'file', file };
      }
      const catalogId = assigned.get(p.id);
      return { ...base, program: catalogId ? `lib:${catalogId}` : '' };
    }));

    if (def.format === 'single-elimination' && def.bracket?.slots?.length) {
      setManualBracket(true);
      setSlots(fitSlots(def.bracket.slots, ordered.map(p => p.id)));
    }
  }

  // ── 参加者の編集 ──
  const ids = useMemo(() => participants.map(p => p.id), [participants]);

  /** 参加者を差し替え、手動組み合わせなら配置も追従させる */
  const updateParticipants = (next: DraftParticipant[]) => {
    setParticipants(next);
    if (manualBracket) setSlots(prev => fitSlots(prev, next.map(p => p.id)));
  };

  const addParticipant = () => {
    updateParticipants([...participants, newParticipant(new Set(ids), '')]);
  };

  const addBulk = () => {
    const names = bulk.split('\n').map(s => s.trim()).filter(s => s !== '');
    if (names.length === 0) return;
    const taken = new Set(ids);
    const added = names.map(n => {
      const p = newParticipant(taken, n);
      taken.add(p.id);
      return p;
    });
    updateParticipants([...participants, ...added]);
    setBulk('');
    setShowBulk(false);
  };

  const removeAt = (i: number) => {
    updateParticipants(participants.filter((_, j) => j !== i));
  };

  const moveAt = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= participants.length) return;
    const next = [...participants];
    [next[i], next[j]] = [next[j]!, next[i]!];
    updateParticipants(next);
  };

  const patchAt = (i: number, patch: Partial<DraftParticipant>) => {
    updateParticipants(participants.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  const toggleManualBracket = (on: boolean) => {
    setManualBracket(on);
    setSlots(on ? autoSlots(ids) : []);
  };

  const setSlotAt = (i: number, value: string | null) => {
    setSlots(prev => {
      const next = [...prev];
      // 同じ参加者が2箇所に入らないよう、元いた枠を空ける
      if (value !== null) {
        const dup = next.indexOf(value);
        if (dup >= 0 && dup !== i) next[dup] = null;
      }
      next[i] = value;
      return next;
    });
  };

  // ── 検証 ──
  const validation = useMemo((): string | null => {
    if (name.trim() === '') return '大会名を入力してください';
    if (!ID_RE.test(id)) return '大会ID は半角英数字と . _ - だけで入力してください（フォルダ名になります）';
    if (editId === null && existingIds.includes(id)) {
      return `大会ID "${id}" は既に使われています。別のIDにしてください`;
    }
    if (participants.length < 2) return '参加者を2人以上登録してください';

    const names = new Set<string>();
    for (const p of participants) {
      if (p.name.trim() === '') return '名前が空の参加者がいます';
      if (names.has(p.name.trim())) return `参加者名 "${p.name.trim()}" が重複しています`;
      names.add(p.name.trim());
    }

    if (format === 'single-elimination' && manualBracket) {
      const placed = slots.filter((s): s is string => s !== null);
      if (new Set(placed).size !== participants.length) {
        return '組み合わせに未配置または重複した参加者がいます';
      }
    }
    return null;
  }, [name, id, editId, existingIds, participants, format, manualBracket, slots]);

  const preview = matchCountOf(format, participants.length, { thirdPlaceMatch, doubleRoundRobin });

  // ── 保存 ──
  const buildDefinition = (): TournamentDefinition => {
    const defs: ParticipantDef[] = participants.map((p, i) => ({
      id:      p.id,
      name:    p.name.trim(),
      seed:    i + 1,
      program: p.program === 'cpu'
        ? { kind: 'builtin', builtin: 'cpu' }
        : p.program === 'file' && p.file
          ? { kind: 'file', ...p.file }
          : null,
    }));

    const def: TournamentDefinition = {
      formatVersion: 1,
      id,
      name:   name.trim(),
      format,
      rules: {
        doubleMode,
        mapCatalogId: mapCatalogId === '' ? null : mapCatalogId,
        thirdPlaceMatch,
        leaguePoints,
        doubleRoundRobin,
      },
      participants: defs,
    };

    if (format === 'single-elimination' && manualBracket) {
      def.bracket = { size: slots.length, slots };
    }
    return def;
  };

  const save = async () => {
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      // 上書き保存のときは進行状態も作り直す (形式やルールだけ変えた場合を取りこぼさないため)
      const overwrite = editId !== null || existingIds.includes(id);
      const res  = await fetch(`${httpBase}/api/tournament/import${overwrite ? '?reset=1' : ''}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildDefinition()),
      });
      const body = await res.json() as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? '保存に失敗しました');
        return;
      }

      // ライブラリのプログラム割り当て。内蔵CPU・同梱ファイルは定義側で決まるので触らない
      const assignments: Record<string, string | null> = {};
      for (const p of participants) {
        if (p.program === 'cpu' || p.program === 'file') continue;
        assignments[p.id] = p.program.startsWith('lib:') ? p.program.slice(4) : null;
      }
      if (Object.keys(assignments).length > 0) {
        const ares = await fetch(`${httpBase}/api/tournament/${encodeURIComponent(body.id)}/assign`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ assignments }),
        });
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

  const nameOf = (pid: string | null) =>
    (pid === null ? '— bye —' : participants.find(p => p.id === pid)?.name || '(名前未入力)');

  return (
    <div style={overlay}>
      <div style={dialog} data-testid="tournament-editor">
        <div style={head}>
          <h2 style={titleStyle}>{editId === null ? '大会データを作る' : '大会データを編集'}</h2>
          <button style={btnGhost} onClick={onClose}>閉じる</button>
        </div>

        {loading ? (
          <div style={empty}>読み込み中…</div>
        ) : (
          <>
            {error && <div style={errorBar} data-testid="editor-error">⚠ {error}</div>}

            {/* ── 基本 ── */}
            <section style={card}>
              <div style={sectionTitle}>大会</div>
              <label style={field}>
                <span style={label}>大会名</span>
                <input
                  style={input} value={name} placeholder="第N回 U15プログラミング大会 舞鶴"
                  aria-label="大会名"
                  onChange={e => setName(e.target.value)}
                />
              </label>
              <label style={field}>
                <span style={label}>大会ID</span>
                <input
                  style={{ ...input, fontFamily: 'monospace' }} value={id} aria-label="大会ID"
                  disabled={editId !== null}
                  onChange={e => setId(e.target.value)}
                />
              </label>
              <p style={hint}>
                大会ID は server/tournament/ の下に作られるフォルダ名です。
                {editId !== null && ' 編集では変更できません。'}
              </p>

              <div style={chips}>
                {(['single-elimination', 'league'] as TournamentFormat[]).map(f => (
                  <button
                    key={f}
                    style={{ ...chip, ...(format === f ? chipOn : null) }}
                    onClick={() => setFormat(f)}
                  >
                    {f === 'league' ? 'リーグ (総当たり)' : 'トーナメント (勝ち上がり)'}
                  </button>
                ))}
              </div>
            </section>

            {/* ── ルール ── */}
            <section style={card}>
              <div style={sectionTitle}>ルール</div>

              <label style={check}>
                <input type="checkbox" checked={doubleMode}
                       onChange={e => setDoubleMode(e.target.checked)} />
                <span>2ゲーム制（先攻・後攻を入れ替えて2ゲームで1試合）</span>
              </label>
              <p style={hint}>公式ルールの試合形式です。外すと1ゲームで決着します（練習用）。</p>

              {format === 'single-elimination' ? (
                <label style={check}>
                  <input type="checkbox" checked={thirdPlaceMatch}
                         onChange={e => setThirdPlaceMatch(e.target.checked)} />
                  <span>3位決定戦を行う</span>
                </label>
              ) : (
                <>
                  <label style={check}>
                    <input type="checkbox" checked={doubleRoundRobin}
                           onChange={e => setDoubleRoundRobin(e.target.checked)} />
                    <span>2回総当たりにする</span>
                  </label>
                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>勝ち点</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                      {(['win', 'draw', 'loss'] as const).map(k => (
                        <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {k === 'win' ? '勝' : k === 'draw' ? '分' : '敗'}
                          <input
                            type="number" style={{ ...input, width: 56 }} aria-label={`勝ち点 ${k}`}
                            value={leaguePoints[k]}
                            onChange={e => setLeaguePoints(p => ({
                              ...p, [k]: Number(e.target.value) || 0,
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <label style={field}>
                <span style={label}>固定マップ</span>
                <select style={select} value={mapCatalogId} aria-label="固定マップ"
                        onChange={e => setMapCatalogId(e.target.value)}>
                  <option value="">毎回ランダム生成</option>
                  {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                </select>
              </label>
              <p style={hint}>
                固定マップにすると全試合が同じマップになります。同点で再試合になったときは
                運営が別のマップを選び直す必要があります。
              </p>
            </section>

            {/* ── 参加者 ── */}
            <section style={card}>
              <div style={sectionHead}>
                <span style={sectionTitle}>参加者 ({participants.length}人)</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={btnSmall} onClick={addParticipant}>+ 1人追加</button>
                  <button style={btnSmall} onClick={() => setShowBulk(v => !v)}>まとめて追加</button>
                </div>
              </div>
              <p style={hint}>
                上から順が選手番号です。番号の小さい方が第1ゲームで先攻になります。
              </p>

              {showBulk && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    style={{ ...input, minHeight: 72, resize: 'vertical' }} value={bulk}
                    aria-label="参加者をまとめて追加"
                    placeholder={'1行に1チーム\n舞鶴A\n舞鶴B'}
                    onChange={e => setBulk(e.target.value)}
                  />
                  <button style={btnSmall} onClick={addBulk}>この内容で追加</button>
                </div>
              )}

              {participants.length === 0 && <div style={empty}>参加者がまだいません</div>}

              {participants.map((p, i) => (
                <div key={p.key} style={row} data-testid="participant-row">
                  <span style={seedNo}>{i + 1}</span>
                  <input
                    style={{ ...input, flex: 1, minWidth: 0 }} value={p.name}
                    aria-label={`参加者${i + 1} の名前`} placeholder="チーム名"
                    onChange={e => patchAt(i, { name: e.target.value })}
                  />
                  <select
                    style={{ ...select, width: 190 }} value={p.program}
                    aria-label={`参加者${i + 1} のプログラム`}
                    onChange={e => patchAt(i, { program: e.target.value })}
                  >
                    <option value="">未提出（当日割り当て）</option>
                    <option value="cpu">内蔵CPU</option>
                    {p.file && <option value="file">同梱: {p.file.file}</option>}
                    {programs.map(pr => (
                      <option key={pr.id} value={`lib:${pr.id}`}>{pr.displayName}</option>
                    ))}
                  </select>
                  <button style={btnIcon} aria-label={`参加者${i + 1} を上へ`}
                          disabled={i === 0} onClick={() => moveAt(i, -1)}>↑</button>
                  <button style={btnIcon} aria-label={`参加者${i + 1} を下へ`}
                          disabled={i === participants.length - 1} onClick={() => moveAt(i, 1)}>↓</button>
                  <button style={{ ...btnIcon, color: HOT_COLOR }}
                          aria-label={`参加者${i + 1} を削除`} onClick={() => removeAt(i)}>✕</button>
                </div>
              ))}
            </section>

            {/* ── 組み合わせ (トーナメントのみ) ── */}
            {format === 'single-elimination' && (
              <section style={card}>
                <div style={sectionHead}>
                  <span style={sectionTitle}>組み合わせ</span>
                  <label style={{ ...check, fontSize: 11 }}>
                    <input type="checkbox" checked={manualBracket}
                           aria-label="組み合わせを手動で指定する"
                           onChange={e => toggleManualBracket(e.target.checked)} />
                    <span>手動で指定する</span>
                  </label>
                </div>

                {!manualBracket ? (
                  <p style={hint}>
                    参加者の並び順から標準シード配置で自動生成します
                    （第1シードと第2シードが決勝まで当たらない配置）。
                    実行委員会が決めた組み合わせがある場合は「手動で指定する」を使ってください。
                  </p>
                ) : (
                  <>
                    <p style={hint}>1回戦の対戦カードです。空きは bye（不戦勝）になります。</p>
                    {slotPairs(slots).map(([a, b], i) => (
                      <div key={i} style={pairRow}>
                        <span style={pairNo}>第{i + 1}試合</span>
                        {[a, b].map((v, k) => (
                          <select
                            key={k} style={{ ...select, flex: 1, minWidth: 0 }} value={v ?? ''}
                            aria-label={`1回戦 第${i + 1}試合 の${k === 0 ? '先攻' : '後攻'}`}
                            onChange={e => setSlotAt(i * 2 + k, e.target.value || null)}
                          >
                            <option value="">— bye —</option>
                            {participants.map(p => (
                              <option key={p.id} value={p.id}>{p.name || '(名前未入力)'}</option>
                            ))}
                          </select>
                        ))}
                      </div>
                    ))}
                    <div style={hint}>
                      {slotPairs(slots)
                        .filter(([a, b]) => a === null || b === null)
                        .map(([a, b], i) => (
                          <div key={i}>
                            {nameOf(a === null ? b : a)} は不戦勝で次の回戦へ進みます
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ── 保存 ── */}
            <div style={footer}>
              <span style={previewText} data-testid="editor-preview">
                {format === 'league' ? 'リーグ' : 'トーナメント'} ・ {participants.length}人 ・
                全 {preview} 試合{doubleMode ? '（各2ゲーム）' : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnGhost} onClick={onClose}>キャンセル</button>
                <button
                  style={{ ...btnPrimary, ...(validation || saving ? btnDisabled : null) }}
                  disabled={validation !== null || saving}
                  title={validation ?? ''}
                  onClick={() => void save()}
                >
                  {saving ? '保存中…' : editId === null ? 'この内容で作成' : '上書き保存'}
                </button>
              </div>
            </div>
            {validation && <div style={warnRow} data-testid="editor-validation">⚠ {validation}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
  padding: 16,
};

const dialog: React.CSSProperties = {
  background: BG_ROOT, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
  padding: 20, width: 'min(680px, 100%)', maxHeight: '92vh', overflowY: 'auto',
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
  display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box',
};

const head: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };

const card: React.CSSProperties = {
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_MD, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
};

const sectionHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
};

const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700 };

const field: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center' };

const label: React.CSSProperties = {
  fontSize: 12, color: TEXT_SECONDARY, width: 72, flexShrink: 0,
};

const hint: React.CSSProperties = {
  margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6, overflowWrap: 'anywhere',
};

const empty: React.CSSProperties = {
  padding: 14, textAlign: 'center', color: TEXT_MUTED, fontSize: 12,
};

const input: React.CSSProperties = {
  fontSize: 12, padding: '7px 9px', borderRadius: 8, flex: 1, minWidth: 0,
  border: `1px solid ${BORDER_COLOR}`, fontFamily: FONT_UI, background: BG_CARD,
  color: TEXT_PRIMARY, boxSizing: 'border-box',
};

const select: React.CSSProperties = {
  fontSize: 12, padding: '6px 8px', borderRadius: 8, flexShrink: 0,
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, fontFamily: FONT_UI,
  color: TEXT_PRIMARY,
};

const check: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer',
};

const chips: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 4 };

const chip: React.CSSProperties = {
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, color: TEXT_SECONDARY,
  borderRadius: 999, fontFamily: FONT_UI, fontWeight: 700, fontSize: 11,
  padding: '6px 14px', cursor: 'pointer',
};

const chipOn: React.CSSProperties = {
  background: COOL_COLOR, color: '#fff', borderColor: COOL_COLOR,
};

const row: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', minWidth: 0,
};

const seedNo: React.CSSProperties = {
  width: 20, flexShrink: 0, textAlign: 'right', fontSize: 11, color: TEXT_MUTED,
};

const pairRow: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', minWidth: 0,
};

const pairNo: React.CSSProperties = {
  width: 60, flexShrink: 0, fontSize: 11, color: TEXT_SECONDARY,
};

const footer: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  flexWrap: 'wrap',
};

const previewText: React.CSSProperties = { fontSize: 12, color: TEXT_SECONDARY };

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: 999, cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, color: '#fff',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase, background: WIN_BASE, fontSize: 13, padding: '9px 18px',
};

const btnDisabled: React.CSSProperties = {
  background: TEXT_MUTED, cursor: 'not-allowed',
};

const btnSmall: React.CSSProperties = {
  ...btnBase, background: COOL_COLOR, fontSize: 11, padding: '5px 12px',
};

const btnGhost: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 12, padding: '6px 12px',
};

const btnIcon: React.CSSProperties = {
  border: 'none', background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 13, padding: '4px 6px', cursor: 'pointer', flexShrink: 0,
};

const errorBar: React.CSSProperties = {
  background: '#fff0f0', border: `1px solid ${HOT_COLOR}`, color: HOT_COLOR,
  borderRadius: RADIUS_SM, padding: '8px 12px', fontSize: 12,
};

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: 8, padding: '6px 10px', fontSize: 11,
};
