import { useState } from 'react';
import type { AppSettings } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onSave:   (patch: Partial<AppSettings>) => void;
  onClose:  () => void;
}

const THEMES = ['Jewel', 'Light', 'Heavy', 'RPG'] as const;

export function SettingDialog({ settings, onSave, onClose }: Props) {
  const [tab, setTab]       = useState<'game' | 'map'>('game');
  const [draft, setDraft]   = useState<AppSettings>({ ...settings });

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        {/* タイトル */}
        <div style={s.header}>
          <span style={s.title}>設定</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* タブ */}
        <div style={s.tabs}>
          <TabBtn active={tab === 'game'} onClick={() => setTab('game')}>ゲーム</TabBtn>
          <TabBtn active={tab === 'map'}  onClick={() => setTab('map')}>ランダムマップ</TabBtn>
        </div>

        {/* コンテンツ */}
        <div style={s.body}>
          {tab === 'game' && (
            <table style={s.table}>
              <tbody>
                <Row label="TCP タイムアウト (秒)">
                  <input
                    type="number" min={1} max={60} step={1}
                    value={draft.timeout}
                    onChange={e => set('timeout', Number(e.target.value))}
                    style={s.numInput}
                  />
                </Row>
                <Row label="1ターンの表示時間 (秒)">
                  <input
                    type="number" min={0} max={10} step={0.1}
                    value={(draft.turnDelay / 1000).toFixed(1)}
                    onChange={e => set('turnDelay', Math.round(Number(e.target.value) * 1000))}
                    style={s.numInput}
                  />
                </Row>
                <Row label="テクスチャテーマ">
                  <select
                    value={draft.theme}
                    onChange={e => set('theme', e.target.value)}
                    style={s.select}
                  >
                    {THEMES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Row>
                <Row label="SE ミュート">
                  <input
                    type="checkbox"
                    checked={draft.muted}
                    onChange={e => set('muted', e.target.checked)}
                    style={s.check}
                  />
                </Row>
                <Row label="2試合制 (先後入れ替え)">
                  <input
                    type="checkbox"
                    checked={draft.doubleMode}
                    onChange={e => set('doubleMode', e.target.checked)}
                    style={s.check}
                  />
                </Row>
              </tbody>
            </table>
          )}

          {tab === 'map' && (
            <table style={s.table}>
              <tbody>
                <Row label="ターン数">
                  <input
                    type="number" min={10} max={500} step={10}
                    value={draft.turnNum}
                    onChange={e => set('turnNum', Number(e.target.value))}
                    style={s.numInput}
                  />
                </Row>
                <Row label="ブロック数 (偶数)">
                  <input
                    type="number" min={0} max={100} step={2}
                    value={draft.blockNum}
                    onChange={e => set('blockNum', Number(e.target.value))}
                    style={s.numInput}
                  />
                </Row>
                <Row label="アイテム数 (奇数)">
                  <input
                    type="number" min={1} max={200} step={2}
                    value={draft.itemNum}
                    onChange={e => set('itemNum', Number(e.target.value))}
                    style={s.numInput}
                  />
                </Row>
                <Row label="対称マップ">
                  <input
                    type="checkbox"
                    checked={draft.mirror}
                    onChange={e => set('mirror', e.target.checked)}
                    style={s.check}
                  />
                </Row>
              </tbody>
            </table>
          )}
        </div>

        {/* フッター */}
        <div style={s.footer}>
          <button style={s.btnCancel} onClick={onClose}>キャンセル</button>
          <button style={s.btnSave}   onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button style={{ ...s.tab, ...(active ? s.tabActive : {}) }} onClick={onClick}>
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td style={s.tdLabel}>{label}</td>
      <td style={s.tdValue}>{children}</td>
    </tr>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: '#000000aa',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
    width: 420, display: 'flex', flexDirection: 'column',
    color: '#eee', fontFamily: 'monospace',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #30363d',
  },
  title:    { fontSize: 14, fontWeight: 'bold' },
  closeBtn: {
    background: 'none', border: 'none', color: '#888', fontSize: 16,
    cursor: 'pointer', padding: '0 4px',
  },
  tabs: { display: 'flex', borderBottom: '1px solid #30363d' },
  tab: {
    flex: 1, padding: '8px 0', background: 'none', border: 'none',
    color: '#888', fontSize: 12, cursor: 'pointer', borderBottom: '2px solid transparent',
  },
  tabActive: { color: '#58a6ff', borderBottom: '2px solid #58a6ff' },
  body:   { padding: '16px 20px' },
  table:  { width: '100%', borderCollapse: 'collapse' },
  tdLabel: { padding: '8px 0', fontSize: 12, color: '#aaa', width: '55%' },
  tdValue: { padding: '8px 0' },
  numInput: {
    width: 80, padding: '4px 6px', background: '#0d1117',
    border: '1px solid #333', borderRadius: 4, color: '#eee',
    fontSize: 13, fontFamily: 'monospace',
  },
  select: {
    padding: '4px 6px', background: '#0d1117',
    border: '1px solid #333', borderRadius: 4, color: '#eee', fontSize: 13,
  },
  check: { width: 16, height: 16, cursor: 'pointer' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 16px', borderTop: '1px solid #30363d',
  },
  btnCancel: {
    padding: '6px 16px', border: '1px solid #444', borderRadius: 4,
    background: 'transparent', color: '#ccc', fontSize: 12, cursor: 'pointer',
  },
  btnSave: {
    padding: '6px 16px', border: 'none', borderRadius: 4,
    background: '#238636', color: '#fff', fontSize: 12, cursor: 'pointer',
  },
};
