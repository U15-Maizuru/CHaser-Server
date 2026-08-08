import { useCallback, useEffect, useRef, useState } from 'react';
import { MapObject } from '@u15/ws-types';
import type { Point } from '@u15/ws-types';
import { useTextures, type TextureKey } from '../hooks/useTextures';
import { MAP_SIZES, useMapGenParams } from '../hooks/useMapGenParams';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR, COOL_COLOR, COOL_PALE,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, RADIUS_SM,
  Button, Checkbox, Dialog, NumberInput, Select, TextInput,
} from '../ui';

export interface EditableMap {
  field: MapObject[][];
  size: Point;
  turn: number;
  teamFirstPoint: [Point, Point];
}

interface Props {
  initialMap:      EditableMap;
  theme:           string;
  httpBase:        string;
  onApply:         (map: EditableMap) => void;
  onSaveToLibrary: (map: EditableMap, displayName: string) => void;
  onDownload:      (map: EditableMap, displayName: string) => void;
  onClose:         () => void;
}

type Tool = 'nothing' | 'block' | 'item' | 'start';

const CELL = 28;

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

export function MapEditorDialog({ initialMap, theme, httpBase, onApply, onSaveToLibrary, onDownload, onClose }: Props) {
  const [map,      setMap]      = useState<EditableMap>(() => ({
    ...initialMap,
    field: initialMap.field.map(r => [...r]),
    teamFirstPoint: [{ ...initialMap.teamFirstPoint[0] }, { ...initialMap.teamFirstPoint[1] }],
  }));
  const [tool,     setTool]     = useState<Tool>('nothing');
  const [symmetry, setSymmetry] = useState(true);
  const [name,     setName]     = useState('');
  const [generating, setGenerating] = useState(false);
  const dragging = useRef(false);
  // 生成パラメータはマップ列の「ランダム生成」と同じものを使う (設定の二重管理を避ける)
  const { params: gen, update: setGen } = useMapGenParams();

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

  // ── Random generate ──────────────────────────────────────────────────────
  // 実際の生成アルゴリズムはバックエンド (GameSystem.createRandomMap) 側の一箇所のみに存在させ、
  // フロントエンドはここで再実装しない (挙動の重複・drift を防ぐため)。
  const handleRandom = async () => {
    const sz = MAP_SIZES[gen.sizeIdx] ?? MAP_SIZES[0];
    const size: Point = { x: sz.x, y: sz.y };
    setGenerating(true);
    try {
      const res = await fetch(`${httpBase}/api/maps/random`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size, blockNum: gen.blockNum, itemNum: gen.itemNum, turnNum: map.turn, mirror: symmetry,
        }),
      });
      if (res.ok) {
        const { data } = await res.json() as { data: { field: MapObject[][]; size: Point; turn: number; teamFirstPoint: [Point, Point] } };
        setMap({ field: data.field, size: data.size, turn: data.turn, teamFirstPoint: data.teamFirstPoint });
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    setMap(prev => ({ ...prev, field: emptyField(prev.size.x, prev.size.y) }));
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleApply = () => {
    onApply(map);
    onClose();
  };
  // Electron は window.prompt を実装していないため、名前はダイアログ内の入力欄で受け取る
  const trimmedName = name.trim();
  const handleSaveToLibrary = () => {
    if (!trimmedName) return;
    onSaveToLibrary(map, trimmedName);
  };
  const handleDownload = () => {
    if (!trimmedName) return;
    onDownload(map, trimmedName);
  };

  const blocks = countObj(map.field, MapObject.BLOCK);
  const items  = countObj(map.field, MapObject.ITEM);

  return (
    <Dialog title="マップエディタ" onClose={onClose} maxHeight="95vh" bodyStyle={s.content}>
      <canvas
        ref={canvasRef}
        width={W} height={H}
        style={s.canvas}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      <div style={s.sidebar}>
        <Label>フィールドサイズ</Label>
        <Select value={gen.sizeIdx} onChange={e => setGen({ sizeIdx: Number(e.target.value) })}>
          {MAP_SIZES.map((sz, i) => <option key={i} value={i}>{sz.label}</option>)}
        </Select>
        <Button size="sm" onClick={handleRandom} disabled={generating}>
          {generating ? '生成中...' : 'ランダム生成'}
        </Button>
        <span style={s.hint}>サイズはランダム生成でのみ反映されます</span>

        <Divider />

        <Label>ツール</Label>
        {(['nothing', 'block', 'item', 'start'] as Tool[]).map(t => (
          <ToolBtn key={t} active={tool === t} onClick={() => setTool(t)}>
            {TOOL_LABELS[t]}
          </ToolBtn>
        ))}
        <label style={s.checkRow}>
          <Checkbox checked={symmetry} onChange={e => setSymmetry(e.target.checked)} />
          <span style={s.checkLabel}>対称配置</span>
        </label>

        <Divider />

        <Label>ターン数</Label>
        <NumberInput
          min={10} max={500} step={10}
          value={map.turn}
          onChange={e => setMap(prev => ({ ...prev, turn: Number(e.target.value) }))}
        />

        <Divider />

        <Label>オブジェクト数</Label>
        <div style={s.countRow}><span style={s.countLabel}>ブロック</span><span>{blocks}</span></div>
        <div style={s.countRow}><span style={s.countLabel}>アイテム</span><span>{items}</span></div>

        <Divider />

        <Button size="sm" onClick={handleClear}>全消し</Button>

        <Divider />

        {/* ランダム生成・編集したマップを残す手段。名前が無いと保存先が決まらない */}
        <Label>マップ名</Label>
        <TextInput
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="保存・DL 用の名前"
        />
        <Button size="sm" disabled={!trimmedName} onClick={handleSaveToLibrary}>
          ライブラリに保存
        </Button>
        <Button size="sm" disabled={!trimmedName} onClick={handleDownload}>
          ダウンロード
        </Button>

        <Divider />

        <Button variant="primary" size="md" onClick={handleApply}>適用して閉じる</Button>
        <Button size="sm" onClick={onClose}>キャンセル</Button>
      </div>
    </Dialog>
  );
}

const TOOL_LABELS: Record<Tool, string> = {
  nothing: '消しゴム',
  block:   'ブロック',
  item:    'アイテム',
  start:   '開始位置',
};

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: TEXT_MUTED, letterSpacing: 1, marginBottom: 4 }}>{children}</div>;
}
function Divider() {
  return <hr style={{ border: 'none', borderTop: `1px solid ${BORDER_COLOR}`, margin: '8px 0' }} />;
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
  content: { display: 'flex', gap: 12, padding: 12, background: BG_ROOT },
  canvas: {
    display: 'block', cursor: 'crosshair', imageRendering: 'pixelated',
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
  },
  sidebar:  { display: 'flex', flexDirection: 'column', gap: 6, width: 150, flexShrink: 0 },
  hint: { fontSize: 9, lineHeight: 1.5, color: TEXT_MUTED },
  toolBtn: {
    padding: '6px 0 6px 8px', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 11, cursor: 'pointer', textAlign: 'left',
  },
  toolBtnActive: { border: `1px solid ${COOL_COLOR}`, background: COOL_PALE, color: COOL_COLOR },
  checkRow:   { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  checkLabel: { fontSize: 11, color: TEXT_SECONDARY },
  countRow:   { display: 'flex', justifyContent: 'space-between', fontSize: 12 },
  countLabel: { color: TEXT_SECONDARY },
};
