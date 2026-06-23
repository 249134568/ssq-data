// Fetch latest lottery data from cwl.gov.cn JSON API (complete prize data)
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.SSQ_DATA_FILE || path.join(__dirname, '..', 'data.json');
const CWL_HOME = 'https://www.cwl.gov.cn/';
const CWL_API = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';
const XML_URL = 'https://kaijiang.500.com/static/info/kaijiang/xml/ssq/list.xml';

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// HTTPS GET with cookie jar support (returns {status, headers, body})
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

// Fetch home page to obtain HMF_CI anti-bot cookie, then call JSON API
async function fetchCwlData(periods = 30) {
  // Step 1: warm up cookies
  const home = await httpGet(CWL_HOME);
  const cookies = (home.headers['set-cookie'] || [])
    .map(c => c.split(';')[0])
    .filter(c => c.includes('='))
    .join('; ');

  // Step 2: call JSON API
  const apiUrl = `${CWL_API}?name=ssq&issueNo=&pageSize=${periods}&pageNo=1&_=${Date.now()}`;
  const resp = await httpGet(apiUrl, {
    headers: {
      Cookie: cookies,
      Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (resp.status !== 200) throw new Error(`cwl.gov.cn API status ${resp.status}`);
  const json = JSON.parse(resp.body);
  if (json.state !== 0 || !Array.isArray(json.result)) {
    throw new Error(`cwl.gov.cn API error: ${json.message || 'unknown'}`);
  }
  return json.result;
}

// Convert cwl.gov.cn API result to our data.json entry format
function convertCwlEntry(item) {
  const period = item.code; // "2026070"
  const red = (item.red || '').split(',').map(n => parseInt(n.trim(), 10)).filter(n => n > 0);
  const blue = parseInt((item.blue || '0').trim(), 10);
  if (red.length !== 6 || !blue) return null;

  // prizegrades: type 1-6 = 一等奖~六等奖, type 7 = 福运奖 (often empty)
  const prizeMap = { 1: '一等奖', 2: '二等奖', 3: '三等奖', 4: '四等奖', 5: '五等奖', 6: '六等奖', 7: '福运奖' };
  const prizes = {};
  for (const g of (item.prizegrades || [])) {
    const name = prizeMap[g.type];
    if (!name) continue;
    const count = String(g.typenum || '');
    const amount = String(g.typemoney || '');
    // Skip empty entries (福运奖 sometimes blank on older periods)
    if (count || amount) prizes[name] = { count, amount };
  }
  // Fallback: if 福运奖 missing from prizegrades, use fyjCount/fyjMoney
  if (!prizes['福运奖'] && item.fyjCount) {
    prizes['福运奖'] = { count: String(item.fyjCount), amount: String(item.fyjMoney || '5') };
  }

  return {
    period,
    date: item.date || '',
    red,
    blue,
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

// Fallback: 500.com XML (basic data only, no complete prizes)
async function fetch500Xml() {
  const resp = await httpGet(XML_URL);
  if (resp.status !== 200) return [];
  const rows = [];
  const rowRegex = /<row\s+expect="(\d+)"\s+opencode="([^"]+)"\s+opentime="([^"]+)"/g;
  let match;
  while ((match = rowRegex.exec(resp.body)) !== null) {
    const period = match[1];
    const opencode = match[2];
    const opentime = match[3];
    const parts = opencode.split('|');
    const red = parts[0].split(',').map(n => parseInt(n.trim(), 10));
    const blue = parseInt((parts[1] || '').trim(), 10);
    if (red.length === 6 && blue > 0) {
      const fullPeriod = period.length === 5 ? '20' + period : period;
      const dateStr = opentime.split(' ')[0];
      const dateObj = new Date(dateStr);
      const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
      rows.push({
        period: fullPeriod,
        date: `${dateStr}(${dayOfWeek})`,
        red, blue,
        sales: '', pool: '',
        firstPrizeCount: '', firstPrizeAmount: '',
        secondPrizeCount: '', secondPrizeAmount: '',
        prizes: {}, firstPrizeDetail: '', nextPool: '',
      });
    }
  }
  return rows;
}

async function main() {
  console.log(`[Fetch] ${new Date().toISOString()} 开始获取数据 (cwl.gov.cn JSON API)...`);

  const localData = loadData();
  const latestLocal = localData.length > 0 ? localData[0].period : null;
  console.log(`[Fetch] 本地最新期号: ${latestLocal || '无'}`);

  let cwlRows = [];
  try {
    cwlRows = await fetchCwlData(30);
    console.log(`[Fetch] cwl.gov.cn 返回 ${cwlRows.length} 期数据`);
  } catch (e) {
    console.warn(`[Fetch] cwl.gov.cn 获取失败: ${e.message}，尝试 500.com XML 回退...`);
  }

  if (cwlRows.length === 0) {
    // Fallback: 500.com XML for basic balls only (no prize detail)
    const xmlRows = await fetch500Xml();
    if (xmlRows.length === 0) {
      console.log('[Fetch] 所有数据源均失败，退出');
      process.exit(0);
    }
    console.log(`[Fetch] 500.com XML 返回 ${xmlRows.length} 期基础数据（无奖品详情）`);
    cwlRows = xmlRows;
  }

  // Convert all entries
  const remoteEntries = cwlRows.map(convertCwlEntry).filter(Boolean);
  if (remoteEntries.length === 0) {
    console.log('[Fetch] 数据转换失败，退出');
    process.exit(0);
  }

  const remoteLatest = remoteEntries[0];
  console.log(`[Fetch] 远程最新期号: ${remoteLatest.period}`);

  const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
    || !entry.pool || entry.pool === '_'
    || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
    || !entry.firstPrizeDetail
    || !entry.prizes || Object.keys(entry.prizes).length === 0;

  if (remoteLatest.period === latestLocal && !isIncomplete(localData[0])) {
    console.log(`[Fetch] 数据已是最新（第 ${latestLocal} 期），无需更新`);
    process.exit(0);
  }

  // Merge: update existing or add new entries
  let changed = false;
  for (const entry of remoteEntries) {
    const existIdx = localData.findIndex(d => d.period === entry.period);
    if (existIdx >= 0) {
      const existing = localData[existIdx];
      // Overwrite with more complete remote data when local is incomplete
      if (isIncomplete(existing)) {
        localData[existIdx] = { ...existing, ...entry };
        changed = true;
      }
    } else {
      // New entry
      localData.push(entry);
      changed = true;
    }
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
