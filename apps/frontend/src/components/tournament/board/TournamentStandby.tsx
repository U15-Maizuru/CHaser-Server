import type { TournamentMatch, TournamentStatePayload } from '@u15/ws-types';
import { hasQualifying } from '@u15/ws-types';
import { BracketView } from './BracketView';
import { GroupIntroBoard } from './GroupIntroBoard';
import { QualifyingView, qualifyingLabel, type QualifyingPhase } from './QualifyingView';
import { LeagueTable } from './LeagueTable';
import { lastConfirmedMatch, matchSideLabels, winnerOf } from '../../../lib/tournamentResult';
import {
  BG_ROOT, RADIUS_MD, SHADOW_SM,
  TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_LIGHT, WIN_PALE,
  FONT_NUM, FONT_UI, winLoseTextStyle,
} from '../../../ui';

// 試合と試合の間の観戦用画面。トーナメント表 / リーグ表だけを画面いっぱいに見せる。
//
// 「この大会を運営」した直後から、「この試合を準備」で対戦カードが決まるまでの間と、
// 試合を「確定」してから次の試合を準備するまでの間がこの画面。確定直後は、たった今
// 終わった試合を表の中で強調して「どれが終わったのか」を観客に示す。

export interface TournamentStandbyProps {
  state:        TournamentStatePayload;
  displayTitle: string;
  /** 予選ありのとき、いま出すもの (運営パネルの指定 + 自動追従の結果) */
  groupPhase?:  QualifyingPhase;
  /**
   * 予選が終わった直後の据え置き中。最終試合のカード自体は出し続けたまま、
   * ラベルだけ「予選リーグ 最終結果」に差し替える (勝者・スコアまで消すと、
   * 最後の試合だけ結果を見せずに表へ飛んだように見える)
   */
  holdingGroupResult?: boolean;
}

/**
 * 見出しの「たった今終わった試合」カードに出してよいか。
 *
 * 予選ありの大会は、決勝進出者を確定した瞬間に `groupPhase` が 'groups' → 'bracket' へ
 * 切り替わる (holdingGroupResult は false に戻る) が、`lastConfirmedMatch` はまだ
 * 「予選の最終試合」を指したまま — 決勝側の試合はまだ1つも確定していないため。
 * ここで弾かないと、決勝トーナメント表に切り替わった直後だけ予選の最終試合のカードが
 * 居残って見える。**予選の試合 (`group` あり) は予選表を出している間だけ、
 * 決勝の試合 (`group` 無し) は決勝表を出している間だけ**、というふうに今出している面と
 * 試合の所属を揃える
 */
function matchesDisplayedPhase(
  m: TournamentMatch, hasGroups: boolean, groupPhase: QualifyingPhase | undefined,
): boolean {
  if (!hasGroups || !groupPhase) return true;
  return groupPhase === 'groups' ? m.group !== undefined : m.group === undefined;
}

export function TournamentStandby({
  state, displayTitle, groupPhase, holdingGroupResult = false,
}: TournamentStandbyProps) {
  const lastConfirmed = lastConfirmedMatch(state);
  // 同点は confirmResult できない (再試合か審判裁定が要る) が、運営が「この結果で確定」で
  // 認めた (tieAcknowledged) 時点でスコアは観客に見せてよい。armedMatchId はまだこの試合を
  // 指したままなので、lastConfirmedMatch (confirmedAt 済みだけを見る) より優先して拾う —
  // でないと運営が実際に再試合/裁定を選ぶまで、一つ前の試合の結果が居残って見える
  const armedTieAck = state.matches.find(m =>
    m.id === state.armedMatchId && m.status === 'awaiting_confirm' && m.tieAcknowledged);
  const candidate = armedTieAck ?? lastConfirmed;
  const finished = candidate && matchesDisplayedPhase(candidate, hasQualifying(state.stage.format), groupPhase)
    ? candidate
    : null;
  const winner   = finished ? winnerOf(state, finished) : null;
  // 「〜の勝ち」の一文だけでは勝因が伝わらない (何勝何敗だったのか、点差だったのか)。
  // 両者の勝敗数・合計ポイントを添える。set が無い (両者棄権など) 試合は出さない
  const sideLabels  = finished ? matchSideLabels(state, finished) : null;
  const set         = finished?.result?.set ?? null;
  const winnerSide  = finished?.result?.winnerSide ?? null;
  // トーナメント表の「次のラウンドを金色に」(BracketView の advancedSlots) は、勝者が
  // 実際に決まった (= 確定済みの) 試合だけを起点にする。認めただけでまだ再試合/裁定を
  // 選んでいない同点の試合を起点にすると、まだ解決していない下流の枠 (「—」のまま) まで
  // 金色になってしまう — 下のトーナメント表は変えずに、通常どおりの表示のままにする
  const bracketFinishedId = finished === lastConfirmed ? (finished?.id ?? null) : null;

  // 予選が1試合も確定していない間だけ、星取表の代わりに紹介画面を出す。
  // 1試合でも確定すればここは false になり、以降は通常の QualifyingView (星取表) に戻る
  // (finished は上で「表示中の面と試合の所属が揃っているか」まで見ているので、
  // 決勝側に切り替わった直後に予選の最終試合を拾って誤発火することもない)
  const showGroupIntro = hasQualifying(state.stage.format) && groupPhase === 'groups' && !finished;

  return (
    <div style={s.root}>
      <div style={s.titleWrap}>
        <div style={s.eyebrow}>{displayTitle}</div>
        <div style={s.title}>{state.name}</div>
        {finished ? (
          <div style={s.matchResultCard}>
            <div style={s.matchResultHead}>
              {/* 予選が終わった直後 (最終試合の確定〜決勝進出者の確定待ち) は、
                  試合番号のラベルより「予選が終わった」ことのほうが観客に伝えるべき情報。
                  ラベルを差し替えるだけで、勝者・スコアはそのまま最終試合のものを見せ続ける
                  (差し替えてしまうと、最後の試合だけ結果を見せずに表へ飛ぶことになる) */}
              <span style={s.resultLabel}>
                {holdingGroupResult ? `${qualifyingLabel(state)} 最終結果` : finished.label}
              </span>
              {/* 所属は勝者名の上に小さく。「〜の勝ち」の一文は名前だけで組む。
                  勝者がいなくても set があれば (両者敗退ではなく) 引き分け — 数字を
                  比べさせず、一文で言い切る */}
              <span style={s.resultWinner}>
                {winner?.affiliation && <span style={s.resultAff}>{winner.affiliation}</span>}
                <span style={s.resultName}>
                  {winner ? `${winner.name} の勝ち` : set ? '引き分け' : '決着なし'}
                </span>
              </span>
            </div>
            {/* 第1ゲームのリキャップ (SetupWaiting の recapRow) と同じ左右対称な並びにする。
                名前 → ポイント → 勝ち数 → ダッシュ → 勝ち数 → ポイント → 名前。
                名前欄の幅を揃えて初めて中央のダッシュが動かない。
                勝った側は色と太字で浮かせ、負けた側は沈める — 勝ち数の大小を
                読み比べなくても、どちらが勝ったかがこの行だけで分かるようにする
                (色だけで区別が付くので、アイコンは重ねて足さない) */}
            {set && sideLabels && (
              <>
                <div style={s.matchResultDivider} />
                <div style={s.resultScoreRow} data-testid="result-score">
                  <span style={{ ...s.resultScoreName, ...winLoseTextStyle(winnerSide, 0) }}>
                    {sideLabels[0]?.name ?? '—'}
                  </span>
                  <span style={{ ...s.resultScoreNum, ...winLoseTextStyle(winnerSide, 0) }}>
                    {set.totals[0]}pt
                  </span>
                  <span style={{ ...s.resultScoreNum, ...winLoseTextStyle(winnerSide, 0) }}>
                    {set.wins[0]}勝
                  </span>
                  <span style={s.resultScoreDash}>—</span>
                  <span style={{ ...s.resultScoreNum, ...winLoseTextStyle(winnerSide, 1) }}>
                    {set.wins[1]}勝
                  </span>
                  <span style={{ ...s.resultScoreNum, ...winLoseTextStyle(winnerSide, 1) }}>
                    {set.totals[1]}pt
                  </span>
                  <span style={{ ...s.resultScoreName, ...winLoseTextStyle(winnerSide, 1) }}>
                    {sideLabels[1]?.name ?? '—'}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={s.sub}>まもなく開始します</div>
        )}
      </div>

      <div style={s.figure}>
        {showGroupIntro ? (
          <GroupIntroBoard state={state} />
        ) : hasQualifying(state.stage.format) ? (
          <QualifyingView state={state} finishedMatchId={bracketFinishedId} phase={groupPhase} />
        ) : state.stage.format === 'league' ? (
          <LeagueTable
            matches={state.matches}
            participants={state.participants}
            standings={state.standings ?? []}
            finishedMatchId={bracketFinishedId}
            fit
          />
        ) : (
          <BracketView
            matches={state.matches}
            participants={state.participants}
            finishedId={bracketFinishedId}
            focusId={state.armedMatchId ?? finished?.id ?? null}
            view={state.bracketView}
            fit
          />
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'stretch', justifyContent: 'center',
    background: BG_ROOT, fontFamily: FONT_UI, gap: 16, padding: '20px 16px',
    boxSizing: 'border-box', overflow: 'hidden',
  },

  titleWrap: {
    textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8,
    alignItems: 'center', flexShrink: 0,
  },
  eyebrow: { fontSize: 14, color: TEXT_SECONDARY, letterSpacing: '0.1em' },
  title:   { fontSize: 34, fontWeight: 800, letterSpacing: '0.05em', color: TEXT_PRIMARY },
  sub:     { fontSize: 16, color: TEXT_SECONDARY },

  resultLabel: { fontSize: 14, color: TEXT_SECONDARY },
  resultWinner: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  resultAff:   { fontSize: 12, fontWeight: 600, color: TEXT_SECONDARY },
  resultName:  { fontSize: 22, fontWeight: 800, color: TEXT_PRIMARY },

  // 「たった今終わった試合」カード。見出し (試合名 + 勝者) と、区切り線を挟んで
  // 両者の内訳 (勝ち数・ポイント) を1枚にまとめる。別々の要素として浮かせておくより、
  // 1枚のカードの中の「見出し」と「内訳」という関係が伝わる
  matchResultCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
    background: WIN_PALE, border: `2px solid ${WIN_LIGHT}`,
    borderRadius: RADIUS_MD, boxShadow: SHADOW_SM, padding: '12px 32px 18px',
  },
  matchResultHead: { display: 'flex', alignItems: 'center', gap: 14 },
  matchResultDivider: { width: '100%', borderTop: `1px solid ${WIN_LIGHT}` },

  // この画面はプロジェクター投影が前提で、拡大なしの生の px がそのまま会場の
  // スクリーンに出る (figure 側の表とは違い FitArea を挟まない)。SetupWaiting の
  // recapScore (34px) と同じ「離れて読める大きさ」に揃える — 内訳4項目ぶん詰め込む
  // 都合で recapScore よりは一段小さくする
  resultScoreRow: { display: 'flex', alignItems: 'baseline', gap: 14 },
  // 名前欄の幅を左右で揃えて、中央のダッシュが常に同じ位置に来るようにする
  // (SetupWaiting の recapName と同じ考え方)
  resultScoreName: {
    fontSize: 20, fontWeight: 700, color: TEXT_SECONDARY, textAlign: 'center',
    width: 150, flexShrink: 0, lineHeight: 1.25, wordBreak: 'break-word',
  },
  // whiteSpace は明示必須 — 「勝」のような1文字の CJK は既定で前後どこでも折り返せてしまい、
  // 「2」と「勝」が別行になることがある (数字+助数詞なので絶対に割れてはいけない)
  resultScoreNum: {
    fontSize: 26, fontWeight: 700, fontFamily: FONT_NUM, color: TEXT_SECONDARY,
    whiteSpace: 'nowrap',
  },
  resultScoreDash: { fontSize: 20, color: TEXT_MUTED },

  // 残りの高さを全部渡す。中で fit が図を最大化する
  figure: { flex: 1, minHeight: 0, width: '100%' },
};
