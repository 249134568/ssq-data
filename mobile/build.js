const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');
const WWW = path.resolve(__dirname, 'www');

// Clean www
if (fs.existsSync(WWW)) fs.rmSync(WWW, { recursive: true });
fs.mkdirSync(WWW, { recursive: true });
fs.mkdirSync(path.join(WWW, 'backtest'), { recursive: true });

// Copy index.html
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf-8');

// Inject mobile bridge script before </head>
const mobileBridge = fs.readFileSync(path.join(__dirname, 'mobile-bridge.js'), 'utf-8');
html = html.replace('</head>', `<script>${mobileBridge}</script></head>`);

// Inject mobile viewport + safe-area CSS
const mobileStyle = `
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<style>
  :root { --safe-top: env(safe-area-inset-top, 0px); --safe-bottom: env(safe-area-inset-bottom, 0px); }
  html, body { -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
  body { padding-top: var(--safe-top); padding-bottom: var(--safe-bottom); }
  .nav-inner { padding-top: calc(6px + var(--safe-top)) !important; }
  /* 移动端字号适配 */
  @media (max-width: 480px) {
    .card-title { font-size: 16px; }
    .ball-lg { width: 30px; height: 30px; font-size: 13px; line-height: 30px; }
    .ball-xl { width: 34px; height: 34px; font-size: 14px; line-height: 34px; }
  }
  /* 防止 iOS 输入框缩放 */
  input, select, textarea { font-size: 16px !important; }
  /* 长按菜单禁用 */
  * { -webkit-touch-callout: none; }
  /* 滚动惯性 */
  .history-table-wrap, .cold-compare, .prize-detail-content { -webkit-overflow-scrolling: touch; }
</style>
`;
html = html.replace('</head>', mobileStyle + '</head>');

fs.writeFileSync(path.join(WWW, 'index.html'), html);

// Copy coldness.js (新增的冷门度模块)
const coldnessSrc = path.join(SRC, 'coldness.js');
if (fs.existsSync(coldnessSrc)) {
  fs.copyFileSync(coldnessSrc, path.join(WWW, 'coldness.js'));
}

// Copy backtest files
for (const f of ['backtest-ui.js', 'backtest-worker.js', 'backtest.css', 'prng.js']) {
  const src = path.join(SRC, 'backtest', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WWW, 'backtest', f));
}

// Copy data.json as initial data
if (fs.existsSync(path.join(SRC, 'data.json'))) {
  fs.copyFileSync(path.join(SRC, 'data.json'), path.join(WWW, 'data.json'));
}

console.log('Build complete: www/');
