import { useEffect, useState } from 'react';
import { VEIL_ALPHA_MIN, VEIL_ALPHA_MAX, type DisplayPrefs, type ServerStatusPayload } from '@u15/ws-types';
import type { EnvConfig } from '../hooks/useEnvConfig';
import type { MatchConfig } from '../hooks/useMatchConfig';
import {
  BORDER_COLOR, COOL_COLOR, FONT_NUM, TEXT_MUTED, TEXT_SECONDARY,
  Button, Callout, Checkbox, Chip, ChipRow, Dialog, NumberInput, Select, Tabs, TextInput,
  type TabDef,
} from '../ui';
import { fetchMusicFiles } from '../lib/api';

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

type SettingTab = 'display' | 'match' | 'bgm' | 'env';

// 設定の集約先。表示 / 対戦 / BGM / 環境の4タブ。
//
// 「環境」タブだけが下書き + [保存] 方式。表示・BGM・対戦ルールはサーバーが真実を持つ状態
// (ServerStatusPayload) なので、クライアントに下書きを溜めるとコントロール窓を
// 複数開いたときに互いの古い値で上書きし合う。ダークモードと同じく即時反映にする。
export function SettingDialog({
  prefs, envConfig, status, matchConfig, darkMode, httpBase,
  onSetDisplayPrefs, onSaveEnv, onSetDarkMode,
  onSetDoubleMode, onSetRepeatMode, onSetDemoMode,
  onChangeMatchConfig, onCommitMatchConfig,
  onUploadMusic, onClose,
}: Props) {
  const [tab, setTab]               = useState<SettingTab>('display');
  const [draftEnv, setDraftEnv]     = useState<EnvConfig>({ ...envConfig });
  const [musicFiles, setMusicFiles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchMusicFiles(httpBase).then(files => { if (!cancelled) setMusicFiles(files); });
    return () => { cancelled = true; };
  }, [httpBase]);

  const setEnv = <K extends keyof EnvConfig>(key: K, value: EnvConfig[K]) =>
    setDraftEnv(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSaveEnv(draftEnv);
    onClose();
  };

  // 対戦ルールを変更してよいか。バックエンドのゲート (ServerManager.set*Mode) は setup
  // フェーズのみを見るが、試合の途中 (2ゲーム制で roundResults が既にある setup) にルールが
  // 変わると同じ試合の2ゲームで条件が食い違うため、UI 側はサーバーより厳しく塞ぐ。
  const canEditRules  = status.phase === 'setup' && status.roundResults.length === 0;
  const rulesLockNote = status.phase !== 'setup'
    ? '対戦中は対戦ルールを変更できません。セットアップ画面に戻ると変更できます。'
    : '試合の途中（第2ゲーム待ち）は対戦ルールを変更できません（同じ試合の2ゲームで同じルールを使うため）。';

  const handleDemoToggle = (enabled: boolean) => {
    // ON にするとサーバーが両スロットのプログラムをライブラリから選び直す。
    // 取り返しはつくが驚きが大きいので確認する
    if (enabled && !window.confirm(
      'デモモードを ON にすると、両プレイヤーのプログラムがライブラリ（デモ対象）から'
      + 'ランダムに選び直されます。現在の選択は失われます。よろしいですか？',
    )) return;
    onSetDemoMode(enabled);
  };

  const tabs: TabDef<SettingTab>[] = [
    { id: 'display', label: '表示' },
    { id: 'match',   label: '対戦' },
    { id: 'bgm',     label: 'BGM' },
    // 環境設定は Electron のファイル選択ダイアログを使うのでブラウザでは出さない
    ...(window.electronAPI ? [{ id: 'env' as const, label: '環境' }] : []),
  ];

  return (
    <Dialog
      title="設定"
      onClose={onClose}
      width={440}
      bodyStyle={{ padding: 0 }}
      footer={
        <>
          <Button onClick={onClose}>キャンセル</Button>
          <Button variant="primary" size="md" onClick={handleSave}>保存</Button>
        </>
      }
    >
      <Tabs tabs={tabs} active={tab} onSelect={setTab} />

      <div style={s.body}>
        {tab === 'display' && (
          <table style={s.table}>
            <tbody>
              <Row label="観戦画面のタイトル">
                <TextInput
                  value={prefs.displayTitle}
                  onChange={e => onSetDisplayPrefs({ displayTitle: e.target.value })}
                  placeholder="CHaser Server"
                  style={{ width: '100%' }}
                />
              </Row>
              <Row label="テクスチャテーマ">
                <Select value={prefs.theme} onChange={e => onSetDisplayPrefs({ theme: e.target.value })}>
                  {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Row>
              <Row label="SE ミュート">
                <Checkbox checked={prefs.muted} onChange={e => onSetDisplayPrefs({ muted: e.target.checked })} />
              </Row>
              <Row label="ダークモード (視界のみ表示)">
                <Checkbox checked={darkMode} onChange={e => onSetDarkMode(e.target.checked)} />
              </Row>
              <Row label="ダーク幕の濃さ">
                <div style={s.sliderRow}>
                  <input
                    type="range"
                    min={VEIL_ALPHA_MIN} max={VEIL_ALPHA_MAX} step={0.05}
                    value={prefs.veilAlpha}
                    onChange={e => onSetDisplayPrefs({ veilAlpha: Number(e.target.value) })}
                    style={s.range}
                  />
                  <span style={s.rangeValue}>{Math.round(prefs.veilAlpha * 100)}%</span>
                </div>
                <span style={s.hint}>
                  {darkMode ? '明るい会場ほど濃くします。' : 'ダークモード ON 時の暗さです。'}
                </span>
              </Row>
            </tbody>
          </table>
        )}

        {tab === 'match' && (
          <div style={s.matchBody}>
            <span style={s.hint}>このタブの項目は [保存] を待たず、操作した時点で反映されます。</span>

            <section style={s.section}>
              <div style={s.sectionLabel}>対戦ルール</div>
              {!canEditRules && <Callout>{rulesLockNote}</Callout>}
              <ChipRow>
                <Chip
                  selected={status.doubleMode}
                  disabled={!canEditRules}
                  onClick={() => onSetDoubleMode(!status.doubleMode)}
                >
                  {status.doubleMode ? '✓ ' : ''}2ゲーム制
                </Chip>
                <Chip
                  selected={status.repeatMode}
                  disabled={!canEditRules}
                  onClick={() => onSetRepeatMode(!status.repeatMode)}
                >
                  {status.repeatMode ? '✓ ' : ''}リピート
                </Chip>
                <Chip
                  selected={status.demoMode}
                  disabled={!canEditRules}
                  onClick={() => handleDemoToggle(!status.demoMode)}
                >
                  {status.demoMode ? '✓ ' : ''}デモ
                </Chip>
              </ChipRow>
              <span style={s.hint}>
                2ゲーム制は公式ルールの試合形式（先攻・後攻を入れ替えた2ゲームで1試合）。
                リピートは接続を保ったままの再戦、デモは無人での自動進行です。
              </span>
              {status.demoMode && (
                <span style={s.hint}>
                  準備完了で自動開始します。止めるには画面下部の「リセット」を押してください。
                </span>
              )}
            </section>

            {/* 進行パラメータは requestStart 時に値渡しで消費されるため、対戦中でも安全に編集できる */}
            <section style={s.section}>
              <div style={s.sectionLabel}>進行</div>
              <div style={s.numRow}>
                <label style={s.numLabel}>
                  ターン表示
                  <NumberInput
                    min={0} max={10} step={0.1}
                    value={(matchConfig.turnDelay / 1000).toFixed(1)}
                    onChange={e => onChangeMatchConfig({ turnDelay: Math.round(Number(e.target.value) * 1000) })}
                    onBlur={onCommitMatchConfig}
                  />
                  <span style={s.unit}>秒</span>
                </label>
                <label style={s.numLabel}>
                  TCPタイムアウト
                  <NumberInput
                    min={1} max={60} step={1}
                    value={matchConfig.timeout}
                    onChange={e => onChangeMatchConfig({ timeout: Number(e.target.value) })}
                    onBlur={onCommitMatchConfig}
                  />
                  <span style={s.unit}>秒</span>
                </label>
              </div>
              <span style={s.hint}>進行中のゲームには影響せず、次のゲームから反映されます。</span>
            </section>
          </div>
        )}

        {tab === 'bgm' && (
          <table style={s.table}>
            <tbody>
              <Row label="再生する BGM">
                <Select value={prefs.bgmTrack} onChange={e => onSetDisplayPrefs({ bgmTrack: e.target.value })}>
                  <option value="none">なし</option>
                  {musicFiles.map(f => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Row>
              <Row label="BGM ミュート">
                <Checkbox checked={prefs.bgmMuted} onChange={e => onSetDisplayPrefs({ bgmMuted: e.target.checked })} />
              </Row>
              <Row label="BGM ファイルを追加 (mp3/wav)">
                <input
                  type="file"
                  accept=".mp3,.wav"
                  style={s.fileInput}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await onUploadMusic(file);
                    setMusicFiles(await fetchMusicFiles(httpBase));
                    e.target.value = '';
                  }}
                />
              </Row>
            </tbody>
          </table>
        )}

        {tab === 'env' && (
          <table style={s.table}>
            <tbody>
              <Row label="ログ保存先">
                <PathPicker
                  value={draftEnv.logDir}
                  onPick={() => window.electronAPI?.openDirectory()}
                  onChange={v => setEnv('logDir', v)}
                />
              </Row>
              <Row label="Python コマンド">
                <PathPicker
                  value={draftEnv.pythonCommand}
                  onPick={() => window.electronAPI?.openPythonExe()}
                  onChange={v => setEnv('pythonCommand', v)}
                />
              </Row>
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}

/** OS のファイル選択で決めるパス。手入力させず、選んだ結果だけを表示する */
function PathPicker({ value, onPick, onChange }: {
  value: string;
  onPick: () => Promise<string | null | undefined> | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div style={s.pathRow}>
      <span style={s.pathText} title={value}>{value || '(既定のまま)'}</span>
      <Button
        size="sm"
        noShrink
        onClick={async () => {
          const picked = await onPick();
          if (picked) onChange(picked);
        }}
      >
        選択
      </Button>
    </div>
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
  body:    { padding: '16px 20px' },
  table:   { width: '100%', borderCollapse: 'collapse' },
  tdLabel: { padding: '8px 0', fontSize: 12, color: TEXT_SECONDARY, width: '55%' },
  tdValue: { padding: '8px 0' },

  matchBody:    { display: 'flex', flexDirection: 'column', gap: 18 },
  section:      { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: { fontSize: 10, color: TEXT_MUTED, letterSpacing: 1 },
  hint:         { fontSize: 10, color: TEXT_MUTED, lineHeight: 1.6 },

  numRow:   { display: 'flex', gap: 12, flexWrap: 'wrap' },
  numLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: TEXT_SECONDARY },
  unit:     { fontSize: 10, color: TEXT_MUTED },

  sliderRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  range:      { flex: 1, minWidth: 0, cursor: 'pointer', accentColor: COOL_COLOR },
  rangeValue: { fontSize: 11, color: TEXT_SECONDARY, fontFamily: FONT_NUM, width: 34, textAlign: 'right' },

  fileInput: { fontSize: 11, color: TEXT_SECONDARY, maxWidth: '100%' },
  pathRow:   { display: 'flex', alignItems: 'center', gap: 6 },
  pathText: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 11, color: TEXT_SECONDARY, fontFamily: FONT_NUM,
    border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, padding: '4px 8px',
  },
};
