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
  body { padding-bottom: var(--safe-bottom); }
  /* 移动端字号适配 */
  @media (max-width: 480px) {
    .card-title { font-size: 16px; }
    .ball-lg { width: 30px; height: 30px; font-size: 13px; line-height: 30px; }
    .ball-xl { width: 34px; height: 34px; font-size: 14px; line-height: 34px; }
    /* 导航栏：fixed 固定在顶部，不随滚动移动 */
    .nav {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      padding-top: var(--safe-top) !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
    }
    /* 两行布局：第一行 tabs，第二行刷新按钮 */
    .nav-inner {
      flex-direction: column !important;
      padding: 4px 0 6px !important;
      height: auto !important;
      max-width: 100% !important;
      gap: 4px !important;
    }
    .nav-tabs { width: 100% !important; flex: none !important; flex-wrap: nowrap !important; overflow-x: auto; }
    .nav-tab {
      padding: 10px 4px !important;
      font-size: 12px !important;
      min-height: 40px;
      flex: 1 1 0;
      display: flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }
    .nav-refresh {
      width: 100% !important;
      margin: 0 !important;
      flex: none !important;
      min-height: 36px;
      padding: 6px 12px !important;
      font-size: 12px !important;
    }
    /* body 留出固定导航栏空间: safe-top + tabs(40) + gap(4) + refresh(36) + padding(10) = safe-top + 90 */
    body { padding-top: calc(var(--safe-top) + 90px) !important; }
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
