import type { CSSProperties, ReactNode } from 'react';
import type { TournamentAutoPlay, TournamentStatePayload } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import {
  BORDER_COLOR, TEXT_PRIMARY, TEXT_SECONDARY, Button, Callout, Checkbox, ChipRow, Hint, Section,
} from '../../../ui';

// オートプレイ (自動進行) の運営画面。
//
// **本来は使わない機能** — 無人の展示や当日の流れを通しで確認するリハーサル向けで、
// 本番の運営は「今やること」を押して進める。なので「設定」タブの末尾に置き、
// 運営パネルの前面 (上部の固定領域) には出さない。
//
// 開始/停止は見出しの右端、設定はその下に並べる。**選ぶ設定 (チップ) と入り切りの設定
// (チェックボックス) は部品を分けて、見た目で区別がつくようにする。**

/** ラベルを上、操作と補足を下に積む1項目。項目どうしは細い線で区切る。
 *  **ラベルを左に置く横並びにしない** — 運営パネルは狭い列なので、ラベル列が内容の幅を奪って
 *  「デモモード（繰り返す）」のような短い操作まで折り返してしまう。 */
function OptionRow({ label, hint, children }: {
  label:    string;
  hint?:    ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/** 入り切りの設定 */
function Toggle({ checked, onChange, children }: {
  checked:  boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label style={s.toggle}>
      <Checkbox checked={checked} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function AutoPlaySection({ state, commands }: {
  state:    TournamentStatePayload;
  commands: TournamentCommands;
}) {
  const a = state.autoPlay;
  // 省略した項目はサーバー側が今の設定を保つので、変えたい1項目だけを渡す
  const setTieBreak = (t: TournamentAutoPlay['tieBreak']) =>
    commands.setAutoPlay(a.enabled, undefined, undefined, t);

  return (
    <Section
      title="オートプレイ"
      actions={
        <Button
          variant={a.enabled ? 'danger' : 'accent'}
          size="sm"
          onClick={() => commands.setAutoPlay(!a.enabled)}
        >
          {a.enabled ? '■ 止める' : '▶ 始める'}
        </Button>
      }
    >
      <Hint>
        「準備 → ゲームスタート → 結果を確定」を自動で行い、大会を最後まで進めます。
        無人の展示やリハーサル向けの機能で、本番の運営では使いません。
      </Hint>

      {a.stoppedReason && <Callout tone="warn">止まりました: {a.stoppedReason}</Callout>}

      <OptionRow
        label="勝ち上がりの同点"
        hint={a.tieBreak === 'pause' ? (
          <>同点になると<strong>自動進行を止め</strong>、運営の判断（再試合・審判裁定）を待ちます。</>
        ) : (
          <>
            <strong>ランダムに勝者を決めて</strong>そのまま進めます。
            カードには「同点のため抽選で決定」と残ります。
            公式ルールの再試合・審判裁定の代わりではありません。
          </>
        )}
      >
        <ChipRow>
          <Button
            variant="choice" size="sm"
            selected={a.tieBreak === 'pause'}
            onClick={() => setTieBreak('pause')}
          >
            止まる
          </Button>
          <Button
            variant="choice" size="sm"
            selected={a.tieBreak === 'random'}
            onClick={() => setTieBreak('random')}
          >
            抽選で決めて続ける
          </Button>
        </ChipRow>
      </OptionRow>

      <OptionRow
        label="試合の間"
        hint={<>次の試合を準備する前に、毎回「合間のアナウンス」を観客席へ出します（文面が空なら挟みません）。</>}
      >
        <Toggle
          checked={a.announce}
          onChange={v => commands.setAutoPlay(a.enabled, undefined, v)}
        >
          アナウンスを挟む
        </Toggle>
      </OptionRow>

      <OptionRow
        label="大会終了後"
        hint={<>
          表彰画面のあと、<strong>進行状態を消して最初からやり直します</strong>
          （組み合わせを手で決めていなければ毎回シャッフル）。
        </>}
      >
        <Toggle
          checked={a.loop}
          onChange={v => commands.setAutoPlay(a.enabled, v)}
        >
          デモモード（繰り返す）
        </Toggle>
      </OptionRow>
    </Section>
  );
}

const s: Record<string, CSSProperties> = {
  row: {
    display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    paddingTop: 10, borderTop: `1px solid ${BORDER_COLOR}`,
  },
  rowLabel: { fontSize: 11, fontWeight: 700, color: TEXT_SECONDARY },
  toggle: {
    display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    minHeight: 28, fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY, cursor: 'pointer',
  },
};
