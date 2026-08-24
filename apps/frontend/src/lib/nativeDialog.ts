// window.confirm / window.alert は、Electron (Windows) では閉じたあとに
// ウィンドウが「フォーカスは持っている判定なのにキーボード入力だけ届かない」状態に
// 残ることがある — マウスクリックは効くが、input にカーソルが入らず何も打てなくなる。
// window.focus() は既にフォーカス済みだと no-op で直らないため、Electron 環境では
// メインプロセス側で本物の blur→focus サイクルを踏ませる (main.ts の window:refocus)。
// ブラウザ (U15_MODE=web) には electronAPI が無いので、その場合は window.focus() だけになる。
// 呼び出し側全部に同じ対策を書かせないよう、ここに集約する。

function refocus(): void {
  void window.electronAPI?.refocusWindow();
  window.focus();
}

export function confirmDialog(message: string): boolean {
  const ok = window.confirm(message);
  refocus();
  return ok;
}

export function alertDialog(message: string): void {
  window.alert(message);
  refocus();
}

/** 未保存の編集があるときだけ確認する。無ければ何も聞かず true (マップエディタの close ガード用) */
export function confirmDiscardEdits(dirty: boolean): boolean {
  return !dirty || confirmDialog('編集中の内容を破棄しますか？');
}
