import { useCallback, useEffect, useRef, useState } from 'react';
import { MapObject } from '@u15/ws-types';
import type { InlineMapData, Point } from '@u15/ws-types';
import { useTextures } from '../hooks/useTextures';
import { MAP_SIZES, useMapGenParams } from '../hooks/useMapGenParams';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE,
  TEXT_SECONDARY, TEXT_MUTED, WIN_BASE, RADIUS_SM,
  Button, Checkbox, Dialog, NumberInput, Select, TextInput,
} from '../ui';
import { generateRandomMap } from '../lib/api';
import {
  BOARD_COLOR, countObj, drawBlockFallback, drawFloorFallback, drawItemFallback,
  drawPlayerFallback, drawStaticBoard, drawTexture, EDITOR_GRID_COLOR,
} from '../lib/boardDraw';
import type { Textures } from '../lib/boardDraw';
import { alertDialog, confirmDiscardEdits } from '../lib/nativeDialog';

export interface EditableMap {
  field: MapObject[][];
  size: Point;
  turn: number;
  teamFirstPoint: [Point, Point];
}

export const defaultEditableMap: EditableMap = {
  field: Array.from({ length: 17 }, () => Array(15).fill(MapObject.NOTHING)),
  size:  { x: 15, y: 17 },
  turn:  100,
  teamFirstPoint: [{ x: 1, y: 8 }, { x: 13, y: 8 }],
};

/** EditableMap / InlineMapData の相互変換 (余分なフィールドを落として送る) */
export function toInlineMapData(map: EditableMap): InlineMapData {
  return { field: map.field, size: map.size, turn: map.turn, teamFirstPoint: map.teamFirstPoint };
}

interface PanelProps {
  initialMap:      EditableMap;
  /** 既存マップを編集するときの元の名前。省略時 (新規作成) は空欄から始める */
  initialName?:    string;
  theme:           string;
  httpBase:        string;
  /** 省略時は「適用して閉じる」を出さない (対戦設定と無関係にマップ管理から開いたとき) */
  onApply?:        (map: EditableMap) => void;
  /** 成功なら null、失敗なら画面に出すエラーメッセージを返すこと (lib/api.ts の uploadFile と同じ形) */
  onSaveToLibrary: (map: EditableMap, displayName: string) => Promise<string | null>;
  onDownload:      (map: EditableMap, displayName: string) => Promise<string | null>;
  /** 常に無条件で閉じる (確認は Panel 自身が持つ dirty で行う)。呼び出し元で二重に確認しないこと */
  onClose:         () => void;
  onDirtyChange?:  (dirty: boolean) => void;
  /**
   * true: マップ名/保存/DL/閉じるを上部のツールバーに出す (独立ウィンドウ用)。
   * 省略時: サイドパネル下部に出す (モーダル用)。
   */
  topBar?: boolean;
}

type Tool = 'nothing' | 'block' | 'item' | 'startCool' | 'startHot';

const CELL = 28;

function emptyField(x: number, y: number): MapObject[][] {
  return Array.from({ length: y }, () => Array(x).fill(MapObject.NOTHING));
}

function mirrorPoint(p: Point, size: Point): Point {
  const cx = Math.floor(size.x / 2);
  const cy = Math.floor(size.y / 2);
  return { x: cx * 2 - p.x, y: cy * 2 - p.y };
}

/**
 * マップエディタの中身 (盤面・ツールバー・生成パラメータ)。
 *
 * 対戦設定のモーダル (`MapEditorDialog`) とマップ管理の独立ウィンドウ (`MapEditorMode`)
 * の両方から使う。room・対戦設定への依存は一切持たず、`onApply` の有無だけで
 * 「対戦に適用できるか」を切り替える。
 */
export function MapEditorPanel({
  initialMap, initialName, theme, httpBase, onApply, onSaveToLibrary, onDownload, onClose, onDirtyChange,
  topBar = false,
}: PanelProps) {
  const [map,      setMap]      = useState<EditableMap>(() => ({
    ...initialMap,
    field: initialMap.field.map(r => [...r]),
    teamFirstPoint: [{ ...initialMap.teamFirstPoint[0] }, { ...initialMap.teamFirstPoint[1] }],
  }));
  const [tool,     setTool]     = useState<Tool>('nothing');
  const [symmetry, setSymmetry] = useState(true);
  const [name,     setName]     = useState(initialName ?? '');
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  // ダウンロードは保存先ダイアログ自体がフィードバックになるので、ここで出すのは
  // ライブラリ保存だけでよい (「ダウンロードしました」は横幅にも入り切らなかった)
  const [saved, setSaved] = useState(false);
  const dragging = useRef(false);
  // 生成パラメータはマップ列の「ランダム生成」と同じものを使う (設定の二重管理を避ける)
  const { params: gen, update: setGen } = useMapGenParams();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tex = useTextures(theme);

  const W = map.size.x * CELL;
  const H = map.size.y * CELL;

  const setDirty = (v: boolean) => { setDirtyState(v); onDirtyChange?.(v); };

  // ライブラリ保存の成功をボタン脇に一瞬だけ出す。「押しても何も起きたか分からない」を防ぐため
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // ── Draw ────────────────────────────────────────────────────────────────────
  // 編集中は反転しない (エディタは常に COOL 視点)。マスの当たりを見せるためグリッドを引く。
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawStaticBoard(ctx, {
      field: map.field, size: map.size, teamFirstPoint: map.teamFirstPoint,
      textures: tex, cell: CELL, gridColor: EDITOR_GRID_COLOR,
    });
  }, [map, tex, W, H]);

  useEffect(() => { draw(); }, [draw]);

  // ── Edit ────────────────────────────────────────────────────────────────────
  const applyTool = (px: number, py: number) => {
    const col = Math.floor(px / CELL);
    const row = Math.floor(py / CELL);
    if (col < 0 || col >= map.size.x || row < 0 || row >= map.size.y) return;

    setDirty(true);
    setMap(prev => {
      const next = {
        ...prev,
        field: prev.field.map(r => [...r]),
        teamFirstPoint: [{ ...prev.teamFirstPoint[0] }, { ...prev.teamFirstPoint[1] }] as [Point, Point],
      };
      if (tool === 'startCool' || tool === 'startHot') {
        const idx = tool === 'startCool' ? 0 : 1;
        next.teamFirstPoint[idx] = { x: col, y: row };
        if (symmetry) {
          next.teamFirstPoint[1 - idx] = mirrorPoint({ x: col, y: row }, next.size);
        }
      } else {
        const obj =
          tool === 'block'   ? MapObject.BLOCK :
          tool === 'item'    ? MapObject.ITEM  :
          MapObject.NOTHING;
        next.field[row][col] = obj;
        if (symmetry) {
          const mp = mirrorPoint({ x: col, y: row }, next.size);
          if (mp.x >= 0 && mp.x < next.size.x && mp.y >= 0 && mp.y < next.size.y) {
            next.field[mp.y][mp.x] = obj;
          }
        }
      }
      return next;
    });
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    const rect = canvasRef.current!.getBoundingClientRect();
    applyTool(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    applyTool(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onMouseUp = () => { dragging.current = false; };

  // ── Random generate ──────────────────────────────────────────────────────
  // 実際の生成アルゴリズムはバックエンド (GameSystem.createRandomMap) 側の一箇所のみに存在させ、
  // フロントエンドはここで再実装しない (挙動の重複・drift を防ぐため)。
  const handleRandom = async () => {
    const sz = MAP_SIZES[gen.sizeIdx] ?? MAP_SIZES[0];
    const size: Point = { x: sz.x, y: sz.y };
    setGenerating(true);
    try {
      const data = await generateRandomMap(httpBase, {
        size, blockNum: gen.blockNum, itemNum: gen.itemNum, turnNum: map.turn, mirror: symmetry,
      });
      if (data) {
        setDirty(true);
        setMap({
          field: data.field as MapObject[][], size: data.size,
          turn: data.turn, teamFirstPoint: data.teamFirstPoint,
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    setDirty(true);
    setMap(prev => ({ ...prev, field: emptyField(prev.size.x, prev.size.y) }));
  };

  // ── Save / Close ──────────────────────────────────────────────────────────
  const handleApply = () => {
    // 適用は「破棄」ではないので dirty の確認はしない
    onApply?.(map);
    onClose();
  };
  const handleCloseClick = () => {
    if (!confirmDiscardEdits(dirty)) return;
    setDirty(false); // window.close() が beforeunload をもう一度発火させても再確認させない
    onClose();
  };
  // Electron は window.prompt を実装していないため、名前はダイアログ内の入力欄で受け取る
  const trimmedName = name.trim();
  const handleSaveToLibrary = async () => {
    if (!trimmedName) return;
    const error = await onSaveToLibrary(map, trimmedName);
    if (error) { alertDialog(error); return; }
    setDirty(false); // ライブラリに保存した時点で「編集内容が消える」リスクは無くなる
    setSaved(true);
  };
  const handleDownload = async () => {
    if (!trimmedName) return;
    const error = await onDownload(map, trimmedName);
    if (error) alertDialog(error);
    // 成功時は保存先ダイアログ自体がフィードバックになるので、ここでは何も出さない
  };

  const blocks = countObj(map.field, MapObject.BLOCK);
  const items  = countObj(map.field, MapObject.ITEM);

  const nameField = (
    <>
      <TextInput
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="保存・DL 用の名前"
        style={topBar ? s.topBarInput : undefined}
      />
      <Button size="sm" disabled={!trimmedName} onClick={handleSaveToLibrary} noShrink={topBar}>
        ライブラリに保存
      </Button>
      <Button size="sm" disabled={!trimmedName} onClick={handleDownload} noShrink={topBar}>
        ダウンロード
      </Button>
      {saved && <span style={s.saveStatus}>✓ 保存しました</span>}
    </>
  );

  const rail = (
    <div style={s.rail}>
      {(['nothing', 'block', 'item', 'startCool', 'startHot'] as Tool[]).map(t => (
        <RailToolBtn key={t} active={tool === t} title={TOOL_LABELS[t]} onClick={() => setTool(t)}>
          <RailIcon tex={tex} tool={t} />
        </RailToolBtn>
      ))}
      <hr style={s.railSep} />
      <label style={s.railSym} title="対称配置">
        <Checkbox checked={symmetry} onChange={e => setSymmetry(e.target.checked)} />
        対称
      </label>
    </div>
  );

  const canvasArea = (
    <div style={s.canvasWrap}>
      <canvas
        ref={canvasRef}
        width={W} height={H}
        style={s.canvas}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );

  const sidePanel = (
    <div style={s.side}>
      <Label>フィールドサイズ</Label>
      <Select value={gen.sizeIdx} onChange={e => setGen({ sizeIdx: Number(e.target.value) })}>
        {MAP_SIZES.map((sz, i) => <option key={i} value={i}>{sz.label}</option>)}
      </Select>
      <Button size="sm" onClick={handleRandom} disabled={generating}>
        {generating ? '生成中...' : 'ランダム生成'}
      </Button>
      <span style={s.hint}>サイズはランダム生成でのみ反映されます</span>

      <Divider />

      <Label>ターン数</Label>
      <NumberInput
        min={10} max={500} step={10}
        value={map.turn}
        onChange={e => { setDirty(true); setMap(prev => ({ ...prev, turn: Number(e.target.value) })); }}
      />

      <Divider />

      <Label>オブジェクト数</Label>
      <div style={s.countRow}><span style={s.countLabel}>ブロック</span><span>{blocks}</span></div>
      <div style={s.countRow}><span style={s.countLabel}>アイテム</span><span>{items}</span></div>

      <Divider />

      <Button size="sm" onClick={handleClear}>全消し</Button>

      {!topBar && (
        <>
          <Divider />
          {/* ランダム生成・編集したマップを残す手段。名前が無いと保存先が決まらない */}
          <Label>マップ名</Label>
          {nameField}

          {onApply && (
            <>
              <Divider />
              <Button variant="primary" size="md" onClick={handleApply}>適用して閉じる</Button>
            </>
          )}
          <Button size="sm" onClick={handleCloseClick}>{onApply ? 'キャンセル' : '閉じる'}</Button>
        </>
      )}
    </div>
  );

  if (topBar) {
    return (
      <div style={s.page}>
        <div style={s.topBar}>
          <span style={s.brand}>マップエディタ</span>
          {nameField}
          <Button size="sm" variant="ghost" onClick={handleCloseClick} style={s.topBarClose}>閉じる</Button>
        </div>
        <div style={s.caption}>編集内容は自動保存されません。閉じる前に「ライブラリに保存」してください。</div>
        <div style={s.body}>
          {rail}
          {canvasArea}
          {sidePanel}
        </div>
      </div>
    );
  }

  return (
    <div style={s.body}>
      {rail}
      {canvasArea}
      {sidePanel}
    </div>
  );
}

interface DialogWrapperProps {
  initialMap:      EditableMap;
  initialName?:    string;
  theme:           string;
  httpBase:        string;
  onApply?:        (map: EditableMap) => void;
  onSaveToLibrary: (map: EditableMap, displayName: string) => Promise<string | null>;
  onDownload:      (map: EditableMap, displayName: string) => Promise<string | null>;
  onClose:         () => void;
}

/** 対戦設定から開くモーダル版。中身は {@link MapEditorPanel} を薄く包むだけ */
export function MapEditorDialog({ onClose, ...panelProps }: DialogWrapperProps) {
  const [dirty, setDirty] = useState(false);

  const guardedClose = () => {
    if (!confirmDiscardEdits(dirty)) return;
    onClose();
  };

  return (
    <Dialog title="マップエディタ" onClose={guardedClose} maxHeight="95vh" bodyStyle={s.dialogBody}>
      <MapEditorPanel {...panelProps} onClose={onClose} onDirtyChange={setDirty} />
    </Dialog>
  );
}

const TOOL_LABELS: Record<Tool, string> = {
  nothing:   '消しゴム',
  block:     'ブロック',
  item:      'アイテム',
  startCool: '開始位置 (COOL)',
  startHot:  '開始位置 (HOT)',
};

const RAIL_ICON = 22;

/** 消しゴム/ブロック/アイテム/開始位置を、盤面と同じテクスチャ (無ければ同じフォールバック図形) で描く */
function RailIcon({ tex, tool }: { tex: Textures; tool: Tool }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const S = RAIL_ICON;
    ctx.clearRect(0, 0, S, S);
    switch (tool) {
      case 'nothing':
        if (!drawTexture(ctx, tex, 'Floor', 0, 0, S)) drawFloorFallback(ctx, 0, 0, S);
        break;
      case 'block':
        if (!drawTexture(ctx, tex, 'Block', 0, 0, S)) drawBlockFallback(ctx, 0, 0, S);
        break;
      case 'item':
        if (!drawTexture(ctx, tex, 'Item', 0, 0, S)) drawItemFallback(ctx, 0, 0, S);
        break;
      case 'startCool':
        if (!drawTexture(ctx, tex, 'Cool', 0, 0, S)) drawPlayerFallback(ctx, 0, 0, BOARD_COLOR.cool, S);
        break;
      case 'startHot':
        if (!drawTexture(ctx, tex, 'Hot', 0, 0, S)) drawPlayerFallback(ctx, 0, 0, BOARD_COLOR.hot, S);
        break;
    }
  }, [tex, tool]);
  return <canvas ref={ref} width={RAIL_ICON} height={RAIL_ICON} style={s.railIcon} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>{children}</div>;
}
function Divider() {
  return <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_COLOR}`, margin: '8px 0' }} />;
}
function RailToolBtn({
  active, onClick, title, children,
}: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      style={{ ...s.railBtn, ...(active ? s.railBtnActive : {}) }}
      onClick={onClick}
    >{children}</button>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', minHeight: '100%', background: BG_ROOT },
  topBar: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '10px 14px', borderBottom: `1px solid ${BORDER_COLOR}`, background: BG_CARD,
  },
  brand: { fontSize: 13, fontWeight: 800, marginRight: 4 },
  topBarInput: { width: 220 },
  topBarClose: { marginLeft: 'auto' },
  caption: { padding: '4px 14px 0', fontSize: 10, color: TEXT_MUTED, background: BG_CARD },
  // alignItems 省略時の既定値 stretch だと、サイドバーの方が丈が高いとき canvas の CSS 上の
  // 高さが描画バッファ (width/height 属性) より伸びてしまい、クリック位置の割り出しが縦方向にずれる。
  body: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: BG_ROOT },
  rail: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    padding: '2px 4px', flexShrink: 0,
  },
  railBtn: {
    width: 34, height: 34, border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, cursor: 'pointer', padding: 0, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  railBtnActive: { border: `1px solid ${COOL_COLOR}`, background: COOL_PALE },
  railIcon: { display: 'block', imageRendering: 'pixelated', borderRadius: 4 },
  railSep: { width: '100%', border: 'none', borderTop: `1px solid ${BORDER_COLOR}`, margin: '2px 0' },
  railSym: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    fontSize: 9, color: TEXT_MUTED, cursor: 'pointer',
  },
  canvasWrap: { display: 'flex' },
  canvas: {
    display: 'block', cursor: 'crosshair', imageRendering: 'pixelated',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
  },
  side:  { display: 'flex', flexDirection: 'column', gap: 6, width: 150, flexShrink: 0 },
  hint: { fontSize: 9, lineHeight: 1.5, color: TEXT_MUTED },
  saveStatus: { fontSize: 10, fontWeight: 700, color: WIN_BASE },
  countRow:   { display: 'flex', justifyContent: 'space-between', fontSize: 12 },
  countLabel: { color: TEXT_SECONDARY },
  dialogBody: { padding: 0 },
};
