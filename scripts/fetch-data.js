// Fetch latest lottery data from 500.com API (no anti-bot, no Playwright needed)
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.SSQ_DATA_FILE || path.join(__dirname, '..', 'data.json');
const XML_URL = 'https://kaijiang.500.com/static/info/kaijiang/xml/ssq/list.xml';
const DATACHART_URL = 'https://datachart.500.com/ssq/history/newinc/history.php';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Simple HTTPS GET
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// Parse XML list for basic draw results
function parseXmlList(xml) {
  const rows = [];
  const rowRegex = /<row\s+expect="(\d+)"\s+opencode="([^"]+)"\s+opentime="([^"]+)"/g;
  let match;
  while ((match = rowRegex.exec(xml)) !== null) {
    const period = match[1];
    const opencode = match[2];
    const opentime = match[3];

    // Parse ball numbers: "03,06,08,14,26,27|08"
    const parts = opencode.split('|');
    const redStr = parts[0];
    const blueStr = parts[1] || '';
    const red = redStr.split(',').map(n => parseInt(n.trim(), 10));
    const blue = parseInt(blueStr.trim(), 10);

    if (red.length === 6 && blue > 0) {
      // Convert period format: "26070" → "2026070"
      const fullPeriod = period.length === 5 ? '20' + period : period;
      // Parse date from opentime
      const dateStr = opentime.split(' ')[0]; // "2026-06-21"
      const dateObj = new Date(dateStr);
      const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
      const formattedDate = `${dateStr}(${dayOfWeek})`;

      rows.push({ period: fullPeriod, red, blue, date: formattedDate, opentime });
    }
  }
  return rows;
}

// Parse datachart HTML for detailed prize data
function parseDatachart(html) {
  const rows = [];
  const trRegex = /<tr\s+class="t_tr1"[^>]*>([\s\S]*?)<\/tr>/g;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    // Strip HTML comments before parsing <td> (e.g., <!--<td>2</td>-->)
    const trHtml = trMatch[1].replace(/<!--[\s\S]*?-->/g, '');
    // Extract all <td> contents
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(trHtml)) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    if (cells.length >= 16) {
      const period = cells[0];
      const red = cells.slice(1, 7).map(n => parseInt(n.trim(), 10));
      const blue = parseInt(cells[7].trim(), 10);
      // cells[8] is &nbsp; (empty)
      const pool = cells[9];
      const firstPrizeCount = cells[10];
      const firstPrizeAmount = cells[11];
      const secondPrizeCount = cells[12];
      const secondPrizeAmount = cells[13];
      const sales = cells[14];
      const date = cells[15];

      const fullPeriod = period.length === 5 ? '20' + period : period;

      if (red.length === 6 && red.every(n => n > 0) && blue > 0) {
        rows.push({
          period: fullPeriod, red, blue, date, sales, pool,
          firstPrizeCount, firstPrizeAmount, secondPrizeCount, secondPrizeAmount,
        });
      }
    }
  }
  return rows;
}

async function main() {
  console.log(`[Fetch] ${new Date().toISOString()} 开始获取数据 (500.com API)...`);

  const localData = loadData();
  const latestLocal = localData.length > 0 ? localData[0].period : null;
  console.log(`[Fetch] 本地最新期号: ${latestLocal || '无'}`);

  // Step 1: Fetch XML list for quick check of latest period
  console.log('[Fetch] 获取 500.com XML 开奖列表...');
  const xml = await httpGet(XML_URL);
  const xmlRows = parseXmlList(xml);

  if (xmlRows.length === 0) {
    console.log('[Fetch] XML 列表为空，退出');
    process.exit(0);
  }

  const latestRemote = xmlRows[0];
  console.log(`[Fetch] 远程最新期号: ${latestRemote.period}`);

  // Check if update needed
  const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
    || !entry.pool || entry.pool === '_'
    || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
    || !entry.firstPrizeDetail;

  if (latestRemote.period === latestLocal && !isIncomplete(localData[0])) {
    console.log(`[Fetch] 数据已是最新（第 ${latestLocal} 期），无需更新`);
    process.exit(0);
  }

  // Step 2: Fetch datachart for detailed data (sales, prizes)
  console.log('[Fetch] 获取 500.com 详细数据...');
  // Get last 5 periods of data
  const latestShort = latestRemote.period.slice(-5); // "26070"
  const startPeriod = String(Number(latestShort) - 4); // last 5 periods
  const chartHtml = await httpGet(`${DATACHART_URL}?start=${startPeriod}&end=${latestShort}`);
  const chartRows = parseDatachart(chartHtml);

  console.log(`[Fetch] 获取到 ${chartRows.length} 期详细数据`);

  // Build map from datachart
  const chartMap = {};
  for (const row of chartRows) {
    chartMap[row.period] = row;
  }

  // Step 3: Merge data
  let changed = false;
  for (const xmlRow of xmlRows) {
    // Only process recent periods (latest 5)
    const chartDetail = chartMap[xmlRow.period];

    const existIdx = localData.findIndex(d => d.period === xmlRow.period);

    const newEntry = {
      period: xmlRow.period,
      date: xmlRow.date,
      red: xmlRow.red,
      blue: xmlRow.blue,
      sales: chartDetail?.sales || '',
      pool: chartDetail?.pool || '',
      firstPrizeCount: chartDetail?.firstPrizeCount || '',
      firstPrizeAmount: chartDetail?.firstPrizeAmount || '',
      secondPrizeCount: chartDetail?.secondPrizeCount || '',
      secondPrizeAmount: chartDetail?.secondPrizeAmount || '',
      prizes: {},
      firstPrizeDetail: '',
      nextPool: chartDetail?.pool || '',
    };

    if (existIdx >= 0) {
      // Update if we have more complete data
      const existing = localData[existIdx];
      if (isIncomplete(existing)) {
        // Merge: keep existing prize detail if we have it, fill in missing fields
        const merged = { ...existing };
        if (!merged.sales && newEntry.sales) { merged.sales = newEntry.sales; }
        if (!merged.pool && newEntry.pool) { merged.pool = newEntry.pool; }
        if (!merged.firstPrizeCount && newEntry.firstPrizeCount) { merged.firstPrizeCount = newEntry.firstPrizeCount; }
        if (!merged.firstPrizeAmount && newEntry.firstPrizeAmount) { merged.firstPrizeAmount = newEntry.firstPrizeAmount; }
        if (!merged.secondPrizeCount && newEntry.secondPrizeCount) { merged.secondPrizeCount = newEntry.secondPrizeCount; }
        if (!merged.secondPrizeAmount && newEntry.secondPrizeAmount) { merged.secondPrizeAmount = newEntry.secondPrizeAmount; }
        if (!merged.nextPool && newEntry.nextPool) { merged.nextPool = newEntry.nextPool; }
        localData[existIdx] = merged;
        changed = true;
      }
    } else if (chartDetail) {
      // New entry with chart data
      localData.push(newEntry);
      changed = true;
    }
    // Only process recent entries (don't iterate all 3400+ XML rows)
    if (xmlRow.period <= latestLocal) break;
  }

  if (!changed) {
    console.log('[Fetch] 无新数据需要更新');
    process.exit(0);
  }

  // Sort by period descending
  localData.sort((a, b) => b.period.localeCompare(a.period));

  saveData(localData);
  console.log(`[Fetch] data.json 已更新，共 ${localData.length} 期`);
}

main().catch(e => {
  console.error(`[Fetch] 错误: ${e.message}`);
  process.exit(1);
});
