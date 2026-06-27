import { useCallback, useEffect, useRef, useState } from 'react';
import { MapObject } from '../types/ws-types';
import type { Point } from '../types/ws-types';

export interface EditableMap {
  field: MapObject[][];
  size: Point;
  turn: number;
  teamFirstPoint: [Point, Point];
}

interface Props {
  initialMap:  EditableMap;
  theme:       string;
  onSave:      (map: EditableMap, filePath?: string) => void;
  onClose:     () => void;
}

type Tool = 'nothing' | 'block' | 'item' | 'start';

const CELL    = 28;
const SIZES   = [
  { label: '決戦 (15×17)', x: 15, y: 17 },
  { label: '広域 (21×17)', x: 21, y: 17 },
] as const;

function emptyField(x: number, y: number): MapObject[][] {
  return Array.from({ length: y }, () => Array(x).fill(MapObject.NOTHING));
}

function mirrorPoint(p: Point, size: Point): Point {
  const cx = Math.floor(size.x / 2);
  const cy = Math.floor(size.y / 2);
  return { x: cx * 2 - p.x, y: cy * 2 - p.y };
}

function countObj(field: MapObject[][], obj: MapObject): number {
  return field.flat().filter(c => c === obj).length;
}

type TextureKey = 'Floor' | 'Block' | 'Item' | 'Cool' | 'Hot';
const KEYS: TextureKey[] = ['Floor', 'Block', 'Item', 'Cool', 'Hot'];

function useTextures(theme: string): Partial<Record<TextureKey, HTMLImageElement>> {
  const [tex, setTex] = useState<Partial<Record<TextureKey, HTMLImageElement>>>({});
  useEffect(() => {
    const loaded: Partial<Record<TextureKey, HTMLImageElement>> = {};
    let rem = KEYS.length;
    for (const k of KEYS) {
      const img = new Image();
      img.src = new URL(`../assets/Image/${theme}/${k}.png`, import.meta.url).href;
      img.onload  = () => { loaded[k] = img; if (--rem === 0) setTex({ ...loaded }); };
      img.onerror = () => { if (--rem === 0) setTex({ ...loaded }); };
    }
    setTex({});
  }, [theme]);
  return tex;
}

export function MapEditorDialog({ initialMap, theme, onSave, onClose }: Props) {
  const [map,      setMap]      = useState<EditableMap>(() => ({
    ...initialMap,
    field: initialMap.field.map(r => [...r]),
    teamFirstPoint: [{ ...initialMap.teamFirstPoint[0] }, { ...initialMap.teamFirstPoint[1] }],
  }));
  const [tool,     setTool]     = useState<Tool>('nothing');
  const [symmetry, setSymmetry] = useState(true);
  const [sizeIdx,  setSizeIdx]  = useState(0);
  const dragging = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tex = useTextures(theme);

  const W = map.size.x * CELL;
  const H = map.size.y * CELL;

  // ── Draw ────────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const drawImg = (key: TextureKey, x: number, y: number): boolean => {
      const img = tex[key];
      if (img) { ctx.drawImage(img, x, y, CELL, CELL); return true; }
      return false;
    };

    for (let r = 0; r < map.size.y; r++) {
      for (let c = 0; c < map.size.x; c++) {
        const x = c * CELL, y = r * CELL;
        // floor
        if (!drawImg('Floor', x, y)) {
          ctx.fillStyle = '#d4cbb8';
          ctx.fillRect(x, y, CELL, CELL);
        }
        // grid
        ctx.strokeStyle = '#00000022';
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        // object
        const cell = map.field[r]?.[c] ?? MapObject.NOTHING;
        if (cell === MapObject.BLOCK) {
          if (!drawImg('Block', x, y)) { ctx.fillStyle = '#3a3330'; ctx.fillRect(x, y, CELL, CELL); }
        } else if (cell === MapObject.ITEM) {
          if (!drawImg('Item', x, y)) {
            ctx.fillStyle = '#f5c842';
            ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    // players
    for (const [i, img, color] of [
      [0, tex['Cool'], '#3a82c4'],
      [1, tex['Hot'],  '#c43a3a'],
    ] as [number, HTMLImageElement | undefined, string][]) {
      const p = map.teamFirstPoint[i];
      const x = p.x * CELL, y = p.y * CELL;
      if (img) { ctx.drawImage(img, x, y, CELL, CELL); }
      else {
        ctx.fillStyle = color;
        ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      }
    }
  }, [map, tex, W, H]);

  useEffect(() => { draw(); }, [draw]);

  // ── Edit ────────────────────────────────────────────────────────────────────
  const applyTool = (px: number, py: number) => {
    const col = Math.floor(px / CELL);
    const row = Math.floor(py / CELL);
    if (col < 0 || col >= map.size.x || row < 0 || row >= map.size.y) return;

    setMap(prev => {
      const next = {
        ...prev,
        field: prev.field.map(r => [...r]),
        teamFirstPoint: [{ ...prev.teamFirstPoint[0] }, { ...prev.teamFirstPoint[1] }] as [Point, Point],
      };
      if (tool === 'start') {
        next.teamFirstPoint[0] = { x: col, y: row };
        next.teamFirstPoint[1] = mirrorPoint({ x: col, y: row }, next.size);
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

  // ── Random generate ────────────────────────────────────────────────────────
  const handleRandom = () => {
    const sz = SIZES[sizeIdx];
    const size: Point = { x: sz.x, y: sz.y };

    const field = emptyField(size.x, size.y);
    const rand = (n: number) => Math.floor(Math.random() * n);

    // team first point (COOL 左側)
    let p0: Point;
    const cx = Math.floor(size.x / 2), cy = Math.floor(size.y / 2);
    while (true) {
      const p = { x: rand(size.x), y: rand(size.y) };
      if (Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)) <= 1) continue;
      if (p.x < cx || (p.x === cx && p.y < cy)) { p0 = p; break; }
    }
    const p1 = mirrorPoint(p0!, size);

    // blocks
    let placed = 0;
    while (placed < 20) {
      const pos = { x: rand(size.x), y: rand(size.y) };
      const mp  = mirrorPoint(pos, size);
      if (pos.x === 0 || pos.x === size.x - 1 || pos.y === 0 || pos.y === size.y - 1) continue;
      if ((pos.x === p0!.x && pos.y === p0!.y) || (pos.x === p1.x && pos.y === p1.y)) continue;
      if (pos.x === cx && pos.y === cy) continue;
      if (field[pos.y][pos.x] !== MapObject.NOTHING) continue;
      field[pos.y][pos.x] = MapObject.BLOCK;
      field[mp.y][mp.x]   = MapObject.BLOCK;
      placed += 2;
    }

    // center item + mirrored items
    field[cy][cx] = MapObject.ITEM;
    let itemPlaced = 1;
    while (itemPlaced < 51) {
      const pos = { x: rand(size.x), y: rand(size.y) };
      const mp  = mirrorPoint(pos, size);
      const tooClose =
        Math.max(Math.abs(p0!.x - pos.x), Math.abs(p0!.y - pos.y)) <= 1 ||
        Math.max(Math.abs(p1.x  - pos.x), Math.abs(p1.y  - pos.y)) <= 1;
      if (tooClose) continue;
      if (field[pos.y][pos.x] !== MapObject.NOTHING) continue;
      field[pos.y][pos.x] = MapObject.ITEM;
      field[mp.y][mp.x]   = MapObject.ITEM;
      itemPlaced += 2;
    }

    setMap({ field, size, turn: map.turn, teamFirstPoint: [p0!, p1] });
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    setMap(prev => ({ ...prev, field: emptyField(prev.size.x, prev.size.y) }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const filePath = await window.electronAPI?.saveMapFile?.();
    onSave(map, filePath ?? undefined);
    onClose();
  };

  const blocks = countObj(map.field, MapObject.BLOCK);
  const items  = countObj(map.field, MapObject.ITEM);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>マップエディタ</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.content}>
          {/* Canvas */}
          <canvas
            ref={canvasRef}
            width={W} height={H}
            style={{ display: 'block', cursor: 'crosshair', imageRendering: 'pixelated', border: '1px solid #30363d' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />

          {/* Sidebar */}
          <div style={s.sidebar}>
            {/* サイズ */}
            <Label>フィールドサイズ</Label>
            <select value={sizeIdx} onChange={e => setSizeIdx(Number(e.target.value))} style={s.select}>
              {SIZES.map((sz, i) => <option key={i} value={i}>{sz.label}</option>)}
            </select>
            <button style={s.btnSm} onClick={handleRandom}>ランダム生成</button>

            <Divider />

            {/* ツール */}
            <Label>ツール</Label>
            {(['nothing', 'block', 'item', 'start'] as Tool[]).map(t => (
              <ToolBtn key={t} active={tool === t} onClick={() => setTool(t)}>
                {TOOL_LABELS[t]}
              </ToolBtn>
            ))}
            <div style={s.checkRow}>
              <input type="checkbox" checked={symmetry} onChange={e => setSymmetry(e.target.checked)} />
              <span style={s.checkLabel}>対称配置</span>
            </div>

            <Divider />

            {/* ターン */}
            <Label>ターン数</Label>
            <input
              type="number" min={10} max={500} step={10}
              value={map.turn}
              onChange={e => setMap(prev => ({ ...prev, turn: Number(e.target.value) }))}
              style={s.numInput}
            />

            <Divider />

            {/* カウント */}
            <Label>オブジェクト数</Label>
            <div style={s.countRow}><span style={s.countLabel}>ブロック</span><span>{blocks}</span></div>
            <div style={s.countRow}><span style={s.countLabel}>アイテム</span><span>{items}</span></div>

            <Divider />

            <button style={s.btnSm} onClick={handleClear}>全消し</button>
            <button style={s.btnPrimary} onClick={handleSave}>保存して閉じる</button>
            <button style={s.btnSm} onClick={onClose}>キャンセル</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TOOL_LABELS: Record<Tool, string> = {
  nothing: '消しゴム',
  block:   'ブロック',
  item:    'アイテム',
  start:   '開始位置',
};

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: '#666', letterSpacing: 1, marginBottom: 4 }}>{children}</div>;
}
function Divider() {
  return <hr style={{ border: 'none', borderTop: '1px solid #30363d', margin: '8px 0' }} />;
}
function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      style={{ ...s.toolBtn, ...(active ? s.toolBtnActive : {}) }}
      onClick={onClick}
    >{children}</button>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: '#000000aa',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    display: 'flex', flexDirection: 'column', maxHeight: '95vh', overflow: 'hidden',
    color: '#eee', fontFamily: 'monospace',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 14px', borderBottom: '1px solid #30363d', flexShrink: 0,
  },
  title:    { fontSize: 13, fontWeight: 'bold' },
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: 16, cursor: 'pointer' },
  content:  { display: 'flex', gap: 12, padding: 12, overflow: 'auto' },
  sidebar:  { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130 },
  select: {
    padding: '3px 6px', background: '#0d1117', border: '1px solid #333',
    borderRadius: 4, color: '#eee', fontSize: 11,
  },
  numInput: {
    width: 80, padding: '3px 6px', background: '#0d1117',
    border: '1px solid #333', borderRadius: 4, color: '#eee',
    fontSize: 12, fontFamily: 'monospace',
  },
  toolBtn: {
    padding: '5px 0', border: '1px solid #333', borderRadius: 4,
    background: 'transparent', color: '#888', fontSize: 11, cursor: 'pointer', textAlign: 'left',
    paddingLeft: 8,
  },
  toolBtnActive: { border: '1px solid #58a6ff', background: '#1f3a5f', color: '#58a6ff' },
  checkRow:  { display: 'flex', alignItems: 'center', gap: 6 },
  checkLabel: { fontSize: 11, color: '#aaa' },
  countRow:  { display: 'flex', justifyContent: 'space-between', fontSize: 12 },
  countLabel: { color: '#888' },
  btnSm: {
    padding: '5px 0', border: '1px solid #444', borderRadius: 4,
    background: 'transparent', color: '#ccc', fontSize: 11, cursor: 'pointer',
  },
  btnPrimary: {
    padding: '7px 0', border: 'none', borderRadius: 4,
    background: '#238636', color: '#fff', fontSize: 12, cursor: 'pointer',
  },
};
