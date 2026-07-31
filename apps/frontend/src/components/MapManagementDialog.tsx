import { useEffect, useState } from 'react';
import type { InlineMapData, MapCatalogEntry, Point } from '@u15/ws-types';
import { MapObject } from '@u15/ws-types';
import { FileDropZone } from './FileDropZone';
import { MapThumbnail } from './MapThumbnail';
import { useTextures } from '../hooks/useTextures';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  TURN_PALE,
  WIN_BASE, SHADOW_MD, RADIUS_MD, RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  httpBase:      string;
  roomId:        string;
  theme:         string;
  currentMap:    InlineMapData | null;
  /** 現在のマップを差し替えてよいか (バックエンドの RoundController.canEditMap 相当)。
   *  false のとき、適用系の操作はサーバー側で黙って無視されるため UI 側で塞ぐ。 */
  canApply:      boolean;
  onApplyEntry:  (entry: MapCatalogEntry) => void;
  onApplyInline: (data: InlineMapData) => void;
  onOpenEditor:  () => void;
  onClose:       () => void;
}

const SIZES = [
  { label: '決戦 (15×17)', x: 15, y: 17 },
  { label: '広域 (21×17)', x: 21, y: 17 },
] as const;

const GEN_PARAMS_KEY = 'u15_map_gen_params';

interface GenParams {
  sizeIdx:  number;
  blockNum: number;
  itemNum:  number;
  turnNum:  number;
  mirror:   boolean;
}

const DEFAULT_GEN_PARAMS: GenParams = { sizeIdx: 0, blockNum: 20, itemNum: 51, turnNum: 100, mirror: true };

function loadGenParams(): GenParams {
  try {
    const raw = localStorage.getItem(GEN_PARAMS_KEY);
    return raw ? { ...DEFAULT_GEN_PARAMS, ...JSON.parse(raw) } : DEFAULT_GEN_PARAMS;
  } catch {
    return DEFAULT_GEN_PARAMS;
  }
}

function countObj(field: number[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}

export function MapManagementDialog({
  httpBase, theme, currentMap, canApply,
  onApplyEntry, onApplyInline, onOpenEditor, onClose,
}: Props) {
  const [entries, setEntries] = useState<MapCatalogEntry[]>([]);
  const [query,   setQuery]   = useState('');
  const [gen,     setGen]     = useState<GenParams>(loadGenParams);
  const [generating, setGenerating] = useState(false);
  const tex = useTextures(theme);

  const fetchEntries = () => {
    fetch(`${httpBase}/api/maps`)
      .then(r => r.json())
      .then((d: { entries: MapCatalogEntry[] }) => {
        setEntries([...d.entries].sort((a, b) => b.uploadedAt - a.uploadedAt));
      })
      .catch(() => {});
  };

  useEffect(fetchEntries, [httpBase]);

  useEffect(() => {
    localStorage.setItem(GEN_PARAMS_KEY, JSON.stringify(gen));
  }, [gen]);

  const handleDelete = (id: string) => {
    fetch(`${httpBase}/api/maps/${id}`, { method: 'DELETE' })
      .then(() => fetchEntries())
      .catch(() => {});
  };

  const handleUploaded = () => fetchEntries();

  const handleGenerate = async () => {
    if (!canApply) return;
    setGenerating(true);
    try {
      const size: Point = { x: SIZES[gen.sizeIdx].x, y: SIZES[gen.sizeIdx].y };
      const res = await fetch(`${httpBase}/api/maps/random`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, blockNum: gen.blockNum, itemNum: gen.itemNum, turnNum: gen.turnNum, mirror: gen.mirror }),
      });
      if (res.ok) {
        const { data } = await res.json() as { data: InlineMapData };
        onApplyInline(data);
      }
    } finally {
      setGenerating(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter(e => e.displayName.toLowerCase().includes(q)) : entries;

  const currentBlocks = currentMap ? countObj(currentMap.field, MapObject.BLOCK) : 0;
  const currentItems  = currentMap ? countObj(currentMap.field, MapObject.ITEM)  : 0;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>マップ設定</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.content}>
          {!canApply && (
            <div style={s.lockNotice}>
              2試合制のセット中はマップを変更できません（両試合で同じマップを使うため）。
              ライブラリの整理・ダウンロードのみ行えます。
            </div>
          )}

          {/* 現在のマップ */}
          <section style={s.section}>
            <Label>現在のマップ</Label>
            <div style={s.currentRow}>
              {currentMap && (
                <MapThumbnail
                  field={currentMap.field as MapObject[][]}
                  size={currentMap.size}
                  teamFirstPoint={currentMap.teamFirstPoint}
                  textures={tex}
                  cellSize={8}
                />
              )}
              {currentMap ? (
                <div style={s.currentInfo}>
                  <span>{currentMap.size.x}×{currentMap.size.y}</span>
                  <span>ターン {currentMap.turn}</span>
                  <span>ブロック {currentBlocks}</span>
                  <span>アイテム {currentItems}</span>
                </div>
              ) : (
                <span style={s.hint}>読み込み中...</span>
              )}
            </div>
            {canApply && (
              <button style={s.btnSm} onClick={onOpenEditor}>エディタで編集...</button>
            )}
          </section>

          <Divider />

          {/* ライブラリ */}
          <section style={s.section}>
            <Label>マップライブラリ</Label>
            {entries.length > 0 && (
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="マップ名で検索"
                style={s.searchInput}
              />
            )}
            {entries.length === 0 && <span style={s.hint}>まだマップがアップロードされていません</span>}
            {entries.length > 0 && filtered.length === 0 && <span style={s.hint}>該当するマップがありません</span>}
            {filtered.length > 0 && (
              <div style={s.list}>
                {filtered.map(entry => (
                  <div key={entry.id} style={s.row}>
                    <div style={s.rowMain}>
                      <span style={s.name}>{entry.displayName}</span>
                      <span style={s.date}>
                        {entry.size.x}×{entry.size.y} ・ ターン{entry.turn} ・ {new Date(entry.uploadedAt).toLocaleString()}
                      </span>
                    </div>
                    <button
                      style={{ ...s.useBtn, ...(canApply ? {} : s.btnDisabled) }}
                      disabled={!canApply}
                      onClick={() => onApplyEntry(entry)}
                    >
                      使用
                    </button>
                    <a style={s.dlBtn} href={`${httpBase}/api/maps/${entry.id}/download`}>DL</a>
                    <button style={s.deleteBtn} onClick={() => handleDelete(entry.id)}>削除</button>
                  </div>
                ))}
              </div>
            )}

            <FileDropZone
              endpoint={`${httpBase}/api/maps`}
              accept={['.map']}
              label="新規マップをライブラリに追加"
              onUploaded={handleUploaded}
            />
          </section>

          <Divider />

          {/* ランダム生成 */}
          <section style={s.section}>
            <Label>ランダム生成</Label>
            <select
              value={gen.sizeIdx}
              onChange={e => setGen(g => ({ ...g, sizeIdx: Number(e.target.value) }))}
              style={s.select}
            >
              {SIZES.map((sz, i) => <option key={i} value={i}>{sz.label}</option>)}
            </select>
            <div style={s.genGrid}>
              <label style={s.genLabel}>ブロック数
                <input type="number" min={0} max={200} value={gen.blockNum}
                  onChange={e => setGen(g => ({ ...g, blockNum: Number(e.target.value) }))} style={s.numInput} />
              </label>
              <label style={s.genLabel}>アイテム数
                <input type="number" min={0} max={200} value={gen.itemNum}
                  onChange={e => setGen(g => ({ ...g, itemNum: Number(e.target.value) }))} style={s.numInput} />
              </label>
              <label style={s.genLabel}>ターン数
                <input type="number" min={10} max={500} step={10} value={gen.turnNum}
                  onChange={e => setGen(g => ({ ...g, turnNum: Number(e.target.value) }))} style={s.numInput} />
              </label>
            </div>
            <div style={s.checkRow}>
              <input type="checkbox" checked={gen.mirror} onChange={e => setGen(g => ({ ...g, mirror: e.target.checked }))} />
              <span style={s.checkLabel}>対称配置</span>
            </div>
            <button
              style={{ ...s.btnPrimary, ...(canApply ? {} : s.btnDisabled) }}
              onClick={handleGenerate}
              disabled={generating || !canApply}
            >
              {generating ? '生成中...' : '生成して使用'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>{children}</div>;
}
function Divider() {
  return <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_COLOR}`, margin: '4px 0' }} />;
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
    display: 'flex', flexDirection: 'column', maxHeight: '90vh', width: 420, overflow: 'hidden',
    color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: `1px solid ${BORDER_COLOR}`, flexShrink: 0,
  },
  title:    { fontSize: 14, fontWeight: 800 },
  closeBtn: { background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 16, cursor: 'pointer' },
  content:  { display: 'flex', flexDirection: 'column', gap: 4, padding: 16, overflow: 'auto', background: BG_ROOT },
  section:  { display: 'flex', flexDirection: 'column', gap: 6 },
  currentRow: { display: 'flex', alignItems: 'center', gap: 10 },
  currentInfo: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: TEXT_SECONDARY, fontFamily: FONT_NUM },
  hint: { fontSize: 10, color: TEXT_MUTED },
  select: {
    padding: '4px 8px', background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS_SM, color: TEXT_PRIMARY, fontSize: 11,
  },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '4px 8px',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    fontSize: 11, fontFamily: FONT_UI, color: TEXT_PRIMARY,
  },
  list:   { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflow: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 6px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 6,
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  name: {
    fontSize: 11, fontFamily: FONT_NUM, color: TEXT_PRIMARY,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  date: { fontSize: 9, color: TEXT_MUTED },
  useBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_PRIMARY, fontSize: 10, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  dlBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, textDecoration: 'none', flexShrink: 0,
  },
  deleteBtn: {
    padding: '2px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_MUTED, fontSize: 10, cursor: 'pointer', flexShrink: 0,
  },
  genGrid: { display: 'flex', flexDirection: 'column', gap: 4 },
  genLabel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: TEXT_SECONDARY },
  numInput: {
    width: 70, padding: '4px 8px', background: BG_CARD,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 12, fontFamily: FONT_NUM,
  },
  checkRow:  { display: 'flex', alignItems: 'center', gap: 6 },
  checkLabel: { fontSize: 11, color: TEXT_SECONDARY },
  btnSm: {
    padding: '6px 0', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 11, cursor: 'pointer',
  },
  btnPrimary: {
    padding: '8px 0', border: 'none', borderRadius: RADIUS_SM,
    background: WIN_BASE, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  lockNotice: {
    padding: '8px 10px', borderRadius: RADIUS_SM,
    background: TURN_PALE, border: `1px solid ${BORDER_COLOR}`,
    fontSize: 10, lineHeight: 1.6, color: TEXT_SECONDARY,
  },
};
