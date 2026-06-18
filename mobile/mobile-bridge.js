// ========== Mobile Bridge: Replace server API with client-side logic ==========
(function() {
  'use strict';

  const DATA_KEY = 'ssq_lottery_data';
  const BASE_URL = 'https://www.cwl.gov.cn';
  const STORE_KEY = 'ssq_saved_predictions';

  // ========== Data Storage (localStorage) ==========
  function loadDataArray() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveDataArray(data) {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }

  // ========== Network Fetch (Capacitor HTTP or fallback) ==========
  async function nativeFetch(url, retries = 2) {
    for (let i = 0; i < retries; i++) {
      try {
        // Try Capacitor native HTTP (no CORS, custom headers)
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
          const { CapacitorHttp } = window.Capacitor.Plugins;
          const resp = await CapacitorHttp.request({
            url: url,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
            responseType: 'text',
          });
          return resp.data;
        }
        // Fallback: regular fetch (for browser testing)
        const resp = await fetch(url, {
          headers: {
            'Accept': 'text/html',
            'Accept-Language': 'zh-CN',
          }
        });
        return await resp.text();
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // ========== HTML Parsing (same regex logic as server.js) ==========
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

  // ========== API Overrides ==========
  // Override fetch to intercept API calls
  const originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    const urlStr = typeof url === 'string' ? url : url.url;

    // /api/data - return all lottery data from localStorage
    if (urlStr === '/api/data' || urlStr.endsWith('/api/data')) {
      const data = loadDataArray();
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    }

    // /api/status - return status
    if (urlStr === '/api/status' || urlStr.endsWith('/api/status')) {
      const data = loadDataArray();
      return new Response(JSON.stringify({
        total: data.length,
        latestPeriod: data.length > 0 ? data[0].period : null,
        latestDate: data.length > 0 ? data[0].date : null,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // /api/update - trigger update
    if (urlStr === '/api/update' || urlStr.endsWith('/api/update')) {
      try {
        const result = await doUpdate();
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ updated: false, reason: 'error', error: e.message }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    // data.json - return from localStorage
    if (urlStr === 'data.json' || urlStr.endsWith('/data.json')) {
      const data = loadDataArray();
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    }

    // Everything else - pass through
    return originalFetch.apply(this, arguments);
  };

  // ========== Update Logic ==========
  let isUpdating = false;

  async function doUpdate() {
    if (isUpdating) return { updated: false, reason: 'already_updating' };
    isUpdating = true;

    try {
      const html = await nativeFetch(`${BASE_URL}/ygkj/wqkjgg/ssq/`);
      const remote = parseLatestPeriod(html);

      if (!remote.period) return { updated: false, reason: 'fetch_failed' };

      const data = loadDataArray();
      const latestLocal = data.length > 0 ? data[0].period : null;

      const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
        || !entry.pool || entry.pool === '_'
        || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
        || !entry.firstPrizeDetail;

      if (remote.period === latestLocal && !isIncomplete(data[0])) {
        return { updated: false, reason: 'up_to_date', period: latestLocal };
      }

      // Fetch detail
      let detail = { prizes: {}, firstPrizeDetail: '', nextPool: '' };
      if (remote.detailUrl) {
        try {
          const detailUrl = remote.detailUrl.startsWith('http') ? remote.detailUrl : `${BASE_URL}${remote.detailUrl}`;
          const detailHtml = await nativeFetch(detailUrl);
          detail = parseDetail(detailHtml);
        } catch (e) { /* ignore detail errors */ }
      }

      const newEntry = {
        period: remote.period, date: remote.date, red: remote.red, blue: remote.blue,
        sales: remote.sales, pool: remote.pool,
        firstPrizeCount: remote.firstPrizeCount, firstPrizeAmount: remote.firstPrizeAmount,
        secondPrizeCount: remote.secondPrizeCount, secondPrizeAmount: remote.secondPrizeAmount,
        prizes: detail.prizes, firstPrizeDetail: detail.firstPrizeDetail, nextPool: detail.nextPool,
      };

      if (!newEntry.red || newEntry.red.length !== 6 || !newEntry.blue) {
        return { updated: false, reason: 'invalid_data' };
      }

      const existIdx = data.findIndex(d => d.period === remote.period);
      if (existIdx >= 0) { data[existIdx] = newEntry; }
      else { data.unshift(newEntry); }

      saveDataArray(data);
      // Refresh page data
      if (window.LOTTERY_DATA) {
        window.LOTTERY_DATA.length = 0;
        data.forEach(d => window.LOTTERY_DATA.push(d));
        if (typeof window.initApp === 'function') window.initApp();
      }

      return { updated: true, period: remote.period, total: data.length };
    } catch (e) {
      return { updated: false, reason: 'error', error: e.message };
    } finally {
      isUpdating = false;
    }
  }

  // ========== Init: load initial data if localStorage is empty ==========
  async function initMobileData() {
    let data = loadDataArray();
    if (data.length === 0) {
      // Try loading from bundled data.json
      try {
        const resp = await originalFetch('data.json');
        data = await resp.json();
        if (data.length > 0) saveDataArray(data);
      } catch { /* no bundled data */ }
    }
    // Make data available globally
    if (!window.LOTTERY_DATA) window.LOTTERY_DATA = [];
    if (window.LOTTERY_DATA.length === 0 && data.length > 0) {
      data.forEach(d => window.LOTTERY_DATA.push(d));
    }
  }

  // Run init early
  initMobileData();

  console.log('[Mobile Bridge] 已初始化');
})();
