const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Data file stored in Electron user data directory (survives app updates)
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

// Copy initial data on first launch - check both asar and extraResources locations
function copyInitialData() {
  if (fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  // Try extraResources first (resources/data.json)
  const extraPath = path.join(process.resourcesPath, 'data.json');
  // Then try asar root
  const asarPath = path.join(__dirname, 'data.json');

  const src = fs.existsSync(extraPath) ? extraPath : (fs.existsSync(asarPath) ? asarPath : null);
  if (src) {
    fs.copyFileSync(src, DATA_FILE);
    console.log(`[数据] 初始数据已复制到 ${DATA_FILE}`);
  } else {
    // Create empty array if no initial data found
    fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
    console.log('[数据] 未找到初始数据文件，已创建空数据');
  }
}

// ========== Scraper using Electron's built-in Chromium ==========
async function fetchPageElectron(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    let win;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
        },
      });

      // Remove webdriver flag to bypass anti-bot detection
      win.webContents.userAgent = win.webContents.userAgent.replace(' HeadlessElectron', '');

      await win.loadURL(url, { timeout: 30000 });

      // Wait for dynamic content to render
      await new Promise(r => setTimeout(r, 5000));

      const html = await win.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      );
      win.close();
      return html;
    } catch (e) {
      if (win && !win.isDestroyed()) win.close();
      if (i === retries - 1) throw e;
      console.log(`[爬取] 页面加载失败: ${e.message}，重试中...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('页面加载失败');
}

// ========== App Lifecycle ==========
app.on('ready', () => {
  // Copy initial data
  copyInitialData();

  // Tell server to use user data directory
  process.env.SSQ_DATA_FILE = DATA_FILE;

  // Start Express server with Electron scraper
  const { setFetchPage, startServer } = require('./server');
  setFetchPage(fetchPageElectron);
  startServer();

  // Create main window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '双色球数据分析',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL('http://localhost:8765');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  console.log('[服务] 正在关闭...');
});
