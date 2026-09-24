import type { MapCatalogEntry, TournamentStatePayload } from '@u15/ws-types';
import { groupStageCount, hasBracket, isConsolationMatch } from '@u15/ws-types';
import type { TournamentCommands } from '../../../hooks/useGameState';
import { Button, ChipRow, Field, Hint, Section, Select } from '../../../ui';
import { AutoPlaySection } from './AutoPlaySection';

// 運営中に触る設定。どれも「今やること」からは外れているのでこのタブに退避する。
// 観戦画面の表示の切り替えは「表示」タブ (DisplayTab) に集めてある。

/**
 * 選べる同時実行数。**バックエンドの MAX_LANES (TournamentOrchestrator.ts) と揃える。**
 * 増やすほど1試合あたりの盤面が小さくなり、対戦プログラムも同時に2本ずつ増える。
 */
const LANE_COUNTS = [1, 2, 3, 4] as const;

/**
 * 同時に行う試合数。BOT対戦予選のある大会だけに出す。
 *
 * この形式は全員が**同じ BOT・同じマップ**と1試合ずつ戦うので試合の間に依存が無く、
 * 実施順にも意味が無い — 並列にしても測っている条件が変わらない、というのが根拠。
 */
function LaneSection({ state, commands }: {
  state:    TournamentStatePayload;
  commands: TournamentCommands;
}) {
  // 走っている対戦の足元で部屋を消すことになるので、バックエンドも同じ条件で断る
  const busy = state.lanes.some(l => l.armedMatchId !== null);

  return (
    <Section title="同時に行う試合数">
      <Hint>
        BOT対戦予選は全員が<strong>同じ BOT・同じマップ</strong>と1試合ずつ戦うので、
        同時に行っても測っている条件は変わりません。観戦画面が分割され、
        そのぶん予選が早く終わります。<strong>決勝トーナメントは常に1試合ずつ</strong>です。
      </Hint>
      <ChipRow>
        {LANE_COUNTS.map(n => (
          <Button
            key={n}
            variant="choice"
            size="sm"
            selected={state.lanes.length === n}
            disabled={busy && state.lanes.length !== n}
            onClick={() => commands.setLaneCount(n)}
          >
            {n === 1 ? '1試合ずつ' : `${n}試合ずつ`}
          </Button>
        ))}
      </ChipRow>
      {busy && (
        // **「進行」タブに準備を取り消す操作は無い。** 準備を外せるのはコントロール画面の
        // 「リセット」だけで、それも主レーンにしか窓が無い — 副レーンまで含めて空けるには
        // 走らせて確定するしかないので、そう書く
        <Hint>
          準備中・対戦中の試合があるので、いまは変えられません。
          その試合を終えて結果を確定すると変えられます
          （主レーンのぶんだけなら、コントロール画面の「リセット」でも取り消せます）。
        </Hint>
      )}
    </Section>
  );
}

export interface SettingsTabProps {
  state:    TournamentStatePayload;
  maps:     MapCatalogEntry[];
  commands: TournamentCommands;
}

export function SettingsTab({ state, maps, commands }: SettingsTabProps) {
  const botStage = state.stage.format === 'bot-then-bracket';

  return (
    <>
      {botStage && <LaneSection state={state} commands={commands} />}

      {hasBracket(state.stage.format) && state.stageMaps.length > 0 && (
        <StageMapSection state={state} maps={maps} commands={commands} />
      )}

      <AutoPlaySection state={state} commands={commands} />
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
  // id を 'THIRD' と決め打ちしない — bracket.ts の命名に依存せず、敗者戦かどうかで見分ける
  const thirdPlaceMatchId = state.matches.find(isConsolationMatch)?.id ?? null;

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
      {thirdPlaceMatchId && (
        <Field label="3位決定戦" labelWidth={88}>
          <Select
            aria-label="3位決定戦のマップ"
            value={state.thirdPlaceMapId ?? ''}
            onChange={e => commands.setMatchMap(thirdPlaceMatchId, e.target.value || null)}
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">決勝と同じ</option>
            {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
          </Select>
        </Field>
      )}
    </Section>
  );
}
