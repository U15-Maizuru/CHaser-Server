import type { CatalogEntry, MapCatalogEntry } from '@u15/ws-types';
import { hasQualifying, stageLabel } from '@u15/ws-types';
import {
  Button, Checkbox, ChipRow, Field, Hint, NumberInput, Section, Select, TextInput,
} from '../../../ui';
import {
  bracketStageCount, clampInt, type DraftBot, type TournamentDraft,
} from './draft';

// 対戦のルール。**形式によって意味を持つ項目が違う**ので、出す欄も形式で分ける
// (StageRules の判別共用体と1対1に対応する)。

export interface FormatRulesEditorProps {
  draft:    TournamentDraft;
  programs: CatalogEntry[];
  maps:     MapCatalogEntry[];
  patch:    (p: Partial<TournamentDraft>) => void;
}

export function FormatRulesEditor({ draft, programs, maps, patch }: FormatRulesEditorProps) {
  const { format } = draft;
  const patchBot = (p: Partial<DraftBot>) => patch({ bot: { ...draft.bot, ...p } });

  return (
    <Section title="ルール">
      {hasQualifying(format) ? (
        <>
          <label style={s.check}>
            <Checkbox
              checked={draft.qualifyingDoubleMode}
              onChange={e => patch({ qualifyingDoubleMode: e.target.checked })}
            />
            <span>予選を2ゲーム制にする（先攻・後攻を入れ替えて2ゲームで1試合）</span>
          </label>
          <label style={s.check}>
            <Checkbox
              checked={draft.doubleMode}
              onChange={e => patch({ doubleMode: e.target.checked })}
            />
            <span>決勝トーナメントを2ゲーム制にする</span>
          </label>
          <Hint>
            公式ルールの試合形式です。外すと1ゲームで決着します。
            予選と決勝トーナメントで別々に選べます。
          </Hint>
        </>
      ) : (
        <>
          <label style={s.check}>
            <Checkbox
              checked={draft.doubleMode}
              onChange={e => patch({ doubleMode: e.target.checked })}
            />
            <span>2ゲーム制（先攻・後攻を入れ替えて2ゲームで1試合）</span>
          </label>
          <Hint>公式ルールの試合形式です。外すと1ゲームで決着します。</Hint>
        </>
      )}

      {/* 手番は予選が1ゲーム制のときだけ意味を持つ。2ゲーム制は先後が入れ替わる */}
      {format === 'bot-then-bracket' && !draft.qualifyingDoubleMode && (
        <>
          <Field label="参加者の手番">
            <ChipRow>
              {([[0, '先攻'], [1, '後攻']] as [0 | 1, string][]).map(([side, text]) => (
                <Button
                  key={side} variant="choice" size="sm"
                  selected={draft.bot.participantSide === side}
                  onClick={() => patchBot({ participantSide: side })}
                >
                  {text}
                </Button>
              ))}
            </ChipRow>
          </Field>
          <Hint>
            BOT対戦予選を1ゲーム制で行うときの手番です。
            <strong>全参加者に同じ手番が当たります</strong> —
            参加者ごとに選べるものではなく、運営がどちらかに決めるものです。
          </Hint>
        </>
      )}

      {format !== 'league' && (
        <label style={s.check}>
          <Checkbox
            checked={draft.thirdPlaceMatch}
            onChange={e => patch({ thirdPlaceMatch: e.target.checked })}
          />
          <span>3位決定戦を行う</span>
        </label>
      )}

      {format === 'group-then-bracket' && (
        <>
          <Field label="予選リーグ数">
            <NumberInput
              min={2} max={4} aria-label="予選リーグ数" value={draft.groupCount}
              onChange={e => patch({ groupCount: clampInt(e.target.value, 2, 4, 2) })}
            />
          </Field>
          <Field label="各リーグの進出人数">
            <NumberInput
              min={1} max={4} aria-label="各リーグの進出人数" value={draft.advanceCount}
              onChange={e => patch({ advanceCount: clampInt(e.target.value, 1, 4, 2) })}
            />
          </Field>
          <Hint>
            予選は各リーグの総当たり。上位 {draft.advanceCount} 名ずつ、
            合計 {draft.groupCount * draft.advanceCount} 名が決勝トーナメントへ進みます。
            同点で順位が決まらないときは、運営画面で進出者を選び直せます。
          </Hint>

          <Field label="複数リーグの進行順序">
            <Select
              aria-label="複数リーグの進行順序" value={draft.groupScheduleMode}
              onChange={e => patch({
                groupScheduleMode: e.target.value === 'sequential' ? 'sequential' : 'parallel',
              })}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="parallel">並行進行 (全リーグが節ごとに横並びで進む)</option>
              <option value="sequential">順次進行 (1リーグずつ終わらせてから次へ)</option>
            </Select>
          </Field>
          <Hint>
            並行進行なら特定のリーグの参加者だけが先に試合をこなす偏りが起きません。
            順次進行は1つのリーグを先に運営したいときに使います。
          </Hint>
        </>
      )}

      {format === 'bot-then-bracket' && (
        <>
          <div style={s.subTitle}>BOT対戦予選</div>
          <Hint>
            全参加者が<strong>同じ BOT・同じマップ</strong>と1試合ずつ戦い、獲得ポイントで
            順位を決めます（同点は 一撃ボーナス → アイテムポイント の順で比べ、
            それでも並んだら運営が決めます）。
          </Hint>

          <Field label="BOTのプログラム">
            <Select
              aria-label="BOTのプログラム" value={draft.bot.program}
              onChange={e => patchBot({ program: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">未提出（当日割り当て）</option>
              <option value="cpu">内蔵CPU</option>
              {draft.bot.file && <option value="file">同梱: {draft.bot.file.file}</option>}
              {programs.map(pr => (
                <option key={pr.id} value={`lib:${pr.id}`}>{pr.displayName}</option>
              ))}
            </Select>
          </Field>

          <Field label="BOTの表示名">
            <TextInput
              aria-label="BOTの表示名" placeholder="運営BOT" value={draft.bot.name}
              onChange={e => patchBot({ name: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            />
          </Field>

          <Field label="予選のマップ">
            <Select
              aria-label="BOT対戦予選のマップ" value={draft.bot.map}
              onChange={e => patchBot({ map: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">下の固定マップに従う</option>
              {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </Select>
          </Field>
          <Hint>
            予選は全員が同じマップで戦います。ここか下の「固定マップ」の
            <strong>どちらかは必ず指定してください</strong> —
            毎回ランダム生成では参加者ごとに条件が変わってしまいます。
          </Hint>

          <Field label="決勝トーナメント進出人数" labelWidth={150}>
            <NumberInput
              min={2} max={16} aria-label="決勝トーナメント進出人数" value={draft.advanceCount}
              onChange={e => patch({ advanceCount: clampInt(e.target.value, 2, 16, 4) })}
            />
          </Field>
          <Hint>予選の上位 {draft.advanceCount} 名が決勝トーナメントへ進みます。</Hint>
        </>
      )}

      {/* 総当たりと勝ち点は「参加者どうしが戦うリーグ」のためのもの。
          BOT対戦予選は勝ち点で順位を付けないので出さない */}
      {(format === 'league' || format === 'group-then-bracket') && (
        <>
          <label style={s.check}>
            <Checkbox
              checked={draft.doubleRoundRobin}
              onChange={e => patch({ doubleRoundRobin: e.target.checked })}
            />
            <span>2回総当たりにする</span>
          </label>
          <Field label="勝ち点">
            <div style={s.points}>
              {(['win', 'draw', 'loss'] as const).map(k => (
                <label key={k} style={s.point}>
                  {k === 'win' ? '勝' : k === 'draw' ? '分' : '敗'}
                  <NumberInput
                    aria-label={`勝ち点 ${k}`} style={{ width: 56 }}
                    value={draft.leaguePoints[k]}
                    onChange={e => patch({
                      leaguePoints: { ...draft.leaguePoints, [k]: Number(e.target.value) || 0 },
                    })}
                  />
                </label>
              ))}
            </div>
          </Field>
        </>
      )}

      <Field label="固定マップ">
        <Select
          aria-label="固定マップ" value={draft.mapCatalogId}
          onChange={e => patch({ mapCatalogId: e.target.value })}
        >
          <option value="">毎回ランダム生成</option>
          {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </Select>
      </Field>
      <Hint>
        固定マップにすると全試合が同じマップになります。同点で再試合になったときは
        運営が別のマップを選び直す必要があります。
      </Hint>

      <StageMaps draft={draft} maps={maps} patch={patch} />
    </Section>
  );
}

/** 回戦ごとのマップ (勝ち上がりがある形式のみ)。index は決勝トーナメント相対 */
function StageMaps({ draft, maps, patch }: Omit<FormatRulesEditorProps, 'programs'>) {
  const count = bracketStageCount(draft);
  if (draft.format === 'league' || count === 0) return null;

  const setAt = (stage: number, value: string) => {
    const next = Array.from(
      { length: Math.max(draft.stageMaps.length, stage + 1) },
      (_, i) => draft.stageMaps[i] ?? '');
    next[stage] = value;
    patch({ stageMaps: next });
  };

  return (
    <>
      <div style={s.subTitle}>回戦ごとのマップ</div>
      {Array.from({ length: count }, (_, stage) => {
        const label = stageLabel(stage, count);
        return (
          <Field key={stage} label={label}>
            <Select
              aria-label={`${label} のマップ`}
              value={draft.stageMaps[stage] ?? ''}
              onChange={e => setAt(stage, e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="">
                上の設定に従う（{draft.mapCatalogId === '' ? '毎回ランダム生成' : '固定マップ'}）
              </option>
              {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </Select>
          </Field>
        );
      })}
      <Hint>
        回戦ごとに違うマップで戦わせたいときに指定します。大会中でも運営パネルから差し替えられます。
        {draft.thirdPlaceMatch && ' 3位決定戦は決勝と同じ回戦なので、決勝と同じマップになります。'}
      </Hint>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  check:    { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' },
  subTitle: { fontSize: 12, fontWeight: 700, marginTop: 4 },
  points:   { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 },
  point:    { display: 'flex', gap: 4, alignItems: 'center' },
};
