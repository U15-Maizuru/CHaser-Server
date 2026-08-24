import { useEffect, useState } from 'react';
import type { MapCatalogEntry, ResolvedParticipant, RuleSet, TournamentMatch } from '@u15/ws-types';
import {
  BG_CARD, BORDER_COLOR, COOL_COLOR, FONT_NUM, FONT_UI, GOLD_BASE, HOT_COLOR,
  RADIUS_MD, RADIUS_SM, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../../ui';

// 試合結果の確定ダイアログ。
//
// 同点 (winnerSide === null) のときは「確定」を無効化し、公式ルールに沿った3つの出口を出す:
//   ① マップを変更して再試合  ② 審判裁定で勝者を指定  ③ 両者敗退
// これが無いとトーナメントが進まなくなるため、UI 側でも詰みを防ぐ。

export interface ResultConfirmDialogProps {
  match:        TournamentMatch;
  participants: ResolvedParticipant[];
  isLeague:     boolean;
  httpBase:     string;
  /** 大会が固定マップ運用か (再試合で別マップの指定が要る) */
  requireMapChangeOnRematch: boolean;
  /** 得点計算のルールセット。交流大会ルールは「合計ポイント」欄を「合計アイテム数」として見せる */
  ruleSet?:   RuleSet;
  onConfirm:  (winnerSide?: 0 | 1, note?: string) => void;
  onRematch:  (rematchMapCatalogId?: string) => void;
  onWalkover: (winnerSide: 0 | 1 | null) => void;
}

export function ResultConfirmDialog({
  match, participants, isLeague, httpBase, requireMapChangeOnRematch, ruleSet = 'maizuru',
  onConfirm, onRematch, onWalkover,
}: ResultConfirmDialogProps) {
  const isKoryu = ruleSet === 'koryu';
  const totalsLabel = isKoryu ? '獲得アイテム数' : '合計ポイント';
  const [maps, setMaps]       = useState<MapCatalogEntry[]>([]);
  const [mapId, setMapId]     = useState('');
  const [manual, setManual]   = useState<0 | 1 | null>(null);
  const [note, setNote]       = useState('');

  const isTie = match.result?.winnerSide === null;
  // リーグの引き分けは正当な結果なのでそのまま確定できる
  const blocked = isTie && !isLeague;

  useEffect(() => {
    if (!requireMapChangeOnRematch) return;
    void (async () => {
      try {
        const res = await fetch(`${httpBase}/api/maps`);
        setMaps((await res.json() as { entries: MapCatalogEntry[] }).entries ?? []);
      } catch { /* 一覧が取れなくても他の出口は使える */ }
    })();
  }, [httpBase, requireMapChangeOnRematch]);

  const nameOf = (id: string | null) =>
    (id ? participants.find(p => p.id === id)?.name ?? id : '—');

  const totals = match.result?.set?.totals ?? [0, 0];
  const wins   = match.result?.set?.wins ?? [0, 0];
  const sides: { side: 0 | 1; name: string }[] = [
    { side: 0, name: nameOf(match.resolvedA) },
    { side: 1, name: nameOf(match.resolvedB) },
  ];

  return (
    <div style={overlay}>
      <div style={dialog}>
        <h3 style={title}>{match.label} の結果</h3>

        <table style={table}>
          <thead>
            <tr>
              <th style={th}>プレイヤー</th>
              <th style={thNum}>勝</th>
              <th style={thNum}>{totalsLabel}</th>
            </tr>
          </thead>
          <tbody>
            {sides.map(s => (
              <tr key={s.side}>
                <td style={{ ...td, fontWeight: match.result?.winnerSide === s.side ? 700 : 400 }}>
                  {match.result?.winnerSide === s.side && '🏆 '}{s.name}
                </td>
                <td style={tdNum}>{wins[s.side]}</td>
                <td style={tdNum}>{totals[s.side]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {match.result?.set?.decidedBy && (
          <p style={hint}>
            決め手: {match.result.set.decidedBy === 'wins' ? '勝利数' : totalsLabel}
          </p>
        )}

        {blocked ? (
          <div style={tieBox}>
            <div style={tieTitle}>同点です</div>
            <p style={hint}>
              競技ルールでは「マップを変更して再試合」と定められています。
              審判裁定で勝者を決めることもできます。
            </p>

            {/* ① 再試合 */}
            <div style={optionBox}>
              <div style={optionTitle}>① マップを変更して再試合</div>
              {requireMapChangeOnRematch ? (
                <>
                  <select style={select} value={mapId} onChange={e => setMapId(e.target.value)}>
                    <option value="">別のマップを選ぶ…</option>
                    {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                  </select>
                  <button
                    style={{ ...btn, background: COOL_COLOR, opacity: mapId ? 1 : 0.4 }}
                    disabled={!mapId}
                    onClick={() => onRematch(mapId)}
                  >
                    再試合する
                  </button>
                </>
              ) : (
                <>
                  <span style={hint}>ランダムマップなので自動で引き直されます。</span>
                  <button style={{ ...btn, background: COOL_COLOR }} onClick={() => onRematch()}>
                    再試合する
                  </button>
                </>
              )}
            </div>

            {/* ② 手動決着 */}
            <div style={optionBox}>
              <div style={optionTitle}>② 審判裁定で勝者を指定</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {sides.map(s => (
                  <button
                    key={s.side}
                    style={{
                      ...btnChip,
                      background: manual === s.side ? (s.side === 0 ? COOL_COLOR : HOT_COLOR) : '#eee',
                      color: manual === s.side ? '#fff' : TEXT_SECONDARY,
                    }}
                    onClick={() => setManual(s.side)}
                  >
                    {s.name} の勝ち
                  </button>
                ))}
              </div>
              <input
                style={input} placeholder="理由 (抽選・じゃんけん など)"
                value={note} onChange={e => setNote(e.target.value)}
              />
              <button
                style={{ ...btn, background: GOLD_BASE, opacity: manual === null ? 0.4 : 1 }}
                disabled={manual === null}
                onClick={() => onConfirm(manual!, note || undefined)}
              >
                この裁定で確定
              </button>
            </div>

            {/* ③ 両者敗退 */}
            <div style={optionBox}>
              <div style={optionTitle}>③ 両者敗退にする</div>
              <button style={{ ...btn, background: TEXT_MUTED }} onClick={() => onWalkover(null)}>
                両者敗退で確定
              </button>
            </div>
          </div>
        ) : (
          <div style={actions}>
            <button style={{ ...btn, background: '#eee', color: TEXT_SECONDARY }}
                    onClick={() => onRematch()}>
              やり直す
            </button>
            <button style={{ ...btn, background: WIN_BASE }} onClick={() => onConfirm()}>
              この結果で確定 ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  padding: 16,
};

const dialog: React.CSSProperties = {
  background: BG_CARD, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
  padding: 20, width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto',
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
  display: 'flex', flexDirection: 'column', gap: 10,
};

const title: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700 };

const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10, color: TEXT_SECONDARY,
  borderBottom: `1px solid ${BORDER_COLOR}`, padding: '4px 6px', fontWeight: 600,
};
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '6px', borderBottom: `1px solid ${BORDER_COLOR}` };
const tdNum: React.CSSProperties = {
  ...td, textAlign: 'right', fontFamily: FONT_NUM,
};

const hint: React.CSSProperties = {
  margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6,
};

const tieBox: React.CSSProperties = {
  border: `1px solid ${GOLD_BASE}`, background: '#fffaf0',
  borderRadius: RADIUS_SM, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
};

const tieTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#8a6d1f' };

const optionBox: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  background: BG_CARD, borderRadius: 8, padding: 10,
};

const optionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700 };

const actions: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4,
};

const btn: React.CSSProperties = {
  border: 'none', borderRadius: 999, color: '#fff', cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, fontSize: 13, padding: '9px 16px',
};

const btnChip: React.CSSProperties = {
  border: 'none', borderRadius: 999, cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, fontSize: 11, padding: '6px 12px',
};

const select: React.CSSProperties = {
  fontSize: 12, padding: '6px 8px', borderRadius: 8,
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, fontFamily: FONT_UI,
};

const input: React.CSSProperties = {
  fontSize: 12, padding: '6px 8px', borderRadius: 8,
  border: `1px solid ${BORDER_COLOR}`, fontFamily: FONT_UI,
};
