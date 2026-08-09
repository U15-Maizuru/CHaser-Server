import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { appWindowTitle, readAppLocation } from './lib/appMode';

// 3枚のウィンドウ (対戦表示 / コントロール / 大会運営) を並べたときに用途で見分けられるよう、
// index.html の既定タイトルをここで上書きする。Electron のウィンドウタイトルもこれに従う。
document.title = appWindowTitle(readAppLocation(window.location.search));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
