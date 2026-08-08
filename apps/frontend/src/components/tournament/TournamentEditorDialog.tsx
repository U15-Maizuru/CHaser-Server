import { useEffect, useMemo, useState } from 'react';
import type {
  BotStageRules, CatalogEntry, LeagueRules, MapCatalogEntry, MapPlan, ParticipantDef, StageRules,
  TournamentDefinition, TournamentFormat, TournamentStatePayload, TournamentSummary,
} from '@u15/ws-types';
import {
  autoGroupAssign, botRulesOf, bracketSizeFor, BOT_PARTICIPANT_ID, groupLabel,
  hasThirdPlaceMatch, leagueRulesOf, stageCountFor, stageLabel,
} from '@u15/ws-types';
import { autoSlots, fitSlots, matchCountOf, slotPairs } from '../../lib/bracketSlots';
import {
  BG_CARD, BG_ROOT, BORDER_COLOR, COOL_COLOR, FONT_UI, GOLD_BASE, HOT_COLOR,
  RADIUS_MD, RADIUS_SM, SHADOW_MD, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WIN_BASE,
} from '../../ui';

// 大会データ (tournament.json) を画面で作る / 直すためのダイアログ。
//
// 保存先は既存の取り込み口と同じ POST /api/tournament/import。つまりこの画面は
// 「tournament.json をフォームで書くための道具」であって、独自の保存経路を持たない。
// 手で書いた JSON・zip で取り込んだ大会と、出来上がるものは完全に同じ。
//
// プログラムの割り当てだけは別扱い: プログラムライブラリの ID はこの PC でしか通じないため
// 配布物である tournament.json には書かず、POST /api/tournament/:id/assign で
// state.json 側へ保存する (内蔵CPU と同梱ファイルは移植できるので定義に残す)。

export interface TournamentEditorDialogProps {
  httpBase: string;
  /** 編集する大会 id。null なら新規作成 */
  editId:   string | null;
  onClose:  () => void;
  onSaved:  (id: string) => void;
}

/** 参加者1人ぶんの編集状態 */
interface DraftParticipant {
  /** React の key。id を書き換えても行が作り直されないように別に持つ */
  key:  string;
  id:   string;
  name: string;
  /** '' 未提出 / 'cpu' 内蔵CPU / 'file' 同梱ファイル / 'lib:<catalogId>' ライブラリ */
  program: string;
  /** program==='file' のときの元指定。編集で失わないよう保持する */
  file?: { file: string; displayName?: string };
  /**
   * 直前にプログラム側の宣言名 (CatalogEntry.declaredName) から自動で入れた name。
   * name がこれと一致している間は「まだ手を入れていない初期値」とみなして
   * プログラムの選び直しに追従させ、一致しなくなったら手入力として保護する。
   * 保存対象ではない (buildDefinition は name しか見ない)。
   */
  nameFromProgram?: string;
  /** 所属する予選リーグ。undefined は「自動で振り分ける」 */
  group?: number;
}

/**
 * フォームの平坦な下書きを、形式ごとの StageRules に組み直す。
 *
 * フォームは形式を切り替えても入力値を保持したい (行き来しても消えない) ので全項目を
 * 平坦に持つ。保存するときだけ、その形式が意味を持つ項目だけを取り出す。
 */
function buildStageRules(
  format: TournamentFormat,
  map:    MapPlan,
  league: LeagueRules,
  extra:  { thirdPlaceMatch: boolean; groupCount: number; advancePerGroup: number; bot: BotStageRules },
): StageRules {
  const { thirdPlaceMatch, groupCount, advancePerGroup, bot } = extra;
  switch (format) {
    case 'single-elimination': return { format, map, thirdPlaceMatch };
    case 'league':             return { format, map, league };
    case 'group-then-bracket':
      return { format, map, thirdPlaceMatch, league, groupCount, advancePerGroup };
    case 'bot-then-bracket':
      return { format, map, thirdPlaceMatch, bot, advanceCount: advancePerGroup };
  }
}

/**
 * 予選ありの試合数の見積り。
 *
 * 予選は各リーグの総当たり (n人なら nC2)、決勝は勝ち上がりのぶん。
 * bracketSlots.matchCountOf は予選を知らないのでここで数える。
 */
function groupPreview(
  count: number, groupCount: number, advancePerGroup: number,
  opts: { thirdPlaceMatch: boolean; doubleRoundRobin: boolean },
): number {
  const sizes = Array.from({ length: groupCount }, (_, g) =>
    autoGroupAssign(count, groupCount).filter(x => x === g).length);
  const league = sizes.reduce((sum, n) => sum + (n * (n - 1)) / 2, 0)
    * (opts.doubleRoundRobin ? 2 : 1);

  const qualifiers = groupCount * advancePerGroup;
  const size = bracketSizeFor(qualifiers);
  const bracket = size < 2 ? 0 : size - 1;
  return league + bracket + (opts.thirdPlaceMatch && size >= 4 ? 1 : 0);
}

/**
 * BOT対戦予選ありの試合数の見積り。
 * 予選は参加者ごとに BOT との1試合、決勝は進出者ぶんの勝ち上がり。
 */
function botPreview(
  count: number, advanceCount: number, opts: { thirdPlaceMatch: boolean },
): number {
  const size    = bracketSizeFor(Math.min(advanceCount, count));
  const bracket = size < 2 ? 0 : size - 1;
  return count + bracket + (opts.thirdPlaceMatch && size >= 4 ? 1 : 0);
}

const FORMAT_CHIP: Record<TournamentFormat, string> = {
  'single-elimination': 'トーナメント (勝ち上がり)',
  'league':             'リーグ (総当たり)',
  'group-then-bracket': '予選リーグ + 決勝トーナメント',
  'bot-then-bracket':   'BOT対戦予選 + 決勝トーナメント',
};

/** 数値入力を範囲に収める (空欄・非数値は既定値へ) */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

/** 既定の大会 id (フォルダ名になるので ASCII のみ) */
function defaultId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `cup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
       + `-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** 別名保存の初期 id。`-2`, `-3` … と空いている番号を探す */
function suggestCopyId(base: string, taken: string[]): string {
  const root = base.replace(/-\d+$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

function nextParticipantId(taken: Set<string>): string {
  for (let i = 1; ; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    if (!taken.has(id)) return id;
  }
}

function newParticipant(taken: Set<string>, name: string): DraftParticipant {
  const id = nextParticipantId(taken);
  return { key: `${id}-${Math.random().toString(36).slice(2, 8)}`, id, name, program: '' };
}

export function TournamentEditorDialog({
  httpBase, editId, onClose, onSaved,
}: TournamentEditorDialogProps) {
  const [id, setId]         = useState(editId ?? defaultId());
  const [name, setName]     = useState('');
  const [format, setFormat] = useState<TournamentFormat>('single-elimination');

  const [doubleMode, setDoubleMode]             = useState(true);
  const [thirdPlaceMatch, setThirdPlaceMatch]   = useState(false);
  const [doubleRoundRobin, setDoubleRoundRobin] = useState(false);
  const [mapCatalogId, setMapCatalogId]         = useState('');
  /** 回戦ごとのマップ。index が stage、'' は「大会の設定に従う」 */
  const [stageMaps, setStageMaps]               = useState<string[]>([]);
  const [leaguePoints, setLeaguePoints]         = useState({ win: 3, draw: 1, loss: 0 });
  const [groupCount, setGroupCount]             = useState(2);
  const [advancePerGroup, setAdvancePerGroup]   = useState(2);

  // BOT対戦予選。program の書式は参加者と同じ ('' / 'cpu' / 'file' / 'lib:<catalogId>')
  const [botProgram, setBotProgram]         = useState('');
  const [botFile, setBotFile]               = useState<{ file: string; displayName?: string }>();
  const [botName, setBotName]               = useState('');
  const [botStageMap, setBotStageMap]       = useState('');
  const [participantSide, setParticipantSide] = useState<0 | 1>(0);

  const [participants, setParticipants] = useState<DraftParticipant[]>([]);
  const [manualBracket, setManualBracket] = useState(false);
  const [slots, setSlots] = useState<(string | null)[]>([]);

  const [programs, setPrograms] = useState<CatalogEntry[]>([]);
  const [maps, setMaps]         = useState<MapCatalogEntry[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);

  /**
   * 別名保存モード。元の大会を残したまま、新しい id で複製する。
   * 去年の大会データを土台に今年のを作る、予選の組み分けだけ変えた案を作る、といった使い方。
   */
  const [saveAs, setSaveAs]   = useState(false);

  const [bulk, setBulk]       = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(editId !== null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── 読み込み ──
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${httpBase}/api/programs`);
        setPrograms((await res.json() as { entries: CatalogEntry[] }).entries ?? []);
      } catch { /* ライブラリが取れなくても未提出のまま作れる */ }
      try {
        const res = await fetch(`${httpBase}/api/maps`);
        setMaps((await res.json() as { entries: MapCatalogEntry[] }).entries ?? []);
      } catch { /* 同上 */ }
      try {
        const res  = await fetch(`${httpBase}/api/tournament`);
        const body = await res.json() as { imported: TournamentSummary[] };
        setExistingIds((body.imported ?? []).map(s => s.id));
      } catch { /* 重複チェックができないだけ */ }
    })();
  }, [httpBase]);

  useEffect(() => {
    if (editId === null) return;
    void (async () => {
      try {
        const res  = await fetch(`${httpBase}/api/tournament/${encodeURIComponent(editId)}`);
        const body = await res.json() as {
          state?: TournamentStatePayload; definition?: TournamentDefinition; error?: string;
        };
        if (!res.ok || !body.definition) {
          setError(body.error ?? '大会データを読み込めませんでした');
          return;
        }
        applyDefinition(body.definition, body.state ?? null);
      } catch (e) {
        setError(`大会データを読み込めませんでした: ${(e as Error).message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [httpBase, editId]);

  function applyDefinition(def: TournamentDefinition, state: TournamentStatePayload | null) {
    setId(def.id);
    setName(def.name);
    const stage  = def.stage;
    const league = leagueRulesOf(stage);
    const bot    = botRulesOf(stage);

    setFormat(stage.format);
    setDoubleMode(def.match.doubleMode);
    setThirdPlaceMatch(hasThirdPlaceMatch(stage));
    setMapCatalogId(stage.map.catalogId ?? '');
    setStageMaps(stage.map.bracketStages.map(m => m ?? ''));
    if (league) {
      setDoubleRoundRobin(league.doubleRoundRobin);
      setLeaguePoints(league.points);
    }
    if (stage.format === 'group-then-bracket') {
      setGroupCount(stage.groupCount);
      setAdvancePerGroup(stage.advancePerGroup);
    }
    if (stage.format === 'bot-then-bracket') setAdvancePerGroup(stage.advanceCount);
    if (bot) {
      setBotName(bot.name ?? '');
      setBotStageMap(bot.map ?? '');
      setParticipantSide(bot.participantSide);
    }

    // BOT のプログラム。参加者と同じく、ライブラリ割り当ては state 側から拾う
    const botAssigned = state?.participants.find(p => p.isBot)?.programCatalogId ?? null;
    if (bot?.program?.kind === 'builtin') {
      setBotProgram('cpu');
    } else if (bot?.program?.kind === 'file') {
      const f = bot.program;
      setBotFile(f.displayName === undefined
        ? { file: f.file }
        : { file: f.file, displayName: f.displayName });
      setBotProgram('file');
    } else {
      setBotProgram(botAssigned ? `lib:${botAssigned}` : '');
    }

    // 表示順 = 選手番号順 (小さいほど第1ゲームで先攻)。seed 未指定は記載順で後ろへ
    const ordered = [...def.participants]
      .map((p, i) => ({ p, i }))
      .sort((a, b) =>
        (a.p.seed ?? Number.POSITIVE_INFINITY) - (b.p.seed ?? Number.POSITIVE_INFINITY) || a.i - b.i)
      .map(x => x.p);

    const assigned = new Map(
      (state?.participants ?? []).map(p => [p.id, p.programCatalogId] as const),
    );

    setParticipants(ordered.map((p): DraftParticipant => {
      const base: Omit<DraftParticipant, 'program'> = { key: p.id, id: p.id, name: p.name };
      if (p.group !== undefined) base.group = p.group;
      if (p.program?.kind === 'builtin') return { ...base, program: 'cpu' };
      if (p.program?.kind === 'file') {
        const file = p.program.displayName === undefined
          ? { file: p.program.file }
          : { file: p.program.file, displayName: p.program.displayName };
        return { ...base, program: 'file', file };
      }
      const catalogId = assigned.get(p.id);
      return { ...base, program: catalogId ? `lib:${catalogId}` : '' };
    }));

    if (def.stage.format === 'single-elimination' && def.bracket?.slots?.length) {
      setManualBracket(true);
      setSlots(fitSlots(def.bracket.slots, ordered.map(p => p.id)));
    }
  }

  // ── 参加者の編集 ──
  const ids = useMemo(() => participants.map(p => p.id), [participants]);

  /** 参加者を差し替え、手動組み合わせなら配置も追従させる */
  const updateParticipants = (next: DraftParticipant[]) => {
    setParticipants(next);
    if (manualBracket) setSlots(prev => fitSlots(prev, next.map(p => p.id)));
  };

  const addParticipant = () => {
    updateParticipants([...participants, newParticipant(new Set(ids), '')]);
  };

  const addBulk = () => {
    const names = bulk.split('\n').map(s => s.trim()).filter(s => s !== '');
    if (names.length === 0) return;
    const taken = new Set(ids);
    const added = names.map(n => {
      const p = newParticipant(taken, n);
      taken.add(p.id);
      return p;
    });
    updateParticipants([...participants, ...added]);
    setBulk('');
    setShowBulk(false);
  };

  const removeAt = (i: number) => {
    updateParticipants(participants.filter((_, j) => j !== i));
  };

  const moveAt = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= participants.length) return;
    const next = [...participants];
    [next[i], next[j]] = [next[j]!, next[i]!];
    updateParticipants(next);
  };

  const patchAt = (i: number, patch: Partial<DraftParticipant>) => {
    updateParticipants(participants.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  /**
   * プログラムを選び直す。プログラム側に名前が書かれていれば、それをプレイヤー名の
   * 初期値として入れる。対象は「空欄」か「前回そうやって自動で入れた値のまま」の
   * ときだけで、一度手で書いた名前はプログラムを替えても上書きしない。
   * 自動で入れた名前は、名前を書いていないプログラムに替えたら空欄へ戻す
   * (選んでいないプログラム由来の名前が残らないように)。
   */
  const selectProgramAt = (i: number, program: string) => {
    const declared = program.startsWith('lib:')
      ? programs.find(pr => pr.id === program.slice(4))?.declaredName
      : undefined;

    updateParticipants(participants.map((p, j) => {
      if (j !== i) return p;
      const autoFilled = p.nameFromProgram !== undefined && p.name === p.nameFromProgram;
      const next: DraftParticipant = {
        ...p,
        program,
        name: p.name === '' || autoFilled ? declared ?? '' : p.name,
      };
      if (declared === undefined) delete next.nameFromProgram;
      else next.nameFromProgram = declared;
      return next;
    }));
  };

  const toggleManualBracket = (on: boolean) => {
    setManualBracket(on);
    setSlots(on ? autoSlots(ids) : []);
  };

  const setSlotAt = (i: number, value: string | null) => {
    setSlots(prev => {
      const next = [...prev];
      // 同じ参加者が2箇所に入らないよう、元いた枠を空ける
      if (value !== null) {
        const dup = next.indexOf(value);
        if (dup >= 0 && dup !== i) next[dup] = null;
      }
      next[i] = value;
      return next;
    });
  };

  // 表示順 = 選手番号順なので、蛇行配分はその並びにそのまま当たる。
  // **バックエンドの group 省略時と同じ関数を使うこと** — 二重定義するとズレる
  const autoGroups = useMemo(
    () => autoGroupAssign(participants.length, groupCount),
    [participants.length, groupCount],
  );
  const groupOf = (i: number) => participants[i]?.group ?? autoGroups[i] ?? 0;

  const setGroupAt = (i: number, group: number | undefined) => {
    setParticipants(prev => prev.map((p, k) => {
      if (k !== i) return p;
      const next = { ...p };
      if (group === undefined) delete next.group;
      else next.group = group;
      return next;
    }));
  };

  const reassignGroups = () => {
    setParticipants(prev => prev.map(p => {
      const next = { ...p };
      delete next.group;
      return next;
    }));
  };

  // ── 検証 ──
  /** 保存すると新しい大会が増えるか (新規作成 or 別名保存) */
  const creatingNew = editId === null || saveAs;
  /** 上書き保存のまま大会IDを書き換えたか (= フォルダごと改名する) */
  const renaming = editId !== null && !saveAs && id !== editId;

  const validation = useMemo((): string | null => {
    if (name.trim() === '') return '大会名を入力してください';
    if (!ID_RE.test(id)) return '大会ID は半角英数字と . _ - だけで入力してください（フォルダ名になります）';
    // 同じIDへの上書き保存だけは衝突ではない
    if (existingIds.includes(id) && (creatingNew || id !== editId)) {
      return `大会ID "${id}" は既に使われています。別のIDにしてください`;
    }
    if (participants.length < 2) return '参加者を2人以上登録してください';

    const names = new Set<string>();
    for (const p of participants) {
      if (p.name.trim() === '') return '名前が空の参加者がいます';
      if (names.has(p.name.trim())) return `参加者名 "${p.name.trim()}" が重複しています`;
      names.add(p.name.trim());
    }

    if (format === 'single-elimination' && manualBracket) {
      const placed = slots.filter((s): s is string => s !== null);
      if (new Set(placed).size !== participants.length) {
        return '組み合わせに未配置または重複した参加者がいます';
      }
    }

    if (format === 'group-then-bracket') {
      // バックエンドの validateGroupStage と同じ条件。保存してから弾かれるより
      // ここで気づける方がよい
      if (participants.length < groupCount * 2) {
        return `予選${groupCount}リーグには最低${groupCount * 2}人の参加者が必要です`;
      }
      const sizes = Array.from({ length: groupCount }, (_, g) =>
        participants.filter((_, i) => groupOf(i) === g).length);
      const empty = sizes.findIndex(n => n < 2);
      if (empty >= 0) {
        return `${groupLabel(empty)}リーグの参加者が2人未満です`;
      }
      const short = sizes.findIndex(n => n < advancePerGroup);
      if (short >= 0) {
        return `${groupLabel(short)}リーグの人数 (${sizes[short]}人) が進出人数 ${advancePerGroup} に足りません`;
      }
    }

    if (format === 'bot-then-bracket') {
      // バックエンドの validateBotStage と同じ条件。保存してから弾かれるより
      // ここで気づける方がよい
      if (advancePerGroup < 2) {
        return '決勝トーナメント進出人数は2以上にしてください';
      }
      if (participants.length < advancePerGroup) {
        return `決勝トーナメント進出人数 ${advancePerGroup} に対して参加者が足りません`;
      }
      if (botStageMap === '' && mapCatalogId === '') {
        return 'BOT対戦予選のマップを指定してください（全参加者が同じマップで戦う必要があります）';
      }
    }
    return null;
  }, [name, id, editId, creatingNew, existingIds, participants, format, manualBracket, slots,
      groupCount, advancePerGroup, botStageMap, mapCatalogId]);

  const preview =
      format === 'group-then-bracket'
        ? groupPreview(participants.length, groupCount, advancePerGroup,
                       { thirdPlaceMatch, doubleRoundRobin })
    : format === 'bot-then-bracket'
        ? botPreview(participants.length, advancePerGroup, { thirdPlaceMatch })
    : matchCountOf(format, participants.length, { thirdPlaceMatch, doubleRoundRobin });

  // 回戦の数は参加者数だけで決まる (bracketSizeFor の log2)。参加者を足し引きすると増減するので
  // 保存時に切り詰める
  // 予選ありのときは「決勝トーナメントの回戦」だけを対象にする (index も決勝T相対)。
  // 予選の節数は参加者数だけでは決まらないので、ここで数えない (backend が解決する)
  const stageCount =
      format === 'single-elimination' ? stageCountFor(participants.length)
    : format === 'group-then-bracket' ? stageCountFor(groupCount * advancePerGroup)
    // BOT対戦予選は1グループなので、進出人数がそのまま決勝T の出場者数
    : format === 'bot-then-bracket'   ? stageCountFor(advancePerGroup)
    : 0;
  const stageMapAt = (stage: number) => stageMaps[stage] ?? '';
  const setStageMapAt = (stage: number, value: string) => {
    setStageMaps(prev => {
      const next = Array.from({ length: Math.max(prev.length, stage + 1) }, (_, i) => prev[i] ?? '');
      next[stage] = value;
      return next;
    });
  };

  // ── 保存 ──
  const buildDefinition = (): TournamentDefinition => {
    const defs: ParticipantDef[] = participants.map((p, i) => ({
      id:      p.id,
      name:    p.name.trim(),
      seed:    i + 1,
      ...(format === 'group-then-bracket' ? { group: groupOf(i) } : {}),
      program: p.program === 'cpu'
        ? { kind: 'builtin', builtin: 'cpu' }
        : p.program === 'file' && p.file
          ? { kind: 'file', ...p.file }
          : null,
    }));

    const map: MapPlan = {
      catalogId: mapCatalogId === '' ? null : mapCatalogId,
      // 回戦数ぶんだけ保存する (参加者を減らして回戦が減ったときの残骸を持ち越さない)
      bracketStages: Array.from({ length: stageCount }, (_, i) => stageMapAt(i) || null),
    };
    const league: LeagueRules = { points: leaguePoints, doubleRoundRobin };

    const def: TournamentDefinition = {
      formatVersion: 1,
      id,
      name:  name.trim(),
      match: { doubleMode },
      stage: buildStageRules(format, map, league, {
        thirdPlaceMatch, groupCount, advancePerGroup,
        bot: {
          // BOT のプログラムは参加者と同じ二層構造 — ライブラリ割り当て (lib:) は
          // 配布物である tournament.json に書かず、/assign で state.json 側へ保存する
          program: botProgram === 'cpu'
            ? { kind: 'builtin', builtin: 'cpu' }
            : botProgram === 'file' && botFile
              ? { kind: 'file', ...botFile }
              : null,
          name: botName.trim() === '' ? null : botName.trim(),
          map:  botStageMap === '' ? null : botStageMap,
          participantSide,
        },
      }),
      participants: defs,
    };

    if (format === 'single-elimination' && manualBracket) {
      def.bracket = { size: slots.length, slots };
    }
    return def;
  };

  const save = async () => {
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      // 上書き保存のときは進行状態も作り直す (形式やルールだけ変えた場合を取りこぼさないため)。
      // 別名保存は新しいフォルダを作るだけなので、元の大会の進行状態には触れない
      const overwrite = !creatingNew || existingIds.includes(id);
      const params = new URLSearchParams();
      if (overwrite) params.set('reset', '1');
      // ID を書き換えたときは、バックエンドに先にフォルダを改名させる
      // (取り込み直しでは programs/*.py が新しいフォルダに付いてこない)
      if (renaming) params.set('from', editId);
      const qs = params.toString();
      const res  = await fetch(`${httpBase}/api/tournament/import${qs ? `?${qs}` : ''}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildDefinition()),
      });
      const body = await res.json() as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? '保存に失敗しました');
        return;
      }

      // ライブラリのプログラム割り当て。内蔵CPU・同梱ファイルは定義側で決まるので触らない
      const assignments: Record<string, string | null> = {};
      for (const p of participants) {
        if (p.program === 'cpu' || p.program === 'file') continue;
        assignments[p.id] = p.program.startsWith('lib:') ? p.program.slice(4) : null;
      }
      // 運営BOT も同じ経路。BOT は participants に居ないので id は予約値
      if (format === 'bot-then-bracket' && botProgram !== 'cpu' && botProgram !== 'file') {
        assignments[BOT_PARTICIPANT_ID] =
          botProgram.startsWith('lib:') ? botProgram.slice(4) : null;
      }
      if (Object.keys(assignments).length > 0) {
        const ares = await fetch(`${httpBase}/api/tournament/${encodeURIComponent(body.id)}/assign`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ assignments }),
        });
        if (!ares.ok) {
          const abody = await ares.json() as { error?: string };
          setError(`大会は保存しましたが、プログラムの割り当てに失敗しました: ${abody.error ?? ''}`);
          return;
        }
      }

      onSaved(body.id);
    } catch (e) {
      setError(`保存に失敗しました: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (pid: string | null) =>
    (pid === null ? '— bye —' : participants.find(p => p.id === pid)?.name || '(名前未入力)');

  return (
    <div style={overlay}>
      <div style={dialog} data-testid="tournament-editor">
        <div style={head}>
          <h2 style={titleStyle}>{editId === null ? '大会データを作る' : '大会データを編集'}</h2>
          <button style={btnGhost} onClick={onClose}>閉じる</button>
        </div>

        {loading ? (
          <div style={empty}>読み込み中…</div>
        ) : (
          <>
            {error && <div style={errorBar} data-testid="editor-error">⚠ {error}</div>}

            {/* ── 基本 ── */}
            <section style={card}>
              <div style={sectionTitle}>大会</div>
              <label style={field}>
                <span style={label}>大会名</span>
                <input
                  style={input} value={name} placeholder="第N回 U15プログラミング大会 舞鶴"
                  aria-label="大会名"
                  onChange={e => setName(e.target.value)}
                />
              </label>
              <label style={field}>
                <span style={label}>大会ID</span>
                <input
                  style={{ ...input, fontFamily: 'monospace' }} value={id} aria-label="大会ID"
                  onChange={e => setId(e.target.value)}
                />
              </label>
              <p style={hint}>
                大会ID は server/tournament/ の下に作られるフォルダ名です。
                {saveAs && ' 別名保存: 新しいIDで複製します。元の大会はそのまま残ります。'}
              </p>
              {renaming && (
                <div style={warnRow}>
                  大会ID を「{editId}」から「{id}」へ変更します。フォルダごと名前が変わるので、
                  元のIDは残りません。元を残したまま複製したいときは「別名で保存」を使ってください。
                </div>
              )}

              <div style={chips}>
                {([
                  'single-elimination', 'league', 'group-then-bracket', 'bot-then-bracket',
                ] as TournamentFormat[]).map(f => (
                  <button
                    key={f}
                    style={{ ...chip, ...(format === f ? chipOn : null) }}
                    onClick={() => setFormat(f)}
                  >
                    {FORMAT_CHIP[f]}
                  </button>
                ))}
              </div>
            </section>

            {/* ── ルール ── */}
            <section style={card}>
              <div style={sectionTitle}>ルール</div>

              <label style={check}>
                <input type="checkbox" checked={doubleMode}
                       onChange={e => setDoubleMode(e.target.checked)} />
                <span>2ゲーム制（先攻・後攻を入れ替えて2ゲームで1試合）</span>
              </label>
              <p style={hint}>公式ルールの試合形式です。外すと1ゲームで決着します（練習用）。</p>

              {/* 1ゲーム制のときだけ意味を持つ。2ゲーム制は先後が入れ替わるので選ぶ余地が無い */}
              {format === 'bot-then-bracket' && !doubleMode && (
                <>
                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>参加者の手番</span>
                    <div style={chips}>
                      {([[0, '先攻'], [1, '後攻']] as [0 | 1, string][]).map(([side, text]) => (
                        <button
                          key={side}
                          style={{ ...chip, ...(participantSide === side ? chipOn : null) }}
                          onClick={() => setParticipantSide(side)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p style={hint}>
                    BOT対戦予選を1ゲーム制で行うときの手番です。
                    <strong>全参加者に同じ手番が当たります</strong> —
                    参加者ごとに選べるものではなく、運営がどちらかに決めるものです。
                  </p>
                </>
              )}

              {format !== 'league' && (
                <label style={check}>
                  <input type="checkbox" checked={thirdPlaceMatch}
                         onChange={e => setThirdPlaceMatch(e.target.checked)} />
                  <span>3位決定戦を行う</span>
                </label>
              )}

              {format === 'group-then-bracket' && (
                <>
                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>予選リーグ数</span>
                    <input
                      type="number" min={2} max={4} style={{ ...input, width: 72 }}
                      aria-label="予選リーグ数"
                      value={groupCount}
                      onChange={e => setGroupCount(clampInt(e.target.value, 2, 4, 2))}
                    />
                  </div>
                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>各リーグの進出人数</span>
                    <input
                      type="number" min={1} max={4} style={{ ...input, width: 72 }}
                      aria-label="各リーグの進出人数"
                      value={advancePerGroup}
                      onChange={e => setAdvancePerGroup(clampInt(e.target.value, 1, 4, 2))}
                    />
                  </div>
                  <p style={hint}>
                    予選は各リーグの総当たり。上位 {advancePerGroup} 名ずつ、
                    合計 {groupCount * advancePerGroup} 名が決勝トーナメントへ進みます。
                    同点で順位が決まらないときは、運営画面で進出者を選び直せます。
                  </p>
                </>
              )}

              {format === 'bot-then-bracket' && (
                <>
                  <div style={{ ...sectionTitle, fontSize: 12, marginTop: 4 }}>BOT対戦予選</div>
                  <p style={hint}>
                    全参加者が<strong>同じ BOT・同じマップ</strong>と1試合ずつ戦い、
                    獲得ポイントで順位を決めます（同点は 一撃ボーナス → アイテムポイント の順で比べ、
                    それでも並んだら運営が決めます）。
                  </p>

                  <label style={field}>
                    <span style={label}>BOTのプログラム</span>
                    <select
                      style={{ ...select, flex: 1, minWidth: 0 }} value={botProgram}
                      aria-label="BOTのプログラム"
                      onChange={e => setBotProgram(e.target.value)}
                    >
                      <option value="">未提出（当日割り当て）</option>
                      <option value="cpu">内蔵CPU</option>
                      {botFile && <option value="file">同梱: {botFile.file}</option>}
                      {programs.map(pr => (
                        <option key={pr.id} value={`lib:${pr.id}`}>{pr.displayName}</option>
                      ))}
                    </select>
                  </label>

                  <label style={field}>
                    <span style={label}>BOTの表示名</span>
                    <input
                      style={{ ...input, flex: 1, minWidth: 0 }} value={botName}
                      aria-label="BOTの表示名" placeholder="運営BOT"
                      onChange={e => setBotName(e.target.value)}
                    />
                  </label>

                  <label style={field}>
                    <span style={label}>予選のマップ</span>
                    <select
                      style={{ ...select, flex: 1, minWidth: 0 }} value={botStageMap}
                      aria-label="BOT対戦予選のマップ"
                      onChange={e => setBotStageMap(e.target.value)}
                    >
                      <option value="">下の固定マップに従う</option>
                      {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                    </select>
                  </label>
                  <p style={hint}>
                    予選は全員が同じマップで戦います。ここか下の「固定マップ」の
                    <strong>どちらかは必ず指定してください</strong> —
                    毎回ランダム生成では参加者ごとに条件が変わってしまいます。
                  </p>

                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>決勝トーナメント進出人数</span>
                    <input
                      type="number" min={2} max={16} style={{ ...input, width: 72 }}
                      aria-label="決勝トーナメント進出人数"
                      value={advancePerGroup}
                      onChange={e => setAdvancePerGroup(clampInt(e.target.value, 2, 16, 4))}
                    />
                  </div>
                  <p style={hint}>
                    予選の上位 {advancePerGroup} 名が決勝トーナメントへ進みます。
                  </p>
                </>
              )}

              {/* 総当たりと勝ち点は「参加者どうしが戦うリーグ」のためのもの。
                  BOT対戦予選は勝ち点で順位を付けないので出さない */}
              {(format === 'league' || format === 'group-then-bracket') && (
                <>
                  <label style={check}>
                    <input type="checkbox" checked={doubleRoundRobin}
                           onChange={e => setDoubleRoundRobin(e.target.checked)} />
                    <span>2回総当たりにする</span>
                  </label>
                  <div style={{ ...field, alignItems: 'center' }}>
                    <span style={label}>勝ち点</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                      {(['win', 'draw', 'loss'] as const).map(k => (
                        <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {k === 'win' ? '勝' : k === 'draw' ? '分' : '敗'}
                          <input
                            type="number" style={{ ...input, width: 56 }} aria-label={`勝ち点 ${k}`}
                            value={leaguePoints[k]}
                            onChange={e => setLeaguePoints(p => ({
                              ...p, [k]: Number(e.target.value) || 0,
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <label style={field}>
                <span style={label}>固定マップ</span>
                <select style={select} value={mapCatalogId} aria-label="固定マップ"
                        onChange={e => setMapCatalogId(e.target.value)}>
                  <option value="">毎回ランダム生成</option>
                  {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                </select>
              </label>
              <p style={hint}>
                固定マップにすると全試合が同じマップになります。同点で再試合になったときは
                運営が別のマップを選び直す必要があります。
              </p>

              {/* 回戦ごとのマップ (トーナメントのみ) */}
              {format !== 'league' && stageCount > 0 && (
                <>
                  <div style={{ ...sectionTitle, fontSize: 12, marginTop: 4 }}>回戦ごとのマップ</div>
                  {Array.from({ length: stageCount }, (_, stage) => (
                    <label key={stage} style={field}>
                      <span style={label}>{stageLabel(stage, stageCount)}</span>
                      <select
                        style={{ ...select, flex: 1, minWidth: 0 }}
                        aria-label={`${stageLabel(stage, stageCount)} のマップ`}
                        value={stageMapAt(stage)}
                        onChange={e => setStageMapAt(stage, e.target.value)}
                      >
                        <option value="">
                          上の設定に従う（{mapCatalogId === '' ? '毎回ランダム生成' : '固定マップ'}）
                        </option>
                        {maps.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                      </select>
                    </label>
                  ))}
                  <p style={hint}>
                    回戦ごとに違うマップで戦わせたいときに指定します。大会中でも運営パネルから
                    差し替えられます。
                    {thirdPlaceMatch && ' 3位決定戦は決勝と同じ回戦なので、決勝と同じマップになります。'}
                  </p>
                </>
              )}
            </section>

            {/* ── 参加者 ── */}
            <section style={card}>
              <div style={sectionHead}>
                <span style={sectionTitle}>参加者 ({participants.length}人)</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {format === 'group-then-bracket' && (
                    <button style={btnSmall} onClick={reassignGroups}>自動で振り分け直す</button>
                  )}
                  <button style={btnSmall} onClick={addParticipant}>+ 1人追加</button>
                  <button style={btnSmall} onClick={() => setShowBulk(v => !v)}>まとめて追加</button>
                </div>
              </div>
              <p style={hint}>
                上から順が選手番号です。番号の小さい方が第1ゲームで先攻になります。
                {format === 'group-then-bracket'
                  && ' 予選リーグは選手番号順に蛇行 (A,B,B,A…) で振り分けます。個別に変えられます。'}
              </p>

              {showBulk && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    style={{ ...input, minHeight: 72, resize: 'vertical' }} value={bulk}
                    aria-label="参加者をまとめて追加"
                    placeholder={'1行に1プレイヤー\n舞鶴A\n舞鶴B'}
                    onChange={e => setBulk(e.target.value)}
                  />
                  <button style={btnSmall} onClick={addBulk}>この内容で追加</button>
                </div>
              )}

              {participants.length === 0 && <div style={empty}>参加者がまだいません</div>}

              {participants.map((p, i) => (
                <div key={p.key} style={row} data-testid="participant-row">
                  <span style={seedNo}>{i + 1}</span>
                  <input
                    style={{ ...input, flex: 1, minWidth: 0 }} value={p.name}
                    aria-label={`参加者${i + 1} の名前`} placeholder="プレイヤー名"
                    onChange={e => patchAt(i, { name: e.target.value })}
                  />
                  <select
                    style={{ ...select, width: 190 }} value={p.program}
                    aria-label={`参加者${i + 1} のプログラム`}
                    onChange={e => selectProgramAt(i, e.target.value)}
                  >
                    <option value="">未提出（当日割り当て）</option>
                    <option value="cpu">内蔵CPU</option>
                    {p.file && <option value="file">同梱: {p.file.file}</option>}
                    {programs.map(pr => (
                      <option key={pr.id} value={`lib:${pr.id}`}>{pr.displayName}</option>
                    ))}
                  </select>
                  {format === 'group-then-bracket' && (
                    <select
                      style={{ ...select, width: 84 }}
                      aria-label={`参加者${i + 1} の予選リーグ`}
                      value={p.group ?? ''}
                      onChange={e => setGroupAt(
                        i, e.target.value === '' ? undefined : Number(e.target.value))}
                    >
                      <option value="">自動（{groupLabel(autoGroups[i] ?? 0)}）</option>
                      {Array.from({ length: groupCount }, (_, g) => (
                        <option key={g} value={g}>{groupLabel(g)}リーグ</option>
                      ))}
                    </select>
                  )}
                  <button style={btnIcon} aria-label={`参加者${i + 1} を上へ`}
                          disabled={i === 0} onClick={() => moveAt(i, -1)}>↑</button>
                  <button style={btnIcon} aria-label={`参加者${i + 1} を下へ`}
                          disabled={i === participants.length - 1} onClick={() => moveAt(i, 1)}>↓</button>
                  <button style={{ ...btnIcon, color: HOT_COLOR }}
                          aria-label={`参加者${i + 1} を削除`} onClick={() => removeAt(i)}>✕</button>
                </div>
              ))}
            </section>

            {/* ── 組み合わせ (トーナメントのみ) ── */}
            {format === 'single-elimination' && (
              <section style={card}>
                <div style={sectionHead}>
                  <span style={sectionTitle}>組み合わせ</span>
                  <label style={{ ...check, fontSize: 11 }}>
                    <input type="checkbox" checked={manualBracket}
                           aria-label="組み合わせを手動で指定する"
                           onChange={e => toggleManualBracket(e.target.checked)} />
                    <span>手動で指定する</span>
                  </label>
                </div>

                {!manualBracket ? (
                  <p style={hint}>
                    参加者の並び順から標準シード配置で自動生成します
                    （第1シードと第2シードが決勝まで当たらない配置）。
                    実行委員会が決めた組み合わせがある場合は「手動で指定する」を使ってください。
                  </p>
                ) : (
                  <>
                    <p style={hint}>1回戦の対戦カードです。空きは bye（不戦勝）になります。</p>
                    {slotPairs(slots).map(([a, b], i) => (
                      <div key={i} style={pairRow}>
                        <span style={pairNo}>第{i + 1}試合</span>
                        {[a, b].map((v, k) => (
                          <select
                            key={k} style={{ ...select, flex: 1, minWidth: 0 }} value={v ?? ''}
                            aria-label={`1回戦 第${i + 1}試合 の${k === 0 ? '先攻' : '後攻'}`}
                            onChange={e => setSlotAt(i * 2 + k, e.target.value || null)}
                          >
                            <option value="">— bye —</option>
                            {participants.map(p => (
                              <option key={p.id} value={p.id}>{p.name || '(名前未入力)'}</option>
                            ))}
                          </select>
                        ))}
                      </div>
                    ))}
                    <div style={hint}>
                      {slotPairs(slots)
                        .filter(([a, b]) => a === null || b === null)
                        .map(([a, b], i) => (
                          <div key={i}>
                            {nameOf(a === null ? b : a)} は不戦勝で次の回戦へ進みます
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ── 保存 ── */}
            <div style={footer}>
              <span style={previewText} data-testid="editor-preview">
                {FORMAT_CHIP[format]} ・ {participants.length}人 ・
                全 {preview} 試合{doubleMode ? '（各2ゲーム）' : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btnGhost} onClick={onClose}>キャンセル</button>
                {editId !== null && (
                  <button
                    style={{ ...btnGhostSmall, ...(saving ? btnDisabled : null) }}
                    disabled={saving}
                    onClick={() => setSaveAs(v => {
                      // 別名保存に切り替えた瞬間に、そのままでは重複する id をずらしておく
                      if (!v) setId(cur => suggestCopyId(cur, existingIds));
                      else setId(editId);
                      return !v;
                    })}
                  >
                    {saveAs ? '上書き保存に戻す' : '別名で保存'}
                  </button>
                )}
                <button
                  style={{ ...btnPrimary, ...(validation || saving ? btnDisabled : null) }}
                  disabled={validation !== null || saving}
                  title={validation ?? ''}
                  onClick={() => void save()}
                >
                  {saving ? '保存中…' : editId === null ? 'この内容で作成'
                    : saveAs ? '別名で保存' : renaming ? 'IDを変えて保存' : '上書き保存'}
                </button>
              </div>
            </div>
            {validation && <div style={warnRow} data-testid="editor-validation">⚠ {validation}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(30,24,48,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
  padding: 16,
};

const dialog: React.CSSProperties = {
  background: BG_ROOT, borderRadius: RADIUS_MD, boxShadow: SHADOW_MD,
  padding: 20, width: 'min(680px, 100%)', maxHeight: '92vh', overflowY: 'auto',
  fontFamily: FONT_UI, color: TEXT_PRIMARY,
  display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box',
};

const head: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700 };

const card: React.CSSProperties = {
  background: BG_CARD, border: `1px solid ${BORDER_COLOR}`,
  borderRadius: RADIUS_MD, padding: 14,
  display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
};

const sectionHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
};

const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700 };

const field: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center' };

const label: React.CSSProperties = {
  fontSize: 12, color: TEXT_SECONDARY, width: 72, flexShrink: 0,
};

const hint: React.CSSProperties = {
  margin: 0, fontSize: 11, color: TEXT_SECONDARY, lineHeight: 1.6, overflowWrap: 'anywhere',
};

const empty: React.CSSProperties = {
  padding: 14, textAlign: 'center', color: TEXT_MUTED, fontSize: 12,
};

const input: React.CSSProperties = {
  fontSize: 12, padding: '7px 9px', borderRadius: 8, flex: 1, minWidth: 0,
  border: `1px solid ${BORDER_COLOR}`, fontFamily: FONT_UI, background: BG_CARD,
  color: TEXT_PRIMARY, boxSizing: 'border-box',
};

const select: React.CSSProperties = {
  fontSize: 12, padding: '6px 8px', borderRadius: 8, flexShrink: 0,
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, fontFamily: FONT_UI,
  color: TEXT_PRIMARY,
};

const check: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer',
};

const chips: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 4 };

const chip: React.CSSProperties = {
  border: `1px solid ${BORDER_COLOR}`, background: BG_CARD, color: TEXT_SECONDARY,
  borderRadius: 999, fontFamily: FONT_UI, fontWeight: 700, fontSize: 11,
  padding: '6px 14px', cursor: 'pointer',
};

const chipOn: React.CSSProperties = {
  background: COOL_COLOR, color: '#fff', borderColor: COOL_COLOR,
};

const row: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', minWidth: 0,
};

const seedNo: React.CSSProperties = {
  width: 20, flexShrink: 0, textAlign: 'right', fontSize: 11, color: TEXT_MUTED,
};

const pairRow: React.CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center', minWidth: 0,
};

const pairNo: React.CSSProperties = {
  width: 60, flexShrink: 0, fontSize: 11, color: TEXT_SECONDARY,
};

const footer: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  flexWrap: 'wrap',
};

const previewText: React.CSSProperties = { fontSize: 12, color: TEXT_SECONDARY };

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: 999, cursor: 'pointer',
  fontFamily: FONT_UI, fontWeight: 700, color: '#fff',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase, background: WIN_BASE, fontSize: 13, padding: '9px 18px',
};

const btnDisabled: React.CSSProperties = {
  background: TEXT_MUTED, cursor: 'not-allowed',
};

const btnSmall: React.CSSProperties = {
  ...btnBase, background: COOL_COLOR, fontSize: 11, padding: '5px 12px',
};

const btnGhost: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 12, padding: '6px 12px',
};

const btnGhostSmall: React.CSSProperties = {
  ...btnGhost, border: `1px solid ${BORDER_COLOR}`,
};

const btnIcon: React.CSSProperties = {
  border: 'none', background: 'transparent', color: TEXT_SECONDARY,
  fontSize: 13, padding: '4px 6px', cursor: 'pointer', flexShrink: 0,
};

const errorBar: React.CSSProperties = {
  background: '#fff0f0', border: `1px solid ${HOT_COLOR}`, color: HOT_COLOR,
  borderRadius: RADIUS_SM, padding: '8px 12px', fontSize: 12,
};

const warnRow: React.CSSProperties = {
  background: '#fffaf0', border: `1px solid ${GOLD_BASE}`, color: '#8a6d1f',
  borderRadius: 8, padding: '6px 10px', fontSize: 11,
};
