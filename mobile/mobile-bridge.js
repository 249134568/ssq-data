// ========== Mobile Bridge: Replace server API with client-side logic ==========
(function() {
  'use strict';

  const DATA_KEY = 'ssq_lottery_data';
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/249134568/ssq-data/master/data.json';
  const GITHUB_RAW_FALLBACKS = [
    'https://cdn.jsdelivr.net/gh/249134568/ssq-data@master/data.json',
    'https://fastly.jsdelivr.net/gh/249134568/ssq-data@master/data.json',
  ];
  const CWL_HOME = 'https://www.cwl.gov.cn/';
  const CWL_API = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice';
  const API_500_XML = 'https://kaijiang.500.com/static/info/kaijiang/xml/ssq/list.xml';
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

  // ========== CapacitorHttp Helper ==========
  // CapacitorHttp.request() with responseType:'text' may return resp.data
  // as either a string or an already-parsed object (depending on version/Content-Type).
  // This helper normalizes the response to always return the expected type.
  async function capacitorHttpGet(url, expectType, extraHeaders = {}) {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return null;

    const { CapacitorHttp } = window.Capacitor.Plugins;
    const resp = await CapacitorHttp.request({
      url: url,
      method: 'GET',
      headers: {
        'Accept': expectType === 'json' ? 'application/json' : 'text/html,application/xml,*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        ...extraHeaders,
      },
      responseType: 'text',
    });

    const data = resp.data;

    if (expectType === 'json') {
      // If already parsed as object, return directly
      if (data && typeof data === 'object') return data;
      // If string, parse it
      if (typeof data === 'string') return JSON.parse(data);
      return null;
    }

    // expectType === 'text'
    if (typeof data === 'string') return data;
    // If somehow parsed as object, convert back to string
    if (data && typeof data === 'object') return JSON.stringify(data);
    return String(data || '');
  }

  // ========== API Overrides ==========
  const originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));

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
      // Try GitHub Raw first (auto-updated by GitHub Actions), fallback to 500.com API
      let remoteData = null;
      let source = '';

      try {
        remoteData = await fetchGithubData();
        if (remoteData && remoteData.length > 0) source = 'github';
      } catch (e) {
        console.warn('[Mobile Bridge] GitHub Raw 获取失败:', e.message);
      }

      if (!remoteData || remoteData.length === 0) {
        console.log('[Mobile Bridge] 尝试 cwl.gov.cn JSON API...');
        try {
          remoteData = await fetchCwlData(30);
          if (remoteData && remoteData.length > 0) source = 'cwl';
        } catch (e) {
          console.warn('[Mobile Bridge] cwl.gov.cn API 获取失败:', e.message);
        }
      }

      if (!remoteData || remoteData.length === 0) {
        console.log('[Mobile Bridge] 尝试 500.com XML 回退...');
        try {
          remoteData = await fetch500XmlFallback();
          if (remoteData && remoteData.length > 0) source = '500xml';
        } catch (e) {
          console.warn('[Mobile Bridge] 500.com XML 回退失败:', e.message);
        }
      }

      if (!remoteData || remoteData.length === 0) {
        console.error('[Mobile Bridge] 所有数据源均失败');
        return { updated: false, reason: 'fetch_failed', error: '无法连接服务器，请检查网络' };
      }

      const remoteLatest = remoteData[0];
      if (!remoteLatest.period || !remoteLatest.red || remoteLatest.red.length !== 6) {
        return { updated: false, reason: 'invalid_data', error: '数据格式异常' };
      }

      console.log(`[Mobile Bridge] 数据源: ${source}, 远程最新: ${remoteLatest.period}`);

      const localData = loadDataArray();
      const latestLocal = localData.length > 0 ? localData[0].period : null;

      const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
        || !entry.pool || entry.pool === '_'
        || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
        || !entry.firstPrizeDetail
        || !entry.prizes || Object.keys(entry.prizes).length === 0;

      if (remoteLatest.period === latestLocal && !isIncomplete(localData[0])) {
        return { updated: false, reason: 'up_to_date', period: latestLocal };
      }

      // Merge remote data into local: update existing or add new entries
      let changed = false;
      for (const remoteEntry of remoteData) {
        if (!remoteEntry.period || !remoteEntry.red || remoteEntry.red.length !== 6) continue;
        const existIdx = localData.findIndex(d => d.period === remoteEntry.period);
        if (existIdx >= 0) {
          // Merge: fill in missing fields from remote
          const existing = localData[existIdx];
          let merged = false;
          if (!existing.sales && remoteEntry.sales) { existing.sales = remoteEntry.sales; merged = true; }
          if (!existing.pool && remoteEntry.pool) { existing.pool = remoteEntry.pool; merged = true; }
          if (!existing.firstPrizeCount && remoteEntry.firstPrizeCount) { existing.firstPrizeCount = remoteEntry.firstPrizeCount; merged = true; }
          if (!existing.firstPrizeAmount && remoteEntry.firstPrizeAmount) { existing.firstPrizeAmount = remoteEntry.firstPrizeAmount; merged = true; }
          if (!existing.secondPrizeCount && remoteEntry.secondPrizeCount) { existing.secondPrizeCount = remoteEntry.secondPrizeCount; merged = true; }
          if (!existing.secondPrizeAmount && remoteEntry.secondPrizeAmount) { existing.secondPrizeAmount = remoteEntry.secondPrizeAmount; merged = true; }
          if (!existing.nextPool && remoteEntry.nextPool) { existing.nextPool = remoteEntry.nextPool; merged = true; }
          // Fill missing prizes + firstPrizeDetail (the bug we are fixing)
          if ((!existing.prizes || Object.keys(existing.prizes).length === 0) && remoteEntry.prizes && Object.keys(remoteEntry.prizes).length > 0) {
            existing.prizes = remoteEntry.prizes;
            merged = true;
          }
          if (!existing.firstPrizeDetail && remoteEntry.firstPrizeDetail) {
            existing.firstPrizeDetail = remoteEntry.firstPrizeDetail;
            merged = true;
          }
          // Always overwrite balls/date if remote has valid data (in case of corrections)
          if (remoteEntry.red && remoteEntry.red.length === 6 && remoteEntry.blue) {
            existing.red = remoteEntry.red;
            existing.blue = remoteEntry.blue;
            if (remoteEntry.date) existing.date = remoteEntry.date;
            merged = true;
          }
          if (merged) changed = true;
        } else {
          localData.push(remoteEntry);
          changed = true;
        }
      }

      // Sort by period descending
      localData.sort((a, b) => b.period.localeCompare(a.period));

      if (!changed && remoteLatest.period === latestLocal) {
        return { updated: false, reason: 'up_to_date', period: latestLocal };
      }

      saveDataArray(localData);

      // Refresh page data
      if (window.LOTTERY_DATA) {
        window.LOTTERY_DATA.length = 0;
        localData.forEach(d => window.LOTTERY_DATA.push(d));
        if (typeof window.initApp === 'function') window.initApp();
      }

      return { updated: true, period: remoteLatest.period, total: localData.length };
    } catch (e) {
      console.error('[Mobile Bridge] doUpdate 异常:', e);
      return { updated: false, reason: 'error', error: e.message };
    } finally {
      isUpdating = false;
    }
  }

  // Fetch data from GitHub Raw (no anti-bot, plain JSON) — with CDN fallbacks + retry
  async function fetchGithubData() {
    const urls = [GITHUB_RAW_URL, ...GITHUB_RAW_FALLBACKS];
    for (const url of urls) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            const data = await capacitorHttpGet(url, 'json');
            if (Array.isArray(data) && data.length > 0) return data;
          } else {
            const resp = await originalFetch(url, { cache: 'no-store' });
            if (resp.ok) {
              const data = await resp.json();
              if (Array.isArray(data) && data.length > 0) return data;
            }
          }
        } catch (e) {
          console.warn(`[Mobile Bridge] GitHub Raw ${url} 第 ${attempt} 次失败:`, e.message);
        }
      }
    }
    return null;
  }

  // Fetch data from cwl.gov.cn JSON API — complete prize data + first prize locations
  async function fetchCwlData(periods = 30) {
    // Step 1: warm up cookies (HMF_CI anti-bot)
    const home = await nativeFetchText(CWL_HOME);
    // Step 2: call JSON API
    const apiUrl = `${CWL_API}?name=ssq&issueNo=&pageSize=${periods}&pageNo=1&_=${Date.now()}`;
    const body = await nativeFetchText(apiUrl, {
      Cookie: extractCookies(home),
      Referer: 'https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/',
      Accept: 'application/json, text/plain, */*',
    });
    if (!body) return null;
    let json;
    try { json = JSON.parse(body); } catch { return null; }
    if (!json || json.state !== 0 || !Array.isArray(json.result)) return null;

    // Convert to our data.json format
    const results = [];
    for (const item of json.result) {
      const entry = convertCwlEntry(item);
      if (entry) results.push(entry);
    }
    return results.length > 0 ? results : null;
  }

  // Convert cwl.gov.cn API item to our data.json entry format
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

  // Extract Set-Cookie values from CapacitorHttp response headers (best-effort)
  function extractCookies(_homeBody) {
    // CapacitorHttp does not expose Set-Cookie headers reliably across versions;
    // cwl.gov.cn API works without cookies in most cases. If it starts rejecting,
    // we fall back to 500.com XML via fetch500XmlFallback below.
    return '';
  }

  // Fallback: 500.com XML for basic balls only (no prize detail)
  async function fetch500XmlFallback() {
    const xml = await nativeFetchText(API_500_XML);
    if (!xml || !xml.includes('<row')) return null;
    const results = [];
    const rowRegex = /<row\s+expect="(\d+)"\s+opencode="([^"]+)"\s+opentime="([^"]+)"/g;
    let match;
    while ((match = rowRegex.exec(xml)) !== null) {
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
        results.push({
          period: fullPeriod, date: `${dateStr}(${dayOfWeek})`,
          red, blue,
          sales: '', pool: '',
          firstPrizeCount: '', firstPrizeAmount: '',
          secondPrizeCount: '', secondPrizeAmount: '',
          prizes: {}, firstPrizeDetail: '', nextPool: '',
        });
        if (results.length >= 10) break;
      }
    }
    return results.length > 0 ? results : null;
  }

  // Native fetch that returns text (for XML/HTML APIs)
  async function nativeFetchText(url, extraHeaders = {}) {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      return await capacitorHttpGet(url, 'text', extraHeaders);
    }
    try {
      const resp = await originalFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...extraHeaders,
        },
      });
      return await resp.text();
    } catch {
      return null;
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

  // ========== Mobile UX Enhancements ==========
  function setupMobileUX() {
    // Add mobile meta tags
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }

    // Prevent pull-to-refresh
    document.body.style.overscrollBehavior = 'none';

    // Add mobile class for CSS targeting
    document.documentElement.classList.add('mobile-app');

    // Fix Worker path for Capacitor (https:// scheme)
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
      const origWorker = window.Worker;
      window.Worker = function(url, options) {
        if (typeof url === 'string' && !url.startsWith('http') && !url.startsWith('/') && !url.startsWith('blob:')) {
          url = new URL(url, window.location.href).href;
        }
        return new origWorker(url, options);
      };
      window.Worker.prototype = origWorker.prototype;
    }

    // Smooth scroll to active tab content
    document.addEventListener('click', function(e) {
      const tab = e.target.closest('.nav-tab');
      if (tab) {
        tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });

    // Fast click: remove 300ms tap delay
    document.addEventListener('touchstart', function() {}, { passive: true });
  }

  // Run both inits
  initMobileData();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMobileUX);
  } else {
    setupMobileUX();
  }

  console.log('[Mobile Bridge] 已初始化');
})();
