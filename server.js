const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const https = require('https');
let chromium;
try { chromium = require('playwright').chromium; } catch { chromium = null; }

const app = express();
const PORT = 8765;
const DATA_FILE = process.env.SSQ_DATA_FILE || path.join(__dirname, 'data.json');
const BASE_URL = 'https://www.cwl.gov.cn';
const CWL_API = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';

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

// ========== HTTPS GET (for JSON API) ==========
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOpts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...options.headers,
      },
    };
    const req = https.get(url, reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return httpGet(nextUrl, options).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// ========== Convert cwl.gov.cn API item to data.json entry format ==========
function convertCwlEntry(item) {
  const period = item.code;
  const red = (item.red || '').split(',').map(n => parseInt(n.trim(), 10)).filter(n => n > 0);
  const blue = parseInt((item.blue || '0').trim(), 10);
  if (red.length !== 6 || !blue) return null;

  const prizeMap = { 1: '一等奖', 2: '二等奖', 3: '三等奖', 4: '四等奖', 5: '五等奖', 6: '六等奖', 7: '福运奖' };
  const prizes = {};
  for (const g of (item.prizegrades || [])) {
    const name = prizeMap[g.type];
    if (!name) continue;
    const count = String(g.typenum || '');
    const amount = String(g.typemoney || '');
    if (count || amount) prizes[name] = { count, amount };
  }
  if (!prizes['福运奖'] && item.fyjCount) {
    prizes['福运奖'] = { count: String(item.fyjCount), amount: String(item.fyjMoney || '5') };
  }

  return {
    period,
    date: item.date || '',
    red, blue,
    sales: item.sales ? Number(item.sales).toLocaleString('en-US') : '',
    pool: item.poolmoney ? Number(item.poolmoney).toLocaleString('en-US') : '',
    firstPrizeCount: prizes['一等奖']?.count || '',
    firstPrizeAmount: prizes['一等奖']?.amount || '',
    secondPrizeCount: prizes['二等奖']?.count || '',
    secondPrizeAmount: prizes['二等奖']?.amount || '',
    prizes,
    firstPrizeDetail: item.content || '',
    nextPool: item.poolmoney ? Number(item.poolmoney).toLocaleString('en-US') : '',
  };
}

// ========== Fetch Recent Periods via JSON API ==========
async function fetchRecentPeriods(periods = 30) {
  // Step 1: warm up cookies (HMF_CI anti-bot)
  const home = await httpGet(BASE_URL + '/');
  const cookies = (home.headers['set-cookie'] || [])
    .map(c => c.split(';')[0])
    .filter(c => c.includes('='))
    .join('; ');

  // Step 2: call JSON API
  const apiUrl = `${CWL_API}?name=ssq&issueNo=&pageSize=${periods}&pageNo=1&_=${Date.now()}`;
  const resp = await httpGet(apiUrl, {
    headers: {
      Cookie: cookies,
      Referer: `${BASE_URL}/ygkj/wqkjgg/ssq/`,
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (resp.status !== 200) throw new Error(`cwl.gov.cn API status ${resp.status}`);
  const json = JSON.parse(resp.body);
  if (json.state !== 0 || !Array.isArray(json.result)) {
    throw new Error(`cwl.gov.cn API error: ${json.message || 'unknown'}`);
  }

  const results = json.result.map(convertCwlEntry).filter(Boolean);
  if (results.length === 0) throw new Error('API 返回数据为空');
  return results; // newest first
}

// ========== Scrape Recent Periods from List Page (fallback) ==========
async function scrapeRecentPeriods() {
  const html = await fetchPage(`${BASE_URL}/ygkj/wqkjgg/ssq/`);

  // Parse ALL <tr> rows, use first <td> as period (validates format to avoid
  // matching firstPrizeAmount which is also 7 digits)
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const results = [];
  const seenPeriods = new Set();
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Parse all td cells in this row
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    // First cell must be a valid SSQ period: 7 digits starting with "20"
    // (filters out firstPrizeAmount which is also 7 digits but doesn't start with "20")
    if (cells.length === 0 || !/^20\d{5}$/.test(cells[0])) continue;

    const period = cells[0];
    if (seenPeriods.has(period)) continue;
    seenPeriods.add(period);

    // Extract red and blue balls
    const redBalls = [];
    let blue = 0;
    const redBallMatches = [...rowHtml.matchAll(/qiu-item-wqgg-zjhm-red[^>]*>(\d+)<\/div>/g)];
    const blueBallMatch = rowHtml.match(/qiu-item-wqgg-zjhm-blue[^>]*>(\d+)<\/div>/);

    for (const m of redBallMatches) {
      if (redBalls.length < 6) redBalls.push(parseInt(m[1]));
    }
    if (blueBallMatch) blue = parseInt(blueBallMatch[1]);

    // Get detail URL from the last <a> tag
    const detailHref = rowHtml.match(/href="([^"]*\.shtml)"/);
    const detailUrl = detailHref ? detailHref[1] : '';

    results.push({
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
    });
  }

  if (results.length === 0) throw new Error('无法从列表页解析期号');
  return results; // newest first (as appears on list page)
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

const isIncomplete = (entry) => !entry || !entry.sales || entry.sales === '_' || !entry.pool || entry.pool === '_'
    || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
    || !entry.firstPrizeDetail
    || !entry.prizes || Object.keys(entry.prizes).length === 0;

async function checkAndUpdate() {
  if (isUpdating) {
    console.log('[更新] 正在更新中，跳过本次检查');
    return { updated: false, reason: 'already_updating' };
  }

  isUpdating = true;
  try {
    console.log(`[更新] ${new Date().toLocaleString('zh-CN')} 检查新数据...`);

    const localData = loadData();
    const latestLocal = localData.length > 0 ? localData[0].period : null;

    // 优先用 JSON API（可靠，返回结构化数据，不会误匹配奖金为期号）
    let remotePeriods = null;
    try {
      console.log('[更新] 尝试 cwl.gov.cn JSON API...');
      remotePeriods = await fetchRecentPeriods(30);
      console.log(`[更新] JSON API 返回 ${remotePeriods.length} 期数据`);
    } catch (e) {
      console.log(`[更新] JSON API 失败: ${e.message}，尝试 HTML 列表页回退...`);
      try {
        remotePeriods = await scrapeRecentPeriods();
      } catch (e2) {
        console.log(`[更新] HTML 列表页也失败: ${e2.message}`);
        return { updated: false, reason: 'fetch_failed', error: e.message };
      }
    }

    if (!remotePeriods || remotePeriods.length === 0) {
      console.log('[更新] 无法获取远程数据');
      return { updated: false, reason: 'fetch_failed' };
    }

    // Find periods that need updating: missing locally or incomplete
    const periodsToUpdate = [];
    for (const remote of remotePeriods) {
      if (!remote.period || !remote.red || remote.red.length !== 6 || !remote.blue) continue;
      const existIdx = localData.findIndex(d => d.period === remote.period);
      if (existIdx < 0) {
        periodsToUpdate.push(remote);
      } else if (isIncomplete(localData[existIdx])) {
        periodsToUpdate.push(remote);
      }
    }

    if (periodsToUpdate.length === 0) {
      console.log(`[更新] 数据已是最新（第 ${latestLocal} 期）`);
      return { updated: false, reason: 'up_to_date', period: latestLocal };
    }

    console.log(`[更新] 发现 ${periodsToUpdate.length} 期需要更新: ${periodsToUpdate.map(p => p.period).join(', ')}`);

    // Sort by period ascending (oldest first) to maintain data order when inserting
    periodsToUpdate.sort((a, b) => a.period.localeCompare(b.period));

    const data = loadData();
    let updatedCount = 0;
    const updatedPeriods = [];

    for (const remote of periodsToUpdate) {
      // JSON API data is already complete (includes prizes + firstPrizeDetail)
      // Only fetch detail page if missing (fallback HTML scrape case)
      let newEntry = remote;
      if (!remote.prizes || Object.keys(remote.prizes).length === 0) {
        let detail = { prizes: {}, firstPrizeDetail: '', nextPool: '' };
        if (remote.detailUrl) {
          try {
            detail = await scrapeDetail(remote.detailUrl);
          } catch (e) {
            console.log(`[更新] 第 ${remote.period} 期详情页获取失败: ${e.message}`);
          }
        }
        newEntry = {
          ...remote,
          prizes: detail.prizes,
          firstPrizeDetail: detail.firstPrizeDetail,
          nextPool: detail.nextPool || remote.nextPool,
        };
      }

      const existIdx = data.findIndex(d => d.period === remote.period);
      if (existIdx >= 0) {
        data[existIdx] = newEntry;
        console.log(`[更新] 已补全第 ${remote.period} 期数据`);
      } else {
        data.push(newEntry);
        console.log(`[更新] 已新增第 ${remote.period} 期`);
      }
      updatedCount++;
      updatedPeriods.push(remote.period);
    }

    // Sort by period descending (newest first)
    data.sort((a, b) => b.period.localeCompare(a.period));
    saveData(data);

    const latestUpdated = updatedPeriods[updatedPeriods.length - 1];
    console.log(`[更新] 共更新 ${updatedCount} 期，最新: 第 ${latestUpdated} 期，总计 ${data.length} 期`);
    return { updated: true, period: latestUpdated, total: data.length, updatedCount, updatedPeriods };

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
