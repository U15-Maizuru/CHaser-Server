import { useEffect, useState } from 'react';
import type { AppSettings } from '../hooks/useSettings';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR, COOL_COLOR,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  WIN_BASE, SHADOW_MD, RADIUS_MD, RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  settings:      AppSettings;
  darkMode:      boolean;
  httpBase:      string;
  onSave:        (patch: Partial<AppSettings>) => void;
  onSetDarkMode: (enabled: boolean) => void;
  onUploadMusic: (file: File) => Promise<void>;
  onClose:       () => void;
}

const THEMES = ['Jewel', 'Light', 'Heavy', 'RPG'] as const;

export function SettingDialog({ settings, darkMode, httpBase, onSave, onSetDarkMode, onUploadMusic, onClose }: Props) {
  const [tab, setTab]             = useState<'game' | 'map' | 'bgm' | 'env'>('game');
  const [draft, setDraft]         = useState<AppSettings>({ ...settings });
  const [draftDarkMode, setDraftDarkMode] = useState(darkMode);
  const [musicFiles, setMusicFiles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${httpBase}/api/music`)
      .then(res => res.json() as Promise<{ files: string[] }>)
      .then(({ files }) => { if (!cancelled) setMusicFiles(files); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [httpBase]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSave(draft);
    onSetDarkMode(draftDarkMode);
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
          <TabBtn active={tab === 'bgm'}  onClick={() => setTab('bgm')}>BGM</TabBtn>
          {window.electronAPI && (
            <TabBtn active={tab === 'env'} onClick={() => setTab('env')}>環境</TabBtn>
          )}
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
                <Row label="リピートモード (終了後、接続を保ったまま再戦)">
                  <input
                    type="checkbox"
                    checked={draft.repeatMode}
                    onChange={e => set('repeatMode', e.target.checked)}
                    style={s.check}
                  />
                </Row>
                <Row label="デモモード (無人自動進行)">
                  <input
                    type="checkbox"
                    checked={draft.demoMode}
                    onChange={e => set('demoMode', e.target.checked)}
                    style={s.check}
                  />
                </Row>
                <Row label="ダークモード (視界のみ表示)">
                  <input
                    type="checkbox"
                    checked={draftDarkMode}
                    onChange={e => setDraftDarkMode(e.target.checked)}
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

          {tab === 'bgm' && (
            <table style={s.table}>
              <tbody>
                <Row label="再生する BGM">
                  <select
                    value={draft.bgmTrack}
                    onChange={e => set('bgmTrack', e.target.value)}
                    style={s.select}
                  >
                    <option value="none">なし</option>
                    {musicFiles.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Row>
                <Row label="BGM ミュート">
                  <input
                    type="checkbox"
                    checked={draft.bgmMuted}
                    onChange={e => set('bgmMuted', e.target.checked)}
                    style={s.check}
                  />
                </Row>
                <Row label="BGM ファイルを追加 (mp3/wav)">
                  <input
                    type="file"
                    accept=".mp3,.wav"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await onUploadMusic(file);
                      const res = await fetch(`${httpBase}/api/music`);
                      const { files } = await res.json() as { files: string[] };
                      setMusicFiles(files);
                      e.target.value = '';
                    }}
                    style={s.select}
                  />
                </Row>
              </tbody>
            </table>
          )}

          {tab === 'env' && (
            <table style={s.table}>
              <tbody>
                <Row label="ログ保存先">
                  <div style={s.pathRow}>
                    <span style={s.pathText} title={draft.logDir}>{draft.logDir || '(既定のまま)'}</span>
                    <button
                      style={s.pathBtn}
                      onClick={async () => {
                        const dir = await window.electronAPI?.openDirectory();
                        if (dir) set('logDir', dir);
                      }}
                    >
                      選択
                    </button>
                  </div>
                </Row>
                <Row label="Python コマンド">
                  <div style={s.pathRow}>
                    <span style={s.pathText} title={draft.pythonCommand}>{draft.pythonCommand || '(既定のまま)'}</span>
                    <button
                      style={s.pathBtn}
                      onClick={async () => {
                        const exe = await window.electronAPI?.openPythonExe();
                        if (exe) set('pythonCommand', exe);
                      }}
                    >
                      選択
                    </button>
                  </div>
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
    position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
    width: 420, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    color: TEXT_PRIMARY, fontFamily: FONT_UI,
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 20px', borderBottom: `1px solid ${BORDER_COLOR}`,
  },
  title:    { fontSize: 15, fontWeight: 800 },
  closeBtn: {
    background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 16,
    cursor: 'pointer', padding: '0 4px',
  },
  tabs: { display: 'flex', borderBottom: `1px solid ${BORDER_COLOR}` },
  tab: {
    flex: 1, padding: '10px 0', background: 'none', border: 'none',
    color: TEXT_MUTED, fontSize: 12, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent',
  },
  tabActive: { color: COOL_COLOR, borderBottom: `2px solid ${COOL_COLOR}` },
  body:   { padding: '16px 20px', flex: 1, minHeight: 0, overflow: 'auto' },
  table:  { width: '100%', borderCollapse: 'collapse' },
  tdLabel: { padding: '8px 0', fontSize: 12, color: TEXT_SECONDARY, width: '55%' },
  tdValue: { padding: '8px 0' },
  numInput: {
    width: 80, padding: '5px 8px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 13, fontFamily: FONT_NUM,
  },
  select: {
    padding: '5px 8px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY, fontSize: 13,
  },
  check: { width: 16, height: 16, cursor: 'pointer', accentColor: COOL_COLOR },
  pathRow: { display: 'flex', alignItems: 'center', gap: 6 },
  pathText: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 11, color: TEXT_SECONDARY, fontFamily: FONT_NUM,
  },
  pathBtn: {
    padding: '4px 12px', border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM,
    background: BG_ROOT, color: TEXT_PRIMARY, fontSize: 11, cursor: 'pointer', flexShrink: 0,
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '14px 20px', borderTop: `1px solid ${BORDER_COLOR}`,
  },
  btnCancel: {
    padding: '7px 18px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 12, cursor: 'pointer',
  },
  btnSave: {
    padding: '7px 18px', border: 'none', borderRadius: 99,
    background: WIN_BASE, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
};
