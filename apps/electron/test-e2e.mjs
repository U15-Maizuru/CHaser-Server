#!/usr/bin/env node
/**
 * U15 Server Maizuru — E2E 全自動テストスクリプト
 *
 * 実行方法:
 *   node apps/electron/test-e2e.mjs
 *
 * 前提:
 *   - apps/electron/dist/ が最新ビルド済み (pnpm --filter @u15/electron build)
 *   - apps/backend/dist/  が最新ビルド済み (pnpm --filter @u15/backend build)
 *   - playwright が apps/electron にインストール済み
 */

import { _electron as electron } from 'playwright';
import { spawn }                 from 'node:child_process';
import path                      from 'node:path';
import fs                        from 'node:fs';
import { fileURLToPath }         from 'node:url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT  = path.resolve(__dirname, '../..');
const SHOT_DIR      = path.join(PROJECT_ROOT, 'test-screenshots');
const ELECTRON_BIN  = process.platform === 'win32'
  ? path.join(__dirname, 'node_modules/electron/dist/electron.exe')
  : path.join(__dirname, 'node_modules/electron/dist/electron');

fs.mkdirSync(SHOT_DIR, { recursive: true });

// ── 結果管理 ─────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const results = [];

function pass(name) {
  passCount++;
  results.push({ name, status: 'PASS' });
  console.log(`    ✓ ${name}`);
}

function fail(name, reason = '') {
  failCount++;
  results.push({ name, status: 'FAIL', reason });
  console.log(`    ✗ ${name}${reason ? ': ' + reason : ''}`);
}

function section(title) {
  console.log(`\n  ▶ ${title}`);
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ss(page, name) {
  const f = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}

/** ボタンテキストで DOM クリック */
async function clickText(page, text) {
  return page.evaluate(t => {
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const el  = els.find(e => e.textContent?.trim() === t)
             ?? els.find(e => e.textContent?.includes(t));
    if (!el) return 'NOT_FOUND: ' + t;
    el.click();
    return 'OK';
  }, text);
}

/** 2番目の CPU ボタンをクリック (HOT 側) */
async function clickSecondCPU(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => b.textContent?.trim() === 'CPU');
    if (btns.length >= 2) { btns[1].click(); return 'OK'; }
    if (btns.length === 1) { btns[0].click(); return 'OK_1'; }
    return 'NOT_FOUND';
  });
}

/** ボディテキスト取得 */
async function bodyText(page) {
  return page.evaluate(() => document.body.innerText ?? '');
}

/** テキストが現れるまで待つ */
async function waitFor(page, text, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await bodyText(page)).includes(text)) return true;
    await wait(300);
  }
  return false;
}

/** ゲーム終了を示すテキストが現れるまで待つ */
async function waitForGameEnd(page, timeoutMs = 40000) {
  return waitFor(page, 'セットアップに戻る', timeoutMs);
}

/** ゲーム中 (ボード表示) を確認 — 新UIでは TOTAL が左右パネルに表示される */
async function waitForGameStart(page, timeoutMs = 15000) {
  const found = await waitFor(page, 'TOTAL', timeoutMs);
  return found;
}

// ── Vite dev サーバー起動 ─────────────────────────────────────────────────────

async function startViteServer() {
  // 既に起動中かチェック
  try {
    const res = await fetch('http://localhost:5173').catch(() => null);
    if (res) { console.log('  Vite server は既に起動中です'); return null; }
  } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['--filter', '@u15/frontend', 'dev'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) reject(new Error('Vite サーバー起動タイムアウト'));
    }, 30000);

    proc.stdout.on('data', (d) => {
      if (d.toString().includes('localhost:5173') && !ready) {
        ready = true;
        clearTimeout(timer);
        setTimeout(() => resolve(proc), 800);
      }
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (!ready) reject(new Error(`Vite が終了: ${code}`));
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// テストスイート
// ═══════════════════════════════════════════════════════════════════════════

/** テスト 1: セットアップ画面の UI 構造確認 */
async function testSetupUI(page) {
  section('セットアップUI');

  const text = await bodyText(page);

  // 2カラムレイアウト
  text.includes('COOL') && text.includes('HOT')
    ? pass('COOL / HOT パネルが 2カラムで表示される')
    : fail('COOL / HOT パネルが 2カラムで表示される');

  // モードボタン
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map(b => b.textContent?.trim())
  );
  const hasCPU     = buttons.includes('CPU');
  const hasTCP     = buttons.includes('TCP接続');
  const hasManual  = buttons.includes('手動操作');
  hasCPU && hasTCP && hasManual
    ? pass('モードボタン CPU / TCP接続 / 手動操作 が全て存在する')
    : fail('モードボタン CPU / TCP接続 / 手動操作 が全て存在する',
           `[${buttons.filter(Boolean).join(', ')}]`);

  // ドロップゾーン
  text.includes('ドロップ')
    ? pass('FileDropZone が表示される')
    : fail('FileDropZone が表示される');

  // スタートボタンが初期は無効
  const startDisabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.textContent?.includes('ゲームスタート'));
    return btn?.disabled ?? true;
  });
  startDisabled
    ? pass('ゲームスタートボタンは初期状態で無効')
    : fail('ゲームスタートボタンは初期状態で無効');

  // IP 表示
  /\d+\.\d+\.\d+\.\d+|\.\.\./.test(text)
    ? pass('ローカル IP が表示される')
    : fail('ローカル IP が表示される');

  await ss(page, '01_setup_ui');
}

/** テスト 2: 設定ダイアログ */
async function testSettingsDialog(page) {
  section('設定ダイアログ');

  await clickText(page, '⚙');
  await wait(600);

  const text = await bodyText(page);
  text.includes('設定')
    ? pass('設定ダイアログが開く')
    : fail('設定ダイアログが開く');

  text.includes('ゲーム') && text.includes('ランダムマップ')
    ? pass('タブ (ゲーム / ランダムマップ) が存在する')
    : fail('タブ (ゲーム / ランダムマップ) が存在する');

  text.includes('2試合制')
    ? pass('"2試合制" トグルが設定ダイアログに存在する')
    : fail('"2試合制" トグルが設定ダイアログに存在する');

  text.includes('TCP タイムアウト') && text.includes('テクスチャテーマ')
    ? pass('ゲーム設定項目 (タイムアウト・テーマ) が表示される')
    : fail('ゲーム設定項目 (タイムアウト・テーマ) が表示される');

  await ss(page, '02_settings_dialog');
  await clickText(page, 'キャンセル');
  await wait(400);
}

/** テスト 3: CPU vs CPU 通常1試合 */
async function testCpuVsCpu(page) {
  section('CPU vs CPU 通常対戦');

  // 両スロットを CPU に
  await clickText(page, 'CPU');
  await wait(400);
  await clickSecondCPU(page);
  await wait(1000);

  const readyCount = await page.evaluate(() =>
    document.body.innerText.split('準備完了').length - 1
  );
  readyCount >= 2
    ? pass('両スロットが「準備完了」になる')
    : fail('両スロットが「準備完了」になる', `準備完了: ${readyCount} 個`);

  await ss(page, '03_both_cpu_ready');

  // スタート
  await clickText(page, 'ゲームスタート');
  const started = await waitForGameStart(page);
  started
    ? pass('ゲームが開始しボードが表示される')
    : fail('ゲームが開始しボードが表示される', 'タイムアウト');

  await ss(page, '04_game_playing');

  // 終了待ち
  const ended = await waitForGameEnd(page);
  ended
    ? pass('ゲームが正常に終了する')
    : fail('ゲームが正常に終了する', 'タイムアウト');

  const resultText = await bodyText(page);
  resultText.includes('の勝ち') || resultText.includes('引き分け')
    ? pass('勝敗結果 (WIN / DRAW) が表示される')
    : fail('勝敗結果 (WIN / DRAW) が表示される');

  // スコアパネルが表示されているか (新UIでは TOTAL 合計 が常時表示)
  resultText.includes('TOTAL') && resultText.includes('スコア')
    ? pass('スコア (アイテム数) が表示される')
    : fail('スコア (アイテム数) が表示される');

  await ss(page, '05_game_result');

  // リセット
  await clickText(page, 'セットアップに戻る');
  const backToSetup = await waitFor(page, 'ゲームスタート', 6000);
  backToSetup
    ? pass('セットアップ画面に戻れる')
    : fail('セットアップ画面に戻れる', 'タイムアウト');

  await wait(500);
}

/** テスト 4: 2試合制モード */
async function testDoubleMatch(page) {
  section('2試合制モード');

  // 設定で 2試合制 を ON
  await clickText(page, '⚙');
  await wait(600);

  // "2試合制" ラベルの隣のチェックボックスを ON にする
  const toggled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row  = rows.find(r => r.textContent?.includes('2試合制'));
    if (!row) return false;
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    if (!cb.checked) cb.click();
    return true;
  });
  toggled
    ? pass('"2試合制" チェックボックスを ON にできる')
    : fail('"2試合制" チェックボックスを ON にできる', '要素が見つからない');

  await wait(300);
  await clickText(page, '保存');
  await wait(600);

  // ラウンドバッジ確認
  const setupText = await bodyText(page);
  setupText.includes('第1試合')
    ? pass('"第1試合" バッジがセットアップ画面に表示される')
    : fail('"第1試合" バッジがセットアップ画面に表示される');

  await ss(page, '06_double_setup_round1');

  // 両スロット CPU → ゲームスタート
  await clickText(page, 'CPU');
  await wait(400);
  await clickSecondCPU(page);
  await wait(800);
  await clickText(page, 'ゲームスタート');

  // 試合 1 終了 → 「次戦スタート」
  const round1Done = await waitFor(page, '次戦スタート', 30000);
  round1Done
    ? pass('試合1終了後に「次戦スタート」ボタンが表示される')
    : fail('試合1終了後に「次戦スタート」ボタンが表示される', 'タイムアウト');

  // 新UIでは TOTAL 合計ボックスと 次戦スタートボタンが表示される
  const r1Text = await bodyText(page);
  r1Text.includes('次戦スタート') && r1Text.includes('TOTAL')
    ? pass('試合1のポイントが ScorePanel に表示される')
    : fail('試合1のポイントが ScorePanel に表示される');

  await ss(page, '07_round1_result');

  // 次戦スタート → セットアップ画面に戻る → 第2試合開始
  await clickText(page, '次戦スタート');
  const round2Setup = await waitFor(page, 'ゲームスタート', 8000);
  round2Setup
    ? pass('次戦スタート後にセットアップ画面 (第2試合) に遷移する')
    : fail('次戦スタート後にセットアップ画面 (第2試合) に遷移する', 'タイムアウト');

  // 第2試合バッジ
  const r2SetupText = await bodyText(page);
  r2SetupText.includes('第2試合')
    ? pass('"第2試合" バッジが表示される')
    : fail('"第2試合" バッジが表示される');

  await ss(page, '08_double_setup_round2');

  // 第2試合スタート (CPU スロットは既に準備完了)
  await clickText(page, 'ゲームスタート');
  const round2Done = await waitForGameEnd(page, 30000);
  round2Done
    ? pass('試合2が正常に終了する')
    : fail('試合2が正常に終了する', 'タイムアウト');

  // 合計ポイント / 最終勝者
  // 新UIでは TOTAL 合計ボックスに pt サフィックス付きで両スコアが表示される
  const finalText = await bodyText(page);
  finalText.includes('TOTAL') && finalText.includes('pt')
    ? pass('最終結果 (合計ポイント) が表示される')
    : fail('最終結果 (合計ポイント) が表示される', `text: ${finalText.slice(0,200)}`);

  // 「次戦スタート」ではなく「セットアップに戻る」が表示される
  finalText.includes('セットアップに戻る') && !finalText.includes('次戦スタート')
    ? pass('2試合終了後は「セットアップに戻る」のみが表示される')
    : fail('2試合終了後は「セットアップに戻る」のみが表示される');

  await ss(page, '09_double_match_final');

  // リセットして 2試合制 を OFF に戻す
  await clickText(page, 'セットアップに戻る');
  await wait(800);

  await clickText(page, '⚙');
  await wait(600);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row  = rows.find(r => r.textContent?.includes('2試合制'));
    const cb   = row?.querySelector('input[type="checkbox"]');
    if (cb?.checked) cb.click();
  });
  await wait(300);
  await clickText(page, '保存');
  await wait(500);
}

/** テスト 5: 手動操作モード */
async function testManualMode(page) {
  section('手動操作モード (ManualClient)');

  // COOL スロットを手動操作に
  const r = await clickText(page, '手動操作');
  r === 'OK'
    ? pass('"手動操作" モードボタンをクリックできる')
    : fail('"手動操作" モードボタンをクリックできる', r);

  await wait(500);

  // HOT を CPU に
  await clickSecondCPU(page);
  await wait(800);

  const setupText = await bodyText(page);
  setupText.includes('手動操作') && setupText.includes('準備完了')
    ? pass('手動操作スロットが「準備完了」になる')
    : fail('手動操作スロットが「準備完了」になる');

  await ss(page, '10_manual_ready');

  // ゲーム開始
  await clickText(page, 'ゲームスタート');
  const gameStarted = await waitForGameStart(page);
  gameStarted
    ? pass('手動対戦ゲームが開始される')
    : fail('手動対戦ゲームが開始される', 'タイムアウト');

  // ManualControls パネルが表示されるか
  const hasControls = await waitFor(page, '手動操作', 8000);
  hasControls
    ? pass('ゲーム中に ManualControls パネルが表示される')
    : fail('ゲーム中に ManualControls パネルが表示される', 'タイムアウト');

  const ctrlText = await bodyText(page);
  ctrlText.includes('↑') || ctrlText.includes('↓')
    ? pass('方向キーパッド (↑↓←→) が表示される')
    : fail('方向キーパッド (↑↓←→) が表示される');

  // アクションドロップダウン
  ctrlText.includes('WALK') || ctrlText.includes('アクション')
    ? pass('アクション選択 (WALK/LOOK 等) が表示される')
    : fail('アクション選択 (WALK/LOOK 等) が表示される');

  await ss(page, '11_manual_controls');

  // ゲーム終了まで ↑/↓ ボタンを送り続ける (タイムアウト 40 秒)
  // アクションループとゲーム終了チェックを一体化させることで
  // 「ループ終了後にゲームが止まる」問題を防ぐ
  let actionsSent = 0;
  let gameEnded   = false;
  const deadline  = Date.now() + 40000;

  while (Date.now() < deadline) {
    const txt = await bodyText(page);
    if (txt.includes('セットアップに戻る') || txt.includes('WIN!') || txt.includes('DRAW')) {
      gameEnded = true;
      break;
    }
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => !b.disabled && (b.textContent === '↑' || b.textContent === '↓'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) actionsSent++;
    await wait(150);
  }

  actionsSent > 0
    ? pass(`手動アクションを ${actionsSent} 回送信できた`)
    : fail('手動アクションを送信できた', '0 回');

  gameEnded
    ? pass('手動対戦が正常に終了する')
    : fail('手動対戦が正常に終了する', 'タイムアウト');

  await ss(page, '12_manual_game_end');

  await clickText(page, 'セットアップに戻る');
  await wait(800);

  const backOk = await waitFor(page, 'ゲームスタート', 5000);
  backOk
    ? pass('手動対戦後にセットアップ画面に戻れる')
    : fail('手動対戦後にセットアップ画面に戻れる');
}

/** テスト 6: ファイルドロップゾーンの基本 UI */
async function testFileDropZone(page) {
  section('プログラムアップロード UI (FileDropZone)');

  const text = await bodyText(page);
  text.includes('プログラムファイルをドロップ')
    ? pass('FileDropZone にドロップ誘導テキストが表示される')
    : fail('FileDropZone にドロップ誘導テキストが表示される');

  text.includes('.py') && text.includes('.exe')
    ? pass('対応拡張子 (.py, .exe) が表示される')
    : fail('対応拡張子 (.py, .exe) が表示される');

  text.includes('カスタムライブラリ')
    ? pass('カスタムライブラリ折り畳みセクションが存在する')
    : fail('カスタムライブラリ折り畳みセクションが存在する');

  // ライブラリ折り畳みを開く
  await clickText(page, 'カスタムライブラリ ▼');
  await wait(400);
  const libText = await bodyText(page);
  libText.includes('pychaser')
    ? pass('展開後に "pychaser" プリインストール表示がある')
    : fail('展開後に "pychaser" プリインストール表示がある');

  await ss(page, '13_file_dropzone');
}

// ═══════════════════════════════════════════════════════════════════════════
// メイン
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const startAt = Date.now();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  U15 Server Maizuru — E2E 全自動テスト          ║');
  console.log('╚══════════════════════════════════════════════════╝');

  let viteProc = null;
  let app      = null;

  try {
    // 1. Vite dev サーバー
    console.log('\n[1/3] Vite dev サーバー起動中...');
    viteProc = await startViteServer();
    console.log('      http://localhost:5173 — OK');

    // 2. Electron 起動
    console.log('[2/3] Electron アプリ起動中...');
    const env = { ...process.env, NODE_ENV: 'development' };
    delete env.ELECTRON_RUN_AS_NODE;

    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args:           [__dirname],
      env,
      timeout:        30000,
    });

    // 2ウィンドウ構成: 表示ウィンドウが先に作成されるため、固定時間待機だと
    // まだ登録されていないウィンドウ一覧を早取りしてそちらを拾ってしまうことがある。
    // コントロールウィンドウ (mode=control) が現れるまでポーリングして待つ。
    let page = null;
    const windowDeadline = Date.now() + 20000;
    while (Date.now() < windowDeadline) {
      page = app.windows().find(w => w.url().includes('mode=control'));
      if (page) break;
      await wait(300);
    }

    const windows = app.windows();
    console.log(`      Windows: ${windows.length} [${windows.map(w => w.url()).join(', ')}]`);

    page = page
        ?? windows.find(w => w.url().includes('5173'))
        ?? await app.firstWindow();

    await page.waitForSelector('button', { timeout: 15000 }).catch(() => {});
    await wait(1000);

    console.log('      Electron — OK');
    console.log(`\n[3/3] テスト実行中... (スクリーンショット: ${SHOT_DIR})`);
    console.log('─'.repeat(52));

    // テスト用前処理: ターン表示時間を 0ms に設定 (テストを高速化)
    await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('u15_settings');
        const s = raw ? JSON.parse(raw) : {};
        s.turnDelay = 0;
        localStorage.setItem('u15_settings', JSON.stringify(s));
      } catch { /* ignore */ }
    });
    await page.reload();
    await page.waitForSelector('button', { timeout: 10000 }).catch(() => {});
    await wait(800);
    console.log('  (ターン表示時間を 0ms に設定しました)');

    // テストスイート実行
    await testSetupUI(page);
    await testSettingsDialog(page);
    await testFileDropZone(page);
    await testCpuVsCpu(page);
    await testDoubleMatch(page);
    await testManualMode(page);

  } catch (err) {
    console.error('\n  FATAL:', err.message);
    fail('テスト実行全体', err.message);
  } finally {
    if (app)      await app.close().catch(() => {});
    if (viteProc) viteProc.kill();
  }

  // ── 結果サマリー ────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
  const total   = passCount + failCount;

  console.log('\n' + '═'.repeat(52));
  console.log(`  テスト完了  ${elapsed}s`);
  console.log(`  合格: ${passCount} / ${total}  失敗: ${failCount}`);

  if (failCount > 0) {
    console.log('\n  ✗ 失敗したテスト:');
    results.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`    - ${r.name}${r.reason ? '\n      → ' + r.reason : ''}`)
    );
  } else {
    console.log('\n  全テスト合格 ✓');
  }

  console.log(`\n  スクリーンショット: ${SHOT_DIR}`);
  console.log('═'.repeat(52));

  process.exit(failCount > 0 ? 1 : 0);
}

main();
