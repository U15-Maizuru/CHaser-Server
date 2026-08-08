// Electron の preload が公開する API。型の実体は preload 側と共有する
// (apps/electron/src/electronApi.ts)。ここに書き写すと片側だけの変更を検出できなくなる。
//
// トップレベルの import 文を使うとこのファイルがモジュール扱いになり `interface Window` の
// グローバル拡張が効かなくなるため、import 型構文で参照する。
type ElectronAPI = import('../../../electron/src/electronApi').ElectronAPI;

interface Window {
  electronAPI?: ElectronAPI;
}
