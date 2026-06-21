// Fetch latest lottery data using Playwright (for GitHub Actions)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.SSQ_DATA_FILE || path.join(__dirname, '..', 'data.json');
const BASE_URL = 'https://www.cwl.gov.cn';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function fetchPage(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('td', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return await page.content();
  } finally {
    await context.close();
    await browser.close();
  }
}

function parseLatestPeriod(html) {
  const periodMatches = [...html.matchAll(/<td[^>]*>(\d{7})<\/td>/g)];
  if (periodMatches.length === 0) throw new Error('无法从列表页解析期号');

  const period = periodMatches[0][1];
  const rowStart = html.lastIndexOf('<tr', periodMatches[0].index);
  const rowEnd = html.indexOf('</tr>', periodMatches[0].index);
  const rowHtml = html.substring(rowStart, rowEnd);

  const redBalls = [];
  let blue = 0;
  const redBallMatches = [...rowHtml.matchAll(/qiu-item-wqgg-zjhm-red[^>]*>(\d+)<\/div>/g)];
  const blueBallMatch = rowHtml.match(/qiu-item-wqgg-zjhm-blue[^>]*>(\d+)<\/div>/);
  for (const m of redBallMatches) { if (redBalls.length < 6) redBalls.push(parseInt(m[1])); }
  if (blueBallMatch) blue = parseInt(blueBallMatch[1]);

  const cells = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let tdMatch;
  while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
    cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  const detailHref = rowHtml.match(/href="([^"]*\.shtml)"/);
  return {
    period, red: redBalls, blue,
    date: cells[1] || '',
    sales: cells[7] || '', pool: cells[8] || '',
    firstPrizeCount: cells[3] || '', firstPrizeAmount: cells[4] || '',
    secondPrizeCount: cells[5] || '', secondPrizeAmount: cells[6] || '',
    detailUrl: detailHref ? detailHref[1] : '',
  };
}

function parseDetail(html) {
  const result = { prizes: {}, firstPrizeDetail: '', nextPool: '' };
  const tableRegex = /<tr[^>]*>\s*<td[^>]*>([^<]*(?:等奖|福运)[^<]*)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\d,]+)<\/td>/g;
  let match;
  while ((match = tableRegex.exec(html)) !== null) {
    result.prizes[match[1].trim()] = { count: match[2], amount: match[3] };
  }
  const locMatch = html.match(/一等奖中奖情况[：:]*<\/div>\s*<div[^>]*winningProvinces[^>]*>([\s\S]*?)<\/div>/);
  if (locMatch) {
    const text = locMatch[1].trim();
    if (text.includes('注')) result.firstPrizeDetail = text;
  }
  const poolMatch = html.match(/下期一等奖奖池累计金额[：:\s]*([\d,]+)元/);
  if (poolMatch) result.nextPool = poolMatch[1];
  return result;
}

async function main() {
  console.log(`[Fetch] ${new Date().toISOString()} 开始获取数据...`);

  const localData = loadData();
  const latestLocal = localData.length > 0 ? localData[0].period : null;
  console.log(`[Fetch] 本地最新期号: ${latestLocal || '无'}`);

  // Scrape list page
  const html = await fetchPage(`${BASE_URL}/ygkj/wqkjgg/ssq/`);
  const remote = parseLatestPeriod(html);

  if (!remote.period) {
    console.log('[Fetch] 无法获取远程数据，退出');
    process.exit(0);
  }

  console.log(`[Fetch] 远程最新期号: ${remote.period}`);

  const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
    || !entry.pool || entry.pool === '_'
    || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
    || !entry.firstPrizeDetail;

  if (remote.period === latestLocal && !isIncomplete(localData[0])) {
    console.log(`[Fetch] 数据已是最新（第 ${latestLocal} 期），无需更新`);
    process.exit(0);
  }

  // Scrape detail page
  let detail = { prizes: {}, firstPrizeDetail: '', nextPool: '' };
  if (remote.detailUrl) {
    try {
      const detailUrl = remote.detailUrl.startsWith('http') ? remote.detailUrl : `${BASE_URL}${remote.detailUrl}`;
      detail = await parseDetail(await fetchPage(detailUrl));
      console.log('[Fetch] 详情页数据获取成功');
    } catch (e) {
      console.log(`[Fetch] 详情页获取失败: ${e.message}`);
    }
  }

  const newEntry = {
    period: remote.period, date: remote.date, red: remote.red, blue: remote.blue,
    sales: remote.sales, pool: remote.pool,
    firstPrizeCount: remote.firstPrizeCount, firstPrizeAmount: remote.firstPrizeAmount,
    secondPrizeCount: remote.secondPrizeCount, secondPrizeAmount: remote.secondPrizeAmount,
    prizes: detail.prizes, firstPrizeDetail: detail.firstPrizeDetail, nextPool: detail.nextPool,
  };

  if (!newEntry.red || newEntry.red.length !== 6 || !newEntry.blue) {
    console.log('[Fetch] 数据不完整，跳过更新');
    process.exit(0);
  }

  const existIdx = localData.findIndex(d => d.period === remote.period);
  if (existIdx >= 0) {
    localData[existIdx] = newEntry;
    console.log(`[Fetch] 已补全第 ${remote.period} 期数据`);
  } else {
    localData.unshift(newEntry);
    console.log(`[Fetch] 已新增第 ${remote.period} 期，共 ${localData.length} 期数据`);
  }

  saveData(localData);
  console.log('[Fetch] data.json 已更新');
}

main().catch(e => {
  console.error(`[Fetch] 错误: ${e.message}`);
  process.exit(1);
});
