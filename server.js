const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
let chromium;
try { chromium = require('playwright').chromium; } catch { chromium = null; }

const app = express();
const PORT = 8765;
const DATA_FILE = process.env.SSQ_DATA_FILE || path.join(__dirname, 'data.json');
const BASE_URL = 'https://www.cwl.gov.cn';

// ========== Data Helpers ==========
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getLatestPeriod() {
  const data = loadData();
  if (data.length === 0) return null;
  return data[0].period;
}

// ========== Scraper (Playwright standalone, overridable for Electron) ==========
let _fetchPageFn = null;

function setFetchPage(fn) {
  _fetchPageFn = fn;
}

async function fetchPagePlaywright(url, retries = 2) {
  if (!chromium) throw new Error('Playwright 未安装，请使用 Electron 模式或安装 playwright');
  for (let i = 0; i < retries; i++) {
    let browser, context;
    try {
      // Use Edge browser to bypass anti-bot 403
      const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
      const fsSync = require('fs');
      const useExecutable = fsSync.existsSync(edgePath) ? edgePath : undefined;
      browser = await chromium.launch({
        headless: true,
        ...(useExecutable && { executablePath: useExecutable }),
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      });
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
        locale: 'zh-CN',
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for the data table to appear
      await page.waitForSelector('td', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const html = await page.content();
      await context.close();
      await browser.close();
      return html;
    } catch (e) {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (i === retries - 1) throw e;
      console.log(`  [爬取] 页面加载失败: ${e.message}，重试中...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('页面加载失败');
}

async function fetchPage(url, retries) {
  if (_fetchPageFn) return _fetchPageFn(url, retries);
  return fetchPagePlaywright(url, retries);
}

// ========== Scrape Latest Period from List Page ==========
async function scrapeLatestPeriod() {
  const html = await fetchPage(`${BASE_URL}/ygkj/wqkjgg/ssq/`);

  // Find first data row: a <td> containing a 7-digit period number
  const periodMatches = [...html.matchAll(/<td[^>]*>(\d{7})<\/td>/g)];
  if (periodMatches.length === 0) throw new Error('无法从列表页解析期号');

  const period = periodMatches[0][1];

  // Extract the full <tr> row containing this period
  const rowStart = html.lastIndexOf('<tr', periodMatches[0].index);
  const rowEnd = html.indexOf('</tr>', periodMatches[0].index);
  const rowHtml = html.substring(rowStart, rowEnd);

  // Extract red and blue balls
  const redBalls = [];
  let blue = 0;
  const redBallMatches = [...rowHtml.matchAll(/qiu-item-wqgg-zjhm-red[^>]*>(\d+)<\/div>/g)];
  const blueBallMatch = rowHtml.match(/qiu-item-wqgg-zjhm-blue[^>]*>(\d+)<\/div>/);

  for (const m of redBallMatches) {
    if (redBalls.length < 6) redBalls.push(parseInt(m[1]));
  }
  if (blueBallMatch) blue = parseInt(blueBallMatch[1]);

  // Parse all td cells
  const cells = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let tdMatch;
  while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
    cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  // Get detail URL from the last <a> tag
  const detailHref = rowHtml.match(/href="([^"]*\.shtml)"/);
  const detailUrl = detailHref ? detailHref[1] : '';

  return {
    period,
    date: cells[1] || '',
    red: redBalls,
    blue,
    sales: cells[7] || '',
    pool: cells[8] || '',
    firstPrizeCount: cells[3] || '',
    firstPrizeAmount: cells[4] || '',
    secondPrizeCount: cells[5] || '',
    secondPrizeAmount: cells[6] || '',
    detailUrl,
  };
}

// ========== Scrape Detail Page for Prizes ==========
async function scrapeDetail(relativeUrl) {
  const url = relativeUrl.startsWith('http') ? relativeUrl : `${BASE_URL}${relativeUrl}`;
  const html = await fetchPage(url);

  const result = { prizes: {}, firstPrizeDetail: '', nextPool: '' };

  // Parse prize table
  const tableRegex = /<tr[^>]*>\s*<td[^>]*>([^<]*(?:等奖|福运)[^<]*)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\d,]+)<\/td>/g;
  let match;
  while ((match = tableRegex.exec(html)) !== null) {
    result.prizes[match[1].trim()] = { count: match[2], amount: match[3] };
  }

  // First prize location - match the div AFTER "一等奖中奖情况"
  const locMatch = html.match(/一等奖中奖情况[：:]*<\/div>\s*<div[^>]*winningProvinces[^>]*>([\s\S]*?)<\/div>/);
  if (locMatch) {
    const text = locMatch[1].trim();
    if (text.includes('注')) result.firstPrizeDetail = text;
  }

  // Next pool
  const poolMatch = html.match(/下期一等奖奖池累计金额[：:\s]*([\d,]+)元/);
  if (poolMatch) result.nextPool = poolMatch[1];

  return result;
}

// ========== Check & Update ==========
let isUpdating = false;

async function checkAndUpdate() {
  if (isUpdating) {
    console.log('[更新] 正在更新中，跳过本次检查');
    return { updated: false, reason: 'already_updating' };
  }

  isUpdating = true;
  try {
    console.log(`[更新] ${new Date().toLocaleString('zh-CN')} 检查新数据...`);

    const latestLocal = getLatestPeriod();
    const remote = await scrapeLatestPeriod();

    if (!remote.period) {
      console.log('[更新] 无法获取远程数据');
      return { updated: false, reason: 'fetch_failed' };
    }

    const isIncomplete = (entry) => !entry.sales || entry.sales === '_' || !entry.pool || entry.pool === '_'
        || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
        || !entry.firstPrizeDetail;

    const localData = loadData();
    if (remote.period === latestLocal && !isIncomplete(localData[0])) {
      console.log(`[更新] 数据已是最新（第 ${latestLocal} 期）`);
      return { updated: false, reason: 'up_to_date', period: latestLocal };
    }

    if (remote.period === latestLocal && isIncomplete(localData[0])) {
      console.log(`[更新] 第 ${latestLocal} 期数据不完整，重新获取...`);
    } else if (remote.period !== latestLocal) {
      console.log(`[更新] 发现新数据！本地: ${latestLocal}，远程: ${remote.period}`);
    }

    // Fetch detail for prize info
    let detail = { prizes: {}, firstPrizeDetail: '', nextPool: '' };
    if (remote.detailUrl) {
      try {
        detail = await scrapeDetail(remote.detailUrl);
        console.log('[更新] 详情页数据获取成功');
      } catch (e) {
        console.log(`[更新] 详情页获取失败: ${e.message}，仅保存基础数据`);
      }
    }

    // Build new entry
    const newEntry = {
      period: remote.period,
      date: remote.date,
      red: remote.red,
      blue: remote.blue,
      sales: remote.sales,
      pool: remote.pool,
      firstPrizeCount: remote.firstPrizeCount,
      firstPrizeAmount: remote.firstPrizeAmount,
      secondPrizeCount: remote.secondPrizeCount,
      secondPrizeAmount: remote.secondPrizeAmount,
      prizes: detail.prizes,
      firstPrizeDetail: detail.firstPrizeDetail,
      nextPool: detail.nextPool,
    };

    // Validate
    if (!newEntry.red || newEntry.red.length !== 6 || !newEntry.blue) {
      console.log('[更新] 数据不完整，跳过更新');
      return { updated: false, reason: 'invalid_data' };
    }

    // Add or update data
    const data = loadData();
    const existIdx = data.findIndex(d => d.period === remote.period);
    if (existIdx >= 0) {
      data[existIdx] = newEntry;
      console.log(`[更新] 已补全第 ${remote.period} 期数据`);
    } else {
      data.unshift(newEntry);
      console.log(`[更新] 已新增第 ${remote.period} 期，共 ${data.length} 期数据`);
    }
    saveData(data);

    return { updated: true, period: remote.period, total: data.length };

  } catch (e) {
    console.log(`[更新] 检查失败: ${e.message}`);
    return { updated: false, reason: 'error', error: e.message };
  } finally {
    isUpdating = false;
  }
}

// ========== API Routes ==========
app.use(express.static(__dirname));

// Get all lottery data (replaces direct data.json access for Electron compatibility)
app.get('/api/data', (req, res) => {
  const data = loadData();
  res.json(data);
});

// Get current data status
app.get('/api/status', (req, res) => {
  const data = loadData();
  res.json({
    total: data.length,
    latestPeriod: data.length > 0 ? data[0].period : null,
    latestDate: data.length > 0 ? data[0].date : null,
  });
});

// Manual trigger update check
app.post('/api/update', async (req, res) => {
  const result = await checkAndUpdate();
  res.json(result);
});

// ========== Start Server (callable from Electron) ==========
function startServer() {
  // Cron Jobs
  cron.schedule('30,35,40,45,50,55 21 * * 0,2,4', () => {
    console.log('[定时] 开奖时段检查触发');
    checkAndUpdate();
  }, { timezone: 'Asia/Shanghai' });

  cron.schedule('0,5,10,15,20,25,30,35,40,45,50,55 22 * * 0,2,4', () => {
    console.log('[定时] 开奖时段检查触发');
    checkAndUpdate();
  }, { timezone: 'Asia/Shanghai' });

  cron.schedule('0,30 * * * *', () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    const isDrawDay = [0, 2, 4].includes(day);
    const isDrawHour = hour === 21 || hour === 22;
    if (isDrawDay && isDrawHour) return;

    console.log('[定时] 常规检查触发');
    checkAndUpdate();
  }, { timezone: 'Asia/Shanghai' });

  app.listen(PORT, () => {
    const data = loadData();
    console.log('╔══════════════════════════════════════╗');
    console.log('║   双色球智能推算系统 - 已启动        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║   地址: http://localhost:${PORT}          ║`);
    console.log(`║   数据: ${data.length} 期                      ║`);
    console.log(`║   最新: 第 ${data[0]?.period || '无'} 期              ║`);
    console.log('║   自动更新: 已开启                    ║');
    console.log('╚══════════════════════════════════════╝');

    setTimeout(() => checkAndUpdate(), 5000);
  });
}

module.exports = { app, setFetchPage, startServer };

// ========== Standalone Mode ==========
if (require.main === module) {
  startServer();

  process.on('SIGINT', () => {
    console.log('\n[服务] 正在关闭...');
    process.exit(0);
  });
}
