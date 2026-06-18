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

fs.writeFileSync(path.join(WWW, 'index.html'), html);

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
