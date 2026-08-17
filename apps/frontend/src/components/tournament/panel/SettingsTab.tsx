import type {
  MapCatalogEntry, TournamentDisplayView, TournamentStatePayload,
} from '@u15/ws-types';
import { groupStageCount, hasBracket, hasQualifying, hasThirdPlaceMatch } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { Button, Callout, ChipRow, Field, Hint, Section, Select } from '../../../ui';

// 運営中に触る設定。どれも「今やること」からは外れているのでこのタブに退避する。

const DISPLAY_VIEWS = (botStage: boolean): [TournamentDisplayView, string][] => [
  ['auto',    '進行に合わせる'],
  ['groups',  botStage ? 'BOT対戦予選の表' : '予選リーグ表'],
  ['bracket', '決勝トーナメント表'],
];

export interface SettingsTabProps {
  state:    TournamentStatePayload;
  maps:     MapCatalogEntry[];
  commands: TournamentCommands;
}

export function SettingsTab({ state, maps, commands }: SettingsTabProps) {
  const botStage = state.stage.format === 'bot-then-bracket';

  return (
    <>
      {hasQualifying(state.stage.format) && (
        <Section title="観客席に出す表">
          <Hint>
            観客席の画面に出すものを選びます。<strong>この運営画面の表示とは連動しません</strong> —
            観客には予選表を出したまま、手元で決勝の組み合わせを確認できます。対戦中は盤面が優先されます。
          </Hint>
          <ChipRow>
            {DISPLAY_VIEWS(botStage).map(([view, label]) => (
              <Button
                key={view}
                variant="choice"
                size="sm"
                selected={state.displayView === view}
                onClick={() => commands.setDisplayView(view)}
              >
                {label}
              </Button>
            ))}
          </ChipRow>
          {state.displayView === 'auto' && (
            <Hint>
              予選が終わっても自動では切り替わらず、決勝進出者を
              <strong>確定するまで予選の最終結果を出し続けます</strong>。
            </Hint>
          )}
        </Section>
      )}

      {hasBracket(state.stage.format) && state.stageMaps.length > 0 && (
        <StageMapSection state={state} maps={maps} commands={commands} />
      )}

      <Section title="オートプレイ">
        <Hint>
          「この試合を準備」→「ゲームスタート」→「結果を確定」を自動で行い、大会を最後まで進めます。
          画面が切り替わるたびに数秒ずつ間を置くので、観客が対戦カードと結果を目で追えます。
          <strong>同点で勝者が決まらないときは止まります</strong> —
          再試合か審判裁定かは運営が決めるものなので、自動では決めません。
        </Hint>
        {/* 自動進行の開始／停止は設定ではなく操作なので、選択チップではなくボタンにする
            (設定ダイアログ「対戦」タブのデモ開始ボタンと同じ考え方) */}
        <ChipRow>
          <Button
            variant={state.autoPlay.enabled ? 'danger' : 'accent'}
            size="sm"
            onClick={() => commands.setAutoPlay(!state.autoPlay.enabled)}
          >
            {state.autoPlay.enabled ? '■ 自動進行を止める' : '▶ 自動進行を始める'}
          </Button>
        </ChipRow>
        <ChipRow>
          <Button
            variant="choice" size="sm"
            selected={state.autoPlay.loop}
            onClick={() => commands.setAutoPlay(state.autoPlay.enabled, !state.autoPlay.loop)}
          >
            デモモード（繰り返す）
          </Button>
        </ChipRow>
        {state.autoPlay.loop && (
          <Hint>
            全試合が終わると表彰画面をしばらく出したあと、
            <strong>進行状態を消して同じ大会データを最初からやり直します</strong>。
            無人展示向けの設定なので、本番の運営では切ってください。
          </Hint>
        )}
        {state.autoPlay.stoppedReason && (
          <Callout tone="warn">自動進行を止めました: {state.autoPlay.stoppedReason}</Callout>
        )}
      </Section>
    </>
  );
}

/**
 * 回戦ごとのマップ。
 *
 * 予選リーグの節は大会の設定に従うだけなので出さない。BOT対戦予選だけは予選のマップ
 * そのものが競技条件なので出す。回戦名はバックエンドが組み立てた stageLabels を使う
 * (UI 側で節数を数え直さない)。
 */
function StageMapSection({ state, maps, commands }: SettingsTabProps) {
  const botStage = state.stage.format === 'bot-then-bracket';
  const offset   = groupStageCount(state.matches);

  return (
    <Section title="回戦ごとのマップ">
      <Hint>
        ここでの変更はこの大会の進行状態に保存され、次に「この試合を準備」したときから使われます。
        準備済みの試合が同じ回戦なら、その場で読み直します。
      </Hint>
      {botStage && (
        <Hint>
          BOT対戦予選は<strong>全参加者が同じマップ</strong>で戦うのが前提です。
          1試合でも実施したあとは変更できません。
        </Hint>
      )}
      {state.stageMaps.map((mapId, stage) => {
        if (stage < offset && !botStage) return null;
        const label = state.stageLabels[stage] ?? `第${stage + 1}回戦`;
        return (
          <Field key={stage} label={label} labelWidth={88}>
            <Select
              aria-label={`${label} のマップ`}
              value={mapId ?? ''}
              onChange={e => commands.setStageMap(stage, e.target.value || null)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">
                大会の設定に従う（{state.stage.map.catalogId ? '固定マップ' : '毎回ランダム生成'}）
              </option>
              {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </Select>
          </Field>
        );
      })}
      {hasThirdPlaceMatch(state.stage) && (
        <Hint>3位決定戦は決勝と同じ回戦なので、決勝と同じマップになります。</Hint>
      )}
    </Section>
  );
}
