import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TournamentDefinition } from '@u15/ws-types';
import { TournamentEditorDialog } from './TournamentEditorDialog';

// 大会データ作成 UI の検証。ここでの主眼は「フォームの入力が、バックエンドが受け取る
// tournament.json に正しく落ちるか」— 保存経路は既存の取り込み口 (POST /api/tournament/import)
// なので、送信ボディを見れば手書き JSON と同じものが出来ているか確認できる。

const HTTP = 'http://x';

interface Captured { url: string; init?: RequestInit }

let calls: Captured[] = [];
let definitionResponse: { definition: TournamentDefinition; state?: unknown } | null = null;
let existing: { id: string; name: string }[] = [];

function jsonRes(body: unknown, ok = true): Response {
  return {
    ok, status: ok ? 200 : 400, json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  definitionResponse = null;
  existing = [];

  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/programs')) {
      return Promise.resolve(jsonRes({
        entries: [
          { id: 'cat-1', displayName: '舞鶴A v3' },
          { id: 'cat-2', displayName: '舞鶴B v1' },
        ],
      }));
    }
    if (url.endsWith('/api/maps')) {
      return Promise.resolve(jsonRes({ entries: [{ id: 'map-1', displayName: '公式マップ' }] }));
    }
    if (url.endsWith('/api/tournament')) {
      return Promise.resolve(jsonRes({ imported: existing, errors: [] }));
    }
    if (url.includes('/api/tournament/') && url.includes('/assign')) {
      return Promise.resolve(jsonRes({ summary: {}, failed: [] }));
    }
    if (url.includes('/api/tournament/import')) {
      return Promise.resolve(jsonRes({ id: 'new-cup', summary: {} }));
    }
    if (definitionResponse) return Promise.resolve(jsonRes(definitionResponse));
    return Promise.resolve(jsonRes({ error: 'not found' }, false));
  }));
});

// vitest.config は globals を有効にしていないため、testing-library の自動 cleanup は動かない。
// 明示的に片付けないと前のテストのダイアログが DOM に残り、getByLabelText が多重ヒットする
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** 保存時に import へ送られた定義を取り出す */
function sentDefinition(): TournamentDefinition {
  const call = calls.find(c => c.url.includes('/api/tournament/import'));
  if (!call) throw new Error('import が呼ばれていません');
  return JSON.parse(String(call.init?.body)) as TournamentDefinition;
}

function addParticipants(names: string[]) {
  fireEvent.click(screen.getByText('まとめて追加'));
  fireEvent.change(screen.getByLabelText('参加者をまとめて追加'), {
    target: { value: names.join('\n') },
  });
  fireEvent.click(screen.getByText('この内容で追加'));
}

function renderNew() {
  const onSaved = vi.fn();
  render(
    <TournamentEditorDialog httpBase={HTTP} editId={null} onClose={() => {}} onSaved={onSaved} />,
  );
  return onSaved;
}

describe('TournamentEditorDialog — 新規作成', () => {
  it('大会名が空のあいだは保存できない', () => {
    renderNew();
    expect(screen.getByText('この内容で作成')).toBeDisabled();
    expect(screen.getByTestId('editor-validation')).toHaveTextContent('大会名を入力してください');
  });

  it('参加者が1人以下では保存できない', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['舞鶴A']);
    expect(screen.getByTestId('editor-validation')).toHaveTextContent('参加者を2人以上');
    expect(screen.getByText('この内容で作成')).toBeDisabled();
  });

  it('大会ID に使えない文字があると弾く', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    fireEvent.change(screen.getByLabelText('大会ID'), { target: { value: '舞鶴/2026' } });
    addParticipants(['A', 'B']);
    expect(screen.getByTestId('editor-validation')).toHaveTextContent('半角英数字');
  });

  it('参加者名の重複を弾く', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['舞鶴A', '舞鶴A']);
    expect(screen.getByTestId('editor-validation')).toHaveTextContent('重複しています');
  });

  it('既存の大会IDと衝突したら弾く', async () => {
    existing = [{ id: 'cup-a', name: '既存' }];
    renderNew();
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/api/tournament'))).toBe(true));

    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    fireEvent.change(screen.getByLabelText('大会ID'), { target: { value: 'cup-a' } });
    addParticipants(['A', 'B']);
    await waitFor(() =>
      expect(screen.getByTestId('editor-validation')).toHaveTextContent('既に使われています'));
  });

  it('入力内容が tournament.json として送られる', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '第1回 舞鶴杯' } });
    fireEvent.change(screen.getByLabelText('大会ID'), { target: { value: 'maizuru-2026' } });
    addParticipants(['舞鶴A', '舞鶴B', '舞鶴C']);
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(sentDefinition().name).toBe('第1回 舞鶴杯'));
    const def = sentDefinition();
    expect(def.id).toBe('maizuru-2026');
    expect(def.format).toBe('single-elimination');
    expect(def.rules.doubleMode).toBe(true);
    expect(def.rules.mapCatalogId).toBeNull();
    expect(def.participants.map(p => p.name)).toEqual(['舞鶴A', '舞鶴B', '舞鶴C']);
    // 表示順がそのまま選手番号になる (小さいほど第1ゲームで先攻)
    expect(def.participants.map(p => p.seed)).toEqual([1, 2, 3]);
    expect(def.participants.every(p => p.program === null)).toBe(true);
    // 自動組み合わせなので bracket は書き出さない
    expect(def.bracket).toBeUndefined();
  });

  describe('回戦ごとのマップ', () => {
    it('参加者数から回戦の欄が生えて、選んだマップが rules.stageMaps に入る', async () => {
      renderNew();
      fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
      addParticipants(['A', 'B', 'C', 'D']);
      // 4人 = 準決勝と決勝の2回戦。マップ一覧は非同期に届く
      await waitFor(() =>
        expect(screen.getByLabelText('決勝 のマップ')).toHaveTextContent('公式マップ'));
      expect(screen.getByLabelText('準決勝 のマップ')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('決勝 のマップ'), { target: { value: 'map-1' } });
      fireEvent.click(screen.getByText('この内容で作成'));

      await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
      // index が stage。未指定の準決勝は null (大会の設定に従う)
      expect(sentDefinition().rules.stageMaps).toEqual([null, 'map-1']);
    });

    it('参加者を減らして回戦が減ったら、その回戦の指定は保存されない', async () => {
      renderNew();
      fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
      addParticipants(['A', 'B', 'C', 'D']);
      await waitFor(() =>
        expect(screen.getByLabelText('決勝 のマップ')).toHaveTextContent('公式マップ'));
      fireEvent.change(screen.getByLabelText('決勝 のマップ'), { target: { value: 'map-1' } });

      // 2人 = 決勝のみ (stage 0)。旧 stage1 の指定は捨てる
      fireEvent.click(screen.getByLabelText('参加者4 を削除'));
      fireEvent.click(screen.getByLabelText('参加者3 を削除'));
      fireEvent.click(screen.getByText('この内容で作成'));

      await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
      expect(sentDefinition().rules.stageMaps).toEqual([null]);
    });

    it('リーグでは出さない (節ごとのマップは扱わない)', () => {
      renderNew();
      fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'リーグ杯' } });
      addParticipants(['A', 'B', 'C', 'D']);
      fireEvent.click(screen.getByText('リーグ (総当たり)'));
      expect(screen.queryByLabelText('決勝 のマップ')).not.toBeInTheDocument();
    });
  });

  it('並べ替えると選手番号も入れ替わる', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['A', 'B', 'C']);
    fireEvent.click(screen.getByLabelText('参加者3 を上へ'));
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    expect(sentDefinition().participants.map(p => p.name)).toEqual(['A', 'C', 'B']);
  });

  it('削除した参加者は含まれない', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['A', 'B', 'C']);
    fireEvent.click(screen.getByLabelText('参加者2 を削除'));
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    expect(sentDefinition().participants.map(p => p.name)).toEqual(['A', 'C']);
  });

  it('内蔵CPU は定義に、ライブラリのプログラムは assign に振り分けられる', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['A', 'B']);
    // ライブラリの選択肢は非同期に届く。option が生えるまで待たないと change が無視される
    await waitFor(() =>
      expect(screen.getByLabelText('参加者2 のプログラム')).toHaveTextContent('舞鶴B v1'));
    fireEvent.change(screen.getByLabelText('参加者1 のプログラム'), { target: { value: 'cpu' } });
    fireEvent.change(screen.getByLabelText('参加者2 のプログラム'), { target: { value: 'lib:cat-2' } });
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/assign'))).toBe(true));

    const def = sentDefinition();
    // 内蔵CPU は移植できるので配布物である tournament.json に残す
    expect(def.participants[0]!.program).toEqual({ kind: 'builtin', builtin: 'cpu' });
    // ライブラリの ID はこの PC でしか通じないので定義には書かない
    expect(def.participants[1]!.program).toBeNull();

    const assign = calls.find(c => c.url.includes('/assign'))!;
    expect(JSON.parse(String(assign.init?.body))).toEqual({
      assignments: { [def.participants[1]!.id]: 'cat-2' },
    });
  });

  it('リーグを選ぶと勝ち点と2回総当たりが編集でき、定義に入る', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'リーグ杯' } });
    addParticipants(['A', 'B', 'C', 'D']);
    fireEvent.click(screen.getByText('リーグ (総当たり)'));

    expect(screen.getByTestId('editor-preview')).toHaveTextContent('全 6 試合');
    fireEvent.change(screen.getByLabelText('勝ち点 win'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('2回総当たりにする'));

    expect(screen.getByTestId('editor-preview')).toHaveTextContent('全 12 試合');
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    const def = sentDefinition();
    expect(def.format).toBe('league');
    expect(def.rules.leaguePoints).toEqual({ win: 2, draw: 1, loss: 0 });
    expect(def.rules.doubleRoundRobin).toBe(true);
  });

  it('予選リーグ + 決勝トーナメントを作れる', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '予選あり杯' } });
    addParticipants(['A', 'B', 'C', 'D', 'E', 'F']);
    fireEvent.click(screen.getByText('予選リーグ + 決勝トーナメント'));

    // 予選 (3人リーグ×2 = 6試合) + 決勝T (4人 = 3試合)
    expect(screen.getByTestId('editor-preview')).toHaveTextContent('全 9 試合');

    fireEvent.click(screen.getByText('この内容で作成'));
    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));

    const def = sentDefinition();
    expect(def.format).toBe('group-then-bracket');
    expect(def.rules.groupCount).toBe(2);
    expect(def.rules.advancePerGroup).toBe(2);
    // 選手番号順に蛇行 (A,B,B,A,A,B)
    expect(def.participants.map(p => p.group)).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it('参加者のリーグを個別に変えられる', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '予選あり杯' } });
    addParticipants(['A', 'B', 'C', 'D']);
    fireEvent.click(screen.getByText('予選リーグ + 決勝トーナメント'));

    // 2人目 (既定は B リーグ) を A リーグへ移すと、B リーグが1人になって弾かれる
    fireEvent.change(screen.getByLabelText('参加者2 の予選リーグ'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('この内容で作成'));
    expect(screen.getByText(/Bリーグの参加者が2人未満です/)).toBeTruthy();

    // 自動に戻せば保存できる
    fireEvent.click(screen.getByText('自動で振り分け直す'));
    fireEvent.click(screen.getByText('この内容で作成'));
    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    expect(sentDefinition().participants.map(p => p.group)).toEqual([0, 1, 1, 0]);
  });

  it('リーグ数が足りない人数では作成できない', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: '予選あり杯' } });
    addParticipants(['A', 'B', 'C']);
    fireEvent.click(screen.getByText('予選リーグ + 決勝トーナメント'));
    fireEvent.click(screen.getByText('この内容で作成'));
    expect(screen.getByText(/最低4人の参加者が必要です/)).toBeTruthy();
  });

  it('試合数のプレビューが3位決定戦を織り込む', () => {
    renderNew();
    addParticipants(['A', 'B', 'C', 'D']);
    expect(screen.getByTestId('editor-preview')).toHaveTextContent('全 3 試合');
    fireEvent.click(screen.getByText('3位決定戦を行う'));
    expect(screen.getByTestId('editor-preview')).toHaveTextContent('全 4 試合');
  });

  it('固定マップを選ぶと mapCatalogId が入る', async () => {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(['A', 'B']);
    await waitFor(() => expect(screen.getByLabelText('固定マップ')).toHaveTextContent('公式マップ'));
    fireEvent.change(screen.getByLabelText('固定マップ'), { target: { value: 'map-1' } });
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    expect(sentDefinition().rules.mapCatalogId).toBe('map-1');
  });
});

describe('TournamentEditorDialog — 組み合わせの手動指定', () => {
  function setupManual(names: string[]) {
    renderNew();
    fireEvent.change(screen.getByLabelText('大会名'), { target: { value: 'テスト杯' } });
    addParticipants(names);
    fireEvent.click(screen.getByLabelText('組み合わせを手動で指定する'));
  }

  it('既定はシード順の配置で、そのまま保存すると bracket が書き出される', async () => {
    setupManual(['A', 'B', 'C', 'D']);
    fireEvent.click(screen.getByText('この内容で作成'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    const def = sentDefinition();
    const byName = new Map(def.participants.map(p => [p.id, p.name]));
    // size=4 の標準シード順は [1,4,2,3]
    expect(def.bracket!.slots.map(s => (s === null ? null : byName.get(s)))).toEqual(
      ['A', 'D', 'B', 'C'],
    );
  });

  it('同じ参加者を2枠に置くと、元いた枠が空く', () => {
    setupManual(['A', 'B', 'C', 'D']);
    // A (第1試合の先攻) を第2試合の先攻へ移す
    const aId = (screen.getByLabelText('1回戦 第1試合 の先攻') as HTMLSelectElement).value;
    fireEvent.change(screen.getByLabelText('1回戦 第2試合 の先攻'), { target: { value: aId } });

    expect((screen.getByLabelText('1回戦 第1試合 の先攻') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('1回戦 第2試合 の先攻') as HTMLSelectElement).value).toBe(aId);
  });

  it('未配置の参加者がいると保存できない', () => {
    setupManual(['A', 'B', 'C', 'D']);
    fireEvent.change(screen.getByLabelText('1回戦 第1試合 の先攻'), { target: { value: '' } });
    expect(screen.getByTestId('editor-validation')).toHaveTextContent('未配置または重複');
    expect(screen.getByText('この内容で作成')).toBeDisabled();
  });

  it('5人ならスロットが8つになり、bye のカードぶん案内が出る', () => {
    setupManual(['A', 'B', 'C', 'D', 'E']);
    expect(screen.getAllByText(/^第\d試合$/)).toHaveLength(4);
    // 5人をサイズ8に入れるので bye は3つ。それぞれ不戦勝の案内が出る
    expect(screen.getAllByText(/は不戦勝で次の回戦へ進みます/)).toHaveLength(3);
  });

  it('参加者を足しても手動の配置は保たれる', () => {
    setupManual(['A', 'B', 'C', 'D']);
    const first = screen.getByLabelText('1回戦 第1試合 の先攻') as HTMLSelectElement;
    const kept  = first.value;

    fireEvent.click(screen.getByText('+ 1人追加'));
    // サイズが8へ広がっても、置いてあった参加者は同じ枠に残る
    expect(screen.getAllByText(/^第\d試合$/)).toHaveLength(4);
    expect((screen.getByLabelText('1回戦 第1試合 の先攻') as HTMLSelectElement).value).toBe(kept);
  });

  it('リーグに切り替えると組み合わせ欄は消える (総当たりは自動生成)', () => {
    setupManual(['A', 'B', 'C', 'D']);
    expect(screen.getByLabelText('組み合わせを手動で指定する')).toBeInTheDocument();
    fireEvent.click(screen.getByText('リーグ (総当たり)'));
    expect(screen.queryByLabelText('組み合わせを手動で指定する')).not.toBeInTheDocument();
  });
});

describe('TournamentEditorDialog — 編集', () => {
  const DEF: TournamentDefinition = {
    formatVersion: 1,
    id:     'cup-a',
    name:   '既存の杯',
    format: 'single-elimination',
    rules: {
      doubleMode: true, mapCatalogId: null, stageMaps: [], thirdPlaceMatch: true,
      leaguePoints: { win: 3, draw: 1, loss: 0 }, doubleRoundRobin: false, groupCount: 2, advancePerGroup: 2,
    },
    participants: [
      { id: 'x1', name: '舞鶴A', seed: 2, program: { kind: 'builtin', builtin: 'cpu' } },
      { id: 'x2', name: '舞鶴B', seed: 1, program: { kind: 'file', file: 'programs/b.py' } },
      { id: 'x3', name: '舞鶴C', seed: 3, program: null },
    ],
  };

  function renderEdit(def: TournamentDefinition = DEF, state?: unknown) {
    definitionResponse = state === undefined ? { definition: def } : { definition: def, state };
    render(
      <TournamentEditorDialog httpBase={HTTP} editId="cup-a" onClose={() => {}} onSaved={vi.fn()} />,
    );
  }

  it('既存の定義を選手番号順に読み込む', async () => {
    renderEdit();
    await screen.findByDisplayValue('既存の杯');

    const rows = screen.getAllByTestId('participant-row');
    // seed 1,2,3 の順 = 舞鶴B, 舞鶴A, 舞鶴C
    expect(rows.map(r => (within(r).getByPlaceholderText('チーム名') as HTMLInputElement).value))
      .toEqual(['舞鶴B', '舞鶴A', '舞鶴C']);
    expect(screen.getByLabelText('大会ID')).toBeDisabled();
  });

  it('同梱ファイルの指定を保ったまま保存できる', async () => {
    renderEdit();
    await screen.findByDisplayValue('既存の杯');
    fireEvent.click(screen.getByText('上書き保存'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    const def = sentDefinition();
    const b = def.participants.find(p => p.name === '舞鶴B')!;
    expect(b.program).toEqual({ kind: 'file', file: 'programs/b.py' });
    // 定義側で決まる参加者は assign の対象外
    const assign = calls.find(c => c.url.includes('/assign'))!;
    expect(JSON.parse(String(assign.init?.body)).assignments).toEqual({ x3: null });
  });

  it('上書き保存は進行状態も作り直す (reset=1)', async () => {
    renderEdit();
    await screen.findByDisplayValue('既存の杯');
    fireEvent.click(screen.getByText('上書き保存'));

    await waitFor(() => expect(calls.some(c => c.url.includes('/import'))).toBe(true));
    expect(calls.find(c => c.url.includes('/import'))!.url).toContain('reset=1');
  });

  it('割り当て済みのライブラリのプログラムが選択状態で復元される', async () => {
    renderEdit(DEF, {
      participants: [
        { id: 'x1', programCatalogId: null },
        { id: 'x2', programCatalogId: null },
        { id: 'x3', programCatalogId: 'cat-1' },
      ],
    });
    await screen.findByDisplayValue('既存の杯');
    await waitFor(() =>
      expect((screen.getByLabelText('参加者3 のプログラム') as HTMLSelectElement).value)
        .toBe('lib:cat-1'));
  });

  it('明示的な組み合わせがあれば手動モードで開く', async () => {
    renderEdit({ ...DEF, bracket: { size: 4, slots: ['x3', 'x1', 'x2', null] } });
    await screen.findByDisplayValue('既存の杯');
    expect(screen.getByLabelText('組み合わせを手動で指定する')).toBeChecked();
    expect((screen.getByLabelText('1回戦 第1試合 の先攻') as HTMLSelectElement).value).toBe('x3');
  });

  it('読み込みに失敗したら理由を出す', async () => {
    definitionResponse = null; // 定義を返さない → 404 相当
    render(
      <TournamentEditorDialog httpBase={HTTP} editId="cup-a" onClose={() => {}} onSaved={vi.fn()} />,
    );
    expect(await screen.findByTestId('editor-error')).toHaveTextContent('not found');
  });
});
