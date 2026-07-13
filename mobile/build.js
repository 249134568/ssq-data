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

  /* 夜间模式：覆盖 CSS 变量 */
  body.dark-theme {
    --bg-primary: #1c1c1e;
    --bg-secondary: #2c2c2e;
    --bg-glass: rgba(44, 44, 46, 0.96);
    --text-primary: #f5f5f7;
    --text-secondary: #aeaeb2;
    --text-tertiary: #8e8e93;
    --accent-blue: #0a84ff;
    --border: rgba(255, 255, 255, 0.12);
    background: #1c1c1e !important;
    color: #f5f5f7 !important;
  }
  body.dark-theme .nav {
    background: rgba(28, 28, 30, 0.96) !important;
    border-bottom-color: rgba(255, 255, 255, 0.12) !important;
  }
  body.dark-theme .card,
  body.dark-theme .hero,
  body.dark-theme .prize-card,
  body.dark-theme .saved-prediction-card,
  body.dark-theme .backtest-panel {
    background: #2c2c2e !important;
    color: #f5f5f7 !important;
    border-color: rgba(255,255,255,0.12) !important;
  }
  body.dark-theme .card-title,
  body.dark-theme h1, body.dark-theme h2, body.dark-theme h3 {
    color: #f5f5f7 !important;
  }
  body.dark-theme .ball-red { background: #ff453a !important; color: #fff !important; }
  body.dark-theme .ball-blue { background: #0a84ff !important; color: #fff !important; }
  body.dark-theme input, body.dark-theme select, body.dark-theme textarea {
    background: #3a3a3c !important;
    color: #f5f5f7 !important;
    border-color: rgba(255,255,255,0.15) !important;
  }
  body.dark-theme .history-row,
  body.dark-theme .history-row-main,
  body.dark-theme tr { background: #2c2c2e !important; color: #f5f5f7 !important; }
  body.dark-theme .history-row:nth-child(even),
  body.dark-theme tr:nth-child(even) { background: #333335 !important; }
  body.dark-theme .update-banner { background: #0a84ff !important; }

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
      padding-top: calc(var(--safe-top) + 22px) !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
      z-index: 9999 !important;
      transform: translateZ(0) !important;
      will-change: transform !important;
      -webkit-transform: translateZ(0) !important;
      background: rgba(245, 245, 247, 0.96) !important;
      border-bottom: 0.5px solid rgba(0, 0, 0, 0.12) !important;
    }
    /* 两行布局：第一行 tabs，第二行按钮组 */
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
      border-radius: 10px !important;
      transition: all 0.2s ease !important;
    }
    .nav-tab.active {
      background: #0071e3 !important;
      color: #fff !important;
      border-bottom: none !important;
      font-weight: 600 !important;
    }
    .nav-tab:not(.active) { border-bottom: none !important; }

    /* 按钮行：刷新 + 主题切换，各占一半 */
    .nav-buttons-row {
      display: flex !important;
      gap: 8px !important;
      width: 100% !important;
      flex: none !important;
    }
    .nav-refresh, .theme-toggle-btn {
      flex: 1 1 0 !important;
      width: auto !important;
      margin: 0 !important;
      min-height: 40px;
      padding: 8px 12px !important;
      font-size: 13px !important;
      font-weight: 600 !important;
      border: none !important;
      border-radius: 20px !important;
      color: #fff !important;
      cursor: pointer;
      transition: all 0.15s ease !important;
    }
    /* 刷新按钮：蓝色渐变 */
    .nav-refresh {
      background: linear-gradient(180deg, #0a84ff 0%, #0071e3 100%) !important;
      box-shadow: 0 1px 3px rgba(0, 113, 227, 0.3) !important;
    }
    /* 主题切换按钮：灰色渐变（白天模式时） */
    .theme-toggle-btn {
      background: linear-gradient(180deg, #6e6e73 0%, #48484a 100%) !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
    }
    /* 主题切换按钮：夜间模式时变金色（提示切回白天） */
    .theme-toggle-btn.is-dark {
      background: linear-gradient(180deg, #ffd60a 0%, #ff9500 100%) !important;
      color: #1d1d1f !important;
      box-shadow: 0 1px 3px rgba(255, 149, 0, 0.4) !important;
    }
    .nav-refresh:active, .theme-toggle-btn:active {
      transform: scale(0.97) !important;
      opacity: 0.9 !important;
    }
    body { padding-top: calc(var(--safe-top) + 112px) !important; }
  }
  input, select, textarea { font-size: 16px !important; }
  * { -webkit-touch-callout: none; }
  .history-table-wrap, .cold-compare, .prize-detail-content { -webkit-overflow-scrolling: touch; }
</style>
`;

// Inject theme toggle script
const themeScript = `
<script>
(function() {
  function setupThemeToggle() {
    var navRefresh = document.querySelector('.nav-refresh');
    if (!navRefresh) {
      setTimeout(setupThemeToggle, 500);
      return;
    }
    if (document.querySelector('.theme-toggle-btn')) return;

    var navInner = navRefresh.parentElement;
    var buttonRow = document.createElement('div');
    buttonRow.className = 'nav-buttons-row';

    navInner.removeChild(navRefresh);
    buttonRow.appendChild(navRefresh);

    var themeBtn = document.createElement('button');
    themeBtn.className = 'theme-toggle-btn';
    themeBtn.type = 'button';
    themeBtn.innerHTML = '<span>夜间模式</span>';
    themeBtn.onclick = function() {
      var isDark = document.body.classList.toggle('dark-theme');
      themeBtn.classList.toggle('is-dark', isDark);
      themeBtn.innerHTML = isDark ? '<span>白天模式</span>' : '<span>夜间模式</span>';
      try { localStorage.setItem('ssq_theme', isDark ? 'dark' : 'light'); } catch(e) {}
    };
    buttonRow.appendChild(themeBtn);
    navInner.appendChild(buttonRow);

    try {
      var saved = localStorage.getItem('ssq_theme');
      if (saved === 'dark') {
        document.body.classList.add('dark-theme');
        themeBtn.classList.add('is-dark');
        themeBtn.innerHTML = '<span>白天模式</span>';
      }
    } catch(e) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeToggle);
  } else {
    setupThemeToggle();
  }
})();
</script>
`;
html = html.replace('</head>', mobileStyle + themeScript + '</head>');

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
