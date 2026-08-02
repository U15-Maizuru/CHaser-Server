import { useEffect, useState } from 'react';
import type { MapCatalogEntry, MapSourceInfo, MapSourceKind } from '@u15/ws-types';
import { MAP_SIZES, useMapGenParams } from '../hooks/useMapGenParams';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  WIN_BASE, RADIUS_SM,
  FONT_NUM, FONT_UI,
} from '../styles/tokens';

interface Props {
  httpBase: string;
  /** サーバーが覚えている選択状態。全コントロール窓で共有される */
  source:   MapSourceInfo;
  /** マップを差し替えてよいか (バックエンドの RoundController.canEditMap 相当)。
   *  false のとき適用系はサーバー側で黙って無視されるため UI 側で塞ぐ。 */
  canEdit:  boolean;
  onApplyEntry:         (entry: MapCatalogEntry) => void;
  onApplyParams:        () => void;
  onOpenEditor:         () => void;
  onSaveCurrent:        (displayName: string) => void;
  onDownloadCurrent:    (displayName: string) => void;
  onOpenLibraryManager: () => void;
}

const TAB_LABEL: Record<MapSourceKind, string> = {
  catalog: 'ライブラリ',
  random:  'ランダム',
  editor:  'エディタ',
};

export function sourceLabel(source: MapSourceInfo): string {
  if (source.kind === 'catalog') return source.displayName ?? 'ライブラリのマップ';
  if (source.kind === 'editor')  return 'エディタで作成';
  return 'ランダム生成';
}

/** 保存・ダウンロード名の既定値 (map-0801-2015 形式) */
function defaultMapName(): string {
  const d  = new Date();
  const p  = (n: number) => String(n).padStart(2, '0');
  return `map-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// 「対戦で使うマップの選択」専用。アップロード・削除はここでは行わず、
// ライブラリの管理は MapLibraryDialog (フッター「マップ管理」) に一本化する。
// プログラム側の ProgramLibrarySection と同じ役割。
export function MapSourceSection({
  httpBase, source, canEdit,
  onApplyEntry, onApplyParams, onOpenEditor,
  onSaveCurrent, onDownloadCurrent, onOpenLibraryManager,
}: Props) {
  const [open,    setOpen]    = useState(false);
  const [tab,     setTab]     = useState<MapSourceKind>(source.kind);
  const [query,   setQuery]   = useState('');
  const [entries, setEntries] = useState<MapCatalogEntry[]>([]);
  const [name,    setName]    = useState(defaultMapName);
  const { params: gen, update: setGen } = useMapGenParams();

  // 一覧はライブラリタブを開いたときだけ取りに行く (ProgramLibrarySection と同じ遅延取得)
  useEffect(() => {
    if (!open || tab !== 'catalog') return;
    fetch(`${httpBase}/api/maps`)
      .then(r => r.json())
      .then((d: { entries: MapCatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  }, [open, tab, httpBase]);

  const toggleOpen = () => {
    setOpen(o => {
      if (!o) setTab(source.kind); // 開くたびに現在のソースのタブから始める
      return !o;
    });
    setQuery('');
  };

  const handleUse = (entry: MapCatalogEntry) => {
    onApplyEntry(entry);
    setOpen(false);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;
  const trimmedName = name.trim();

  return (
    <div style={s.root}>
      <button
        style={{ ...s.trigger, ...(canEdit ? {} : s.disabled) }}
        disabled={!canEdit}
        onClick={toggleOpen}
      >
        <span style={s.triggerLabel}>{sourceLabel(source)}</span>
        {canEdit && <span style={s.triggerCaret}>{open ? '変更 ▲' : '変更 ▾'}</span>}
      </button>

      {open && canEdit && (
        <div style={s.panel}>
          <div style={s.tabs}>
            {(['catalog', 'random', 'editor'] as MapSourceKind[]).map(k => (
              <button
                key={k}
                style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }}
                onClick={() => setTab(k)}
              >
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>

          {/* ── アップロード済みのマップから選ぶ ── */}
          {tab === 'catalog' && (
            <>
              {entries.length === 0 && (
                <>
                  <span style={s.hint}>マップ管理からアップロードしてください</span>
                  <button style={s.btnSm} onClick={onOpenLibraryManager}>マップ管理を開く</button>
                </>
              )}
              {entries.length > 0 && (
                <>
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="マップ名で検索"
                    style={s.input}
                  />
                  {filtered.length === 0 && <span style={s.hint}>該当するマップがありません</span>}
                  {filtered.length > 0 && (
                    <div style={s.list}>
                      {filtered.map(entry => (
                        <div key={entry.id} style={s.row}>
                          <div style={s.rowMain}>
                            <span style={s.name}>{entry.displayName}</span>
                            <span style={s.meta}>
                              {entry.size.x}×{entry.size.y} ・ T{entry.turn} ・ B{entry.blockCount} ・ I{entry.itemCount}
                            </span>
                          </div>
                          <button style={s.useBtn} onClick={() => handleUse(entry)}>使用</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button style={s.link} onClick={onOpenLibraryManager}>マップ管理を開く</button>
                </>
              )}
            </>
          )}

          {/* ── パラメータからランダム生成 ── */}
          {tab === 'random' && (
            <>
              <select
                value={gen.sizeIdx}
                onChange={e => setGen({ sizeIdx: Number(e.target.value) })}
                style={s.input}
              >
                {MAP_SIZES.map((sz, i) => <option key={i} value={i}>{sz.label}</option>)}
              </select>
              <label style={s.genLabel}>ブロック数
                <input type="number" min={0} max={200} value={gen.blockNum}
                  onChange={e => setGen({ blockNum: Number(e.target.value) })} style={s.numInput} />
              </label>
              <label style={s.genLabel}>アイテム数
                <input type="number" min={0} max={200} value={gen.itemNum}
                  onChange={e => setGen({ itemNum: Number(e.target.value) })} style={s.numInput} />
              </label>
              <label style={s.genLabel}>ターン数
                <input type="number" min={10} max={500} step={10} value={gen.turnNum}
                  onChange={e => setGen({ turnNum: Number(e.target.value) })} style={s.numInput} />
              </label>
              <label style={s.checkRow}>
                <input type="checkbox" checked={gen.mirror} onChange={e => setGen({ mirror: e.target.checked })} />
                <span style={s.checkLabel}>対称配置</span>
              </label>
              <button style={s.btnPrimary} onClick={onApplyParams}>生成して使用</button>
              <span style={s.hint}>
                公式ルールのマップは 15×17・100〜240ターンです。
              </span>
              <span style={s.hint}>
                ランダム生成のマップは、リセット・リピートのたびにこの設定で引き直されます。
              </span>
            </>
          )}

          {/* ── マップエディタで作る ── */}
          {tab === 'editor' && (
            <>
              <button style={s.btnPrimary} onClick={onOpenEditor}>エディタで編集...</button>
              <span style={s.hint}>
                現在のマップを下敷きに編集します。適用したマップはリセット・リピートしても残ります。
              </span>
            </>
          )}

          {/* ── 現在のマップを残す (ライブラリのマップは既に保存済みなので出さない) ── */}
          {source.kind !== 'catalog' && (
            <>
              <hr style={s.divider} />
              <span style={s.sectionLabel}>今のマップを残す</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="マップ名"
                style={s.input}
              />
              <div style={s.btnRow}>
                <button
                  style={{ ...s.btnSm, flex: 1, ...(trimmedName ? {} : s.disabled) }}
                  disabled={!trimmedName}
                  onClick={() => onSaveCurrent(trimmedName)}
                >
                  ライブラリに保存
                </button>
                <button
                  style={{ ...s.btnSm, flex: 1, ...(trimmedName ? {} : s.disabled) }}
                  disabled={!trimmedName}
                  onClick={() => onDownloadCurrent(trimmedName)}
                >
                  ダウンロード
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:  { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
  hint:  { fontSize: 9, lineHeight: 1.5, color: TEXT_MUTED },
  trigger: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', boxSizing: 'border-box',
    padding: '5px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, cursor: 'pointer',
  },
  triggerLabel: {
    flex: 1, minWidth: 0, textAlign: 'left',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 11, fontWeight: 700, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  triggerCaret: { fontSize: 9, color: TEXT_SECONDARY, flexShrink: 0, marginLeft: 6 },
  panel: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
  tabs:  { display: 'flex', gap: 4 },
  tab: {
    flex: 1, padding: '4px 0', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, cursor: 'pointer',
  },
  tabActive: { border: `1px solid ${COOL_COLOR}`, background: COOL_PALE, color: COOL_COLOR, fontWeight: 700 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '4px 6px',
    background: BG_CARD, border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    fontSize: 11, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflow: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '3px 5px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    fontSize: 10, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  meta: { fontSize: 9, color: TEXT_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  useBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_PRIMARY, fontSize: 10, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  genLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 6, fontSize: 10, color: TEXT_SECONDARY,
  },
  numInput: {
    width: 64, padding: '3px 6px', background: BG_CARD,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 11, fontFamily: FONT_NUM,
  },
  checkRow:   { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  checkLabel: { fontSize: 10, color: TEXT_SECONDARY },
  btnRow: { display: 'flex', gap: 4 },
  btnSm: {
    padding: '5px 0', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, cursor: 'pointer',
  },
  btnPrimary: {
    padding: '6px 0', border: 'none', borderRadius: RADIUS_SM,
    background: WIN_BASE, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
  link: {
    alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none',
    color: TEXT_SECONDARY, fontSize: 9, textDecoration: 'underline', cursor: 'pointer',
  },
  sectionLabel: { fontSize: 9, color: TEXT_MUTED, letterSpacing: 1 },
  divider: { border: 'none', borderTop: `1px solid ${BORDER_COLOR}`, margin: '2px 0', width: '100%' },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
};
