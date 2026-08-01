import { useEffect, useState } from 'react';
import type { DisplayPrefs, ServerStatusPayload } from '@u15/ws-types';
import type { EnvConfig } from '../hooks/useEnvConfig';
import type { MatchConfig } from '../hooks/useMatchConfig';
import {
  BG_ROOT, BG_CARD, BORDER_COLOR, COOL_COLOR,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  TURN_BASE, TURN_PALE,
  WIN_BASE, SHADOW_MD, RADIUS_MD, RADIUS_SM,
  FONT_UI, FONT_NUM,
} from '../styles/tokens';

interface Props {
  prefs:               DisplayPrefs;
  envConfig:           EnvConfig;
  status:              ServerStatusPayload;
  matchConfig:         MatchConfig;
  darkMode:            boolean;
  httpBase:            string;
  onSetDisplayPrefs:   (patch: Partial<DisplayPrefs>) => void;
  onSaveEnv:           (patch: Partial<EnvConfig>) => void;
  onSetDarkMode:       (enabled: boolean) => void;
  onSetDoubleMode:     (enabled: boolean) => void;
  onSetRepeatMode:     (enabled: boolean) => void;
  onSetDemoMode:       (enabled: boolean) => void;
  onChangeMatchConfig: (patch: Partial<MatchConfig>) => void;
  onCommitMatchConfig: () => void;
  onUploadMusic:       (file: File) => Promise<void>;
  onClose:             () => void;
}

const THEMES = ['Jewel', 'Light', 'Heavy', 'RPG'] as const;

// 設定の集約先。表示/音/環境に加えて、対戦のルール (2試合制/リピート/デモ) と
// 進行パラメータ (ターン表示時間/TCPタイムアウト) も「対戦」タブで扱う。
//
// 「環境」タブだけが下書き + [保存] 方式。表示・BGM・対戦ルールはサーバーが真実を持つ状態
// (ServerStatusPayload) なので、クライアントに下書きを溜めるとコントロール窓を
// 複数開いたときに互いの古い値で上書きし合う。ダークモードと同じく即時反映にする。
// 進行パラメータも同じ操作感になるよう入力時に localStorage へ、blur でサーバーへ送る。
export function SettingDialog({
  prefs, envConfig, status, matchConfig, darkMode, httpBase,
  onSetDisplayPrefs, onSaveEnv, onSetDarkMode,
  onSetDoubleMode, onSetRepeatMode, onSetDemoMode,
  onChangeMatchConfig, onCommitMatchConfig,
  onUploadMusic, onClose,
}: Props) {
  const [tab, setTab]             = useState<'display' | 'match' | 'bgm' | 'env'>('display');
  const [draftEnv, setDraftEnv]   = useState<EnvConfig>({ ...envConfig });
  const [musicFiles, setMusicFiles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${httpBase}/api/music`)
      .then(res => res.json() as Promise<{ files: string[] }>)
      .then(({ files }) => { if (!cancelled) setMusicFiles(files); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [httpBase]);

  const setEnv = <K extends keyof EnvConfig>(key: K, value: EnvConfig[K]) =>
    setDraftEnv(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSaveEnv(draftEnv);
    onClose();
  };

  // 対戦ルールを変更してよいか。バックエンドのゲート (ServerManager.set*Mode の canStart())
  // は setup フェーズのみを見るが、2試合制のセット中 (roundResults が既にある setup) に
  // ルールが変わるとセット内で条件が食い違うため、UI 側はサーバーより厳しく塞ぐ。
  const canEditRules  = status.phase === 'setup' && status.roundResults.length === 0;
  const rulesLockNote = status.phase !== 'setup'
    ? '対戦中は対戦ルールを変更できません。セットアップ画面に戻ると変更できます。'
    : '2試合制のセット中は対戦ルールを変更できません（両試合で同じルールを使うため）。';

  const handleDemoToggle = (enabled: boolean) => {
    // setDemoMode(true) はサーバー側で randomizeFromCatalog() を呼び、両スロットの
    // プログラム選択を即座に上書きする。取り返しがつくとはいえ驚きが大きいので確認する。
    if (enabled && !window.confirm(
      'デモモードを ON にすると、両チームのプログラムがライブラリ（デモ対象）から'
      + 'ランダムに選び直されます。現在の選択は失われます。よろしいですか？',
    )) return;
    onSetDemoMode(enabled);
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
          <TabBtn active={tab === 'display'} onClick={() => setTab('display')}>表示</TabBtn>
          <TabBtn active={tab === 'match'}   onClick={() => setTab('match')}>対戦</TabBtn>
          <TabBtn active={tab === 'bgm'}     onClick={() => setTab('bgm')}>BGM</TabBtn>
          {window.electronAPI && (
            <TabBtn active={tab === 'env'} onClick={() => setTab('env')}>環境</TabBtn>
          )}
        </div>

        {/* コンテンツ */}
        <div style={s.body}>
          {tab === 'display' && (
            <table style={s.table}>
              <tbody>
                <Row label="観戦画面のタイトル">
                  <input
                    type="text"
                    value={prefs.displayTitle}
                    onChange={e => onSetDisplayPrefs({ displayTitle: e.target.value })}
                    style={s.textInput}
                    placeholder="U15 Server Maizuru"
                  />
                </Row>
                <Row label="テクスチャテーマ">
                  <select
                    value={prefs.theme}
                    onChange={e => onSetDisplayPrefs({ theme: e.target.value })}
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
                    checked={prefs.muted}
                    onChange={e => onSetDisplayPrefs({ muted: e.target.checked })}
                    style={s.check}
                  />
                </Row>
                {/* ダークモードはサーバー側にフェーズゲートが無く、対戦中でも切り替えたい
                    ライブな表示切替なので、保存ボタンを待たずに即座に反映する */}
                <Row label="ダークモード (視界のみ表示)">
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={e => onSetDarkMode(e.target.checked)}
                    style={s.check}
                  />
                </Row>
              </tbody>
            </table>
          )}

          {tab === 'match' && (
            <div style={s.matchBody}>
              <span style={s.instantNote}>このタブの項目は [保存] を待たず、操作した時点で反映されます。</span>

              {/* 対戦ルール */}
              <section style={s.section}>
                <div style={s.sectionLabel}>対戦ルール</div>
                {!canEditRules && <div style={s.lockNotice}>{rulesLockNote}</div>}
                <div style={s.chipRow}>
                  <ToggleChip
                    active={status.doubleMode}
                    disabled={!canEditRules}
                    onClick={() => onSetDoubleMode(!status.doubleMode)}
                    title="先攻・後攻を入れ替えた2試合を行い、合計得点で勝者を決める"
                  >
                    2試合制
                  </ToggleChip>
                  <ToggleChip
                    active={status.repeatMode}
                    disabled={!canEditRules}
                    onClick={() => onSetRepeatMode(!status.repeatMode)}
                    title="対戦終了後、接続を保ったまま先後を入れ替えて再戦できるようにする"
                  >
                    リピート
                  </ToggleChip>
                  <ToggleChip
                    active={status.demoMode}
                    disabled={!canEditRules}
                    onClick={() => handleDemoToggle(!status.demoMode)}
                    title="無人で自動進行する。プログラムはライブラリからランダムに選ばれる"
                  >
                    デモ
                  </ToggleChip>
                </div>
                {status.demoMode && (
                  <span style={s.hint}>準備完了で自動開始します。止めるには画面下部の「リセット」を押してください。</span>
                )}
              </section>

              {/* 進行パラメータ。サーバー側にフェーズゲートが無く、turnDelay は requestStart 時に
                  値渡しで消費されるため、対戦中でも安全に編集できる (効くのは次の試合から) */}
              <section style={s.section}>
                <div style={s.sectionLabel}>進行</div>
                <div style={s.numRow}>
                  <label style={s.numLabel}>
                    ターン表示
                    <input
                      type="number" min={0} max={10} step={0.1}
                      value={(matchConfig.turnDelay / 1000).toFixed(1)}
                      onChange={e => onChangeMatchConfig({ turnDelay: Math.round(Number(e.target.value) * 1000) })}
                      onBlur={onCommitMatchConfig}
                      style={s.numInput}
                    />
                    <span style={s.unit}>秒</span>
                  </label>
                  <label style={s.numLabel}>
                    TCPタイムアウト
                    <input
                      type="number" min={1} max={60} step={1}
                      value={matchConfig.timeout}
                      onChange={e => onChangeMatchConfig({ timeout: Number(e.target.value) })}
                      onBlur={onCommitMatchConfig}
                      style={s.numInput}
                    />
                    <span style={s.unit}>秒</span>
                  </label>
                </div>
                <span style={s.hint}>進行中の試合には影響せず、次の試合から反映されます。</span>
              </section>
            </div>
          )}

          {tab === 'bgm' && (
            <table style={s.table}>
              <tbody>
                <Row label="再生する BGM">
                  <select
                    value={prefs.bgmTrack}
                    onChange={e => onSetDisplayPrefs({ bgmTrack: e.target.value })}
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
                    checked={prefs.bgmMuted}
                    onChange={e => onSetDisplayPrefs({ bgmMuted: e.target.checked })}
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
                    <span style={s.pathText} title={draftEnv.logDir}>{draftEnv.logDir || '(既定のまま)'}</span>
                    <button
                      style={s.pathBtn}
                      onClick={async () => {
                        const dir = await window.electronAPI?.openDirectory();
                        if (dir) setEnv('logDir', dir);
                      }}
                    >
                      選択
                    </button>
                  </div>
                </Row>
                <Row label="Python コマンド">
                  <div style={s.pathRow}>
                    <span style={s.pathText} title={draftEnv.pythonCommand}>{draftEnv.pythonCommand || '(既定のまま)'}</span>
                    <button
                      style={s.pathBtn}
                      onClick={async () => {
                        const exe = await window.electronAPI?.openPythonExe();
                        if (exe) setEnv('pythonCommand', exe);
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

function ToggleChip({ active, disabled, onClick, title, children }: {
  active: boolean; disabled: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      style={{ ...s.chip, ...(active ? s.chipActive : {}), ...(disabled ? s.chipDisabled : {}) }}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {active ? '✓ ' : ''}{children}
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

  // 「対戦」タブ
  matchBody:    { display: 'flex', flexDirection: 'column', gap: 18 },
  instantNote:  { fontSize: 10, color: TEXT_MUTED, lineHeight: 1.6 },
  section:      { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 1 },
  lockNotice: {
    padding: '8px 10px', borderRadius: RADIUS_SM,
    background: TURN_PALE, border: `1px solid ${BORDER_COLOR}`,
    fontSize: 10, lineHeight: 1.6, color: TEXT_SECONDARY,
  },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    padding: '5px 12px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_ROOT,
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  chipActive:   { background: TURN_BASE, borderColor: TURN_BASE, color: '#fff' },
  chipDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  numRow:   { display: 'flex', gap: 12, flexWrap: 'wrap' },
  numLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: TEXT_SECONDARY },
  numInput: {
    width: 56, padding: '4px 6px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 12, fontFamily: FONT_NUM,
  },
  unit: { fontSize: 10, color: TEXT_MUTED },
  hint: { fontSize: 10, color: TEXT_MUTED, lineHeight: 1.6 },
  select: {
    padding: '5px 8px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY, fontSize: 13,
  },
  textInput: {
    width: '100%', boxSizing: 'border-box', padding: '5px 8px', background: BG_ROOT,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: RADIUS_SM, color: TEXT_PRIMARY,
    fontSize: 13, fontFamily: FONT_UI,
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
