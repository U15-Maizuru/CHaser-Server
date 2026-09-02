import { useMemo } from 'react';
import type { DisplayPrefs, GameEndPayload, TournamentLane } from '@u15/ws-types';
import { Winner } from '@u15/ws-types';
import { useElementSize } from '../hooks/useElementSize';
import { useGameState } from '../hooks/useGameState';
import { GameBoardCanvas } from './GameBoardCanvas';
import { armedMatchNames } from '../lib/tournamentResult';
import { reasonLabel } from '../lib/resultText';
import {
  BG_ROOT, BG_CARD, COOL_COLOR, HOT_COLOR, TEXT_PRIMARY, TEXT_MUTED,
  RADIUS_MD, SHADOW_SM, FONT_UI, FONT_NUM, WIN_BASE,
} from '../ui';

// ── 並列実行中の観戦画面 ─────────────────────────────────────────────────────
//
// BOT対戦予選を複数レーンで同時に走らせている間、レーンの数だけ盤面を並べる。
//
// **枠ごとに別のルームへ WebSocket をつなぐ。** 1本のソケットは1つのルームにしか
// join できない (WsServer.joinWsToRoom が古い部屋から外す) ので、レーンぶんの
// useGameState を子コンポーネントに分けて持たせる。「1枠 = 1コンポーネント」に
// してあるのは、枠数が変わってもフックの数が1つのコンポーネントの中で増減しないため。
//
// **MainWindow は使わない。** あちらは横長の窓 1つを [サイドパネル|盤面|サイドパネル] で
// 割る作りなので、縦長の枠に入れると左右のパネルが幅を食って盤面が切手大になり、
// パネルの下に巨大な空白が残る。枠に要るのは「誰と誰が、今どうなって
// いるか」だけなので、細いヘッダーと盤面だけで組む。
//
// **SE は鳴らさない。** N面ぶんの決着音・ターン音が重なると何も聞き取れなくなるので、
// 音は親 (DisplayMode) が鳴らす BGM 1本だけにする。ここで useGamePhaseSound を
// 呼ばないことがそのまま「SE 無し」になっている。

export function MultiLaneDisplay({ wsUrl, lanes, prefs }: {
  wsUrl:  string;
  lanes:  TournamentLane[];
  prefs:  DisplayPrefs;
}) {
  // 3枠までは横一列、4枠は 2×2。会場のスクリーンは横長なので、縦に積むより
  // 横へ並べたほうが1枠あたりの盤面が大きく映る
  const columns = lanes.length <= 3 ? Math.max(1, lanes.length) : 2;

  return (
    <div style={{ ...s.root, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {lanes.map((lane, i) => (
        <LanePane key={lane.roomId} wsUrl={wsUrl} roomId={lane.roomId} index={i} prefs={prefs} />
      ))}
    </div>
  );
}

function LanePane({ wsUrl, roomId, index, prefs }: {
  wsUrl:  string;
  roomId: string;
  index:  number;
  prefs:  DisplayPrefs;
}) {
  const { snapshot, gameEnd, serverStatus, isConnected, tournamentState } =
    useGameState(wsUrl, roomId);

  const armedMatchId =
    tournamentState?.lanes.find(l => l.roomId === roomId)?.armedMatchId ?? null;

  // **この枠に映すのはこのレーンの試合。** payload の armedMatchId は主レーンのものなので、
  // そのまま渡すと全枠が同じ選手名になってしまう
  const forLane = useMemo(
    () => (tournamentState ? { ...tournamentState, armedMatchId } : null),
    [tournamentState, armedMatchId],
  );

  const doubleMode   = serverStatus?.doubleMode   ?? false;
  const currentRound = serverStatus?.currentRound ?? 0;
  // 大会登録名を優先し、無ければプログラムの自己申告名 (MainWindow と同じ規則)
  const names = armedMatchNames(forLane, currentRound) ?? snapshot?.playerNames ?? null;
  // 第2ゲームは先攻・後攻が入れ替わるぶん盤面も180°反転する (MainWindow と同じ条件)
  const flip  = doubleMode && currentRound === 1;

  const { ref: boardRef, size } = useElementSize();
  // 決着の帯ぶんを常に空けておく。**出たときに空けるのでは駄目** — 盤面が数十ピクセル
  // 跳ね上がって、決着の瞬間にいちばん見てほしい盤面が動いてしまう
  const cell = cellSizeFor(
    { width: size.width, height: size.height - RESULT_SLOT_H }, snapshot?.size ?? null,
  );

  return (
    <div style={s.pane}>
      <div style={s.header}>
        <span style={s.lane}>レーン{index + 1}</span>
        <span style={{ ...s.name, color: COOL_COLOR }}>{names?.[0] ?? '---'}</span>
        <span style={{ ...s.score, color: COOL_COLOR }}>{snapshot?.teamScore[0] ?? 0}</span>
        <span style={s.dash}>—</span>
        <span style={{ ...s.score, color: HOT_COLOR }}>{snapshot?.teamScore[1] ?? 0}</span>
        <span style={{ ...s.name, color: HOT_COLOR }}>{names?.[1] ?? '---'}</span>
        {/* 決着後は消す。「残り 93」と「〜の勝ち」が並ぶと、まだ続いているように読める */}
        {snapshot && !gameEnd && <span style={s.turn}>残り {snapshot.turnCount}</span>}
      </div>

      {/* 盤面。**大きさは常にこの箱を測って決める。** 中の canvas は絶対配置なので、
          canvas の大きさが箱の大きさに跳ね返らない (測定 → 反映 → 再測定 の循環を作らない) */}
      <div ref={boardRef} style={s.board}>
        {snapshot && cell > 0 ? (
          // **決着の帯は盤面の直下に置く。** 枠の下端に貼り付けると、正方形に近いマップでは
          // 盤面との間に空白が数百ピクセル空き、どの対戦の結果なのか読み取れなくなる
          <div style={s.boardInner}>
            <GameBoardCanvas
              snapshot={snapshot}
              flip={flip}
              theme={prefs.theme}
              cellSize={cell}
              veilAlpha={prefs.veilAlpha}
            />
            <div style={s.resultSlot}>
              {gameEnd && <ResultBand gameEnd={gameEnd} names={names} />}
            </div>
          </div>
        ) : (
          <div style={s.idle}>
            {names
              ? <span style={s.idleName}>{names[0]} vs {names[1]}</span>
              : <span>{isConnected ? '次の対戦を準備しています' : '接続中...'}</span>}
            {gameEnd && <ResultBand gameEnd={gameEnd} names={names} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 決着の帯の高さ。**盤面の大きさを決めるときから引いておく**ので、定数で持つ
 * (帯が出た瞬間に盤面が跳ねないため)。
 */
const RESULT_SLOT_H = 40;

/** 決着したレーンの盤面直下に出す一行。枠が小さいので勝敗と決め手だけ */
function ResultBand({ gameEnd, names }: {
  gameEnd: GameEndPayload;
  names:   [string, string] | null;
}) {
  const winnerIdx = gameEnd.winner === Winner.COOL ? 0 : gameEnd.winner === Winner.HOT ? 1 : null;
  const label = winnerIdx === null
    ? '引き分け'
    : `${names?.[winnerIdx] ?? gameEnd.playerNames[winnerIdx]} の勝ち`;
  return (
    <div style={s.result}>
      <span style={s.resultText}>{label}</span>
      <span style={s.resultReason}>{reasonLabel(gameEnd.reason)}</span>
    </div>
  );
}

/** 枠に収まる最大のセルサイズ。マップが未着なら 0 */
function cellSizeFor(
  box: { width: number; height: number },
  map: { x: number; y: number } | null,
): number {
  if (!map || map.x <= 0 || map.y <= 0) return 0;
  if (box.width <= 0 || box.height <= 0) return 0;
  return Math.max(4, Math.min(Math.floor(box.width / map.x), Math.floor(box.height / map.y)));
}

const s: Record<string, React.CSSProperties> = {
  root: {
    height: '100vh', display: 'grid', gap: 10, padding: 10,
    boxSizing: 'border-box', background: BG_ROOT, fontFamily: FONT_UI,
    // minmax(0,1fr) にしないと中身の最小幅に押し広げられて画面からはみ出す
    gridAutoRows: 'minmax(0, 1fr)',
  },
  pane: {
    minWidth: 0, minHeight: 0, overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
    borderRadius: RADIUS_MD, background: BG_CARD, boxShadow: SHADOW_SM,
  },
  // 正方形に近いマップを縦長の枠に入れると縦が3〜4割余るので、そのぶんは見出しに回す。
  // 会場のスクリーンで最初に読まれるのは「誰が何点か」の1行
  header: {
    display: 'flex', alignItems: 'baseline', gap: 8,
    padding: '10px 14px', flexShrink: 0, minWidth: 0,
  },
  lane: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: TEXT_MUTED, flexShrink: 0,
  },
  // 名前は伸び縮みしてよい。長い名前で得点を画面外へ押し出さない
  name: {
    fontSize: 17, fontWeight: 800, minWidth: 0, flex: '1 1 0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  score: { fontSize: 25, fontWeight: 800, fontFamily: FONT_NUM, flexShrink: 0 },
  dash:  { fontSize: 15, color: TEXT_MUTED, flexShrink: 0 },
  turn:  { fontSize: 12, color: TEXT_MUTED, fontFamily: FONT_NUM, flexShrink: 0 },
  board: {
    position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
  },
  // 盤面と決着の帯をひとまとまりにして箱の中央へ絶対配置する
  // (絶対配置なので、中身が伸びても箱の大きさに跳ね返らない)
  boardInner: {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  // 帯の置き場所。**中身の有無にかかわらず同じ高さを占める** (cellSizeFor で引いてある)
  resultSlot: {
    height: RESULT_SLOT_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  idle: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16,
    boxSizing: 'border-box', textAlign: 'center', fontSize: 13, color: TEXT_MUTED,
  },
  idleName: { fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY, wordBreak: 'break-word' },
  result: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10,
    whiteSpace: 'nowrap',
  },
  resultText:   { fontSize: 19, fontWeight: 800, color: WIN_BASE },
  resultReason: { fontSize: 12, color: TEXT_MUTED },
};
