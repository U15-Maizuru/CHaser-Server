// Type shims for Electron v28+ subpath imports.
// 'electron/main' and 'electron/renderer' are the correct runtime paths in
// Electron v28+, but the npm type package only ships a single electron.d.ts.
declare module 'electron/main' {
  export * from 'electron';
}
declare module 'electron/renderer' {
  export * from 'electron';
}
