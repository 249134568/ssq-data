// ========== Mobile Bridge: Replace server API with client-side logic ==========
(function() {
  'use strict';

  const DATA_KEY = 'ssq_lottery_data';
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/249134568/ssq-data/master/data.json';
  const API_500_XML = 'https://kaijiang.500.com/static/info/kaijiang/xml/ssq/list.xml';
  const API_500_CHART = 'https://datachart.500.com/ssq/history/newinc/history.php';
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
      // Try GitHub Raw first (auto-updated by GitHub Actions), fallback to 500.com API
      let remoteData = await fetchGithubData();

      if (!remoteData || remoteData.length === 0) {
        console.log('[Mobile Bridge] GitHub Raw 无数据，尝试 500.com API...');
        remoteData = await fetch500Data();
      }

      if (!remoteData || remoteData.length === 0) {
        return { updated: false, reason: 'fetch_failed' };
      }

      const remoteLatest = remoteData[0];
      if (!remoteLatest.period || !remoteLatest.red || remoteLatest.red.length !== 6) {
        return { updated: false, reason: 'invalid_data' };
      }

      const localData = loadDataArray();
      const latestLocal = localData.length > 0 ? localData[0].period : null;

      const isIncomplete = (entry) => !entry.sales || entry.sales === '_'
        || !entry.pool || entry.pool === '_'
        || !entry.firstPrizeCount || entry.firstPrizeCount === '_'
        || !entry.firstPrizeDetail;

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
      return { updated: false, reason: 'error', error: e.message };
    } finally {
      isUpdating = false;
    }
  }

  // Fetch data from GitHub Raw (no anti-bot, plain JSON)
  async function fetchGithubData() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { CapacitorHttp } = window.Capacitor.Plugins;
        const resp = await CapacitorHttp.request({
          url: GITHUB_RAW_URL,
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          responseType: 'text',
        });
        return JSON.parse(resp.data);
      }
      const resp = await originalFetch(GITHUB_RAW_URL);
      return await resp.json();
    } catch (e) {
      console.error('[Mobile Bridge] GitHub Raw 获取失败:', e.message);
      return null;
    }
  }

  // Fetch data from 500.com API (no anti-bot, XML + HTML)
  async function fetch500Data() {
    try {
      // Step 1: Get XML for basic draw results
      const xml = await nativeFetchText(API_500_XML);
      if (!xml || !xml.includes('<row')) return null;

      const xmlRows = [];
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
          xmlRows.push({ period: fullPeriod, red, blue, date: `${dateStr}(${dayOfWeek})` });
        }
      }

      if (xmlRows.length === 0) return null;

      // Step 2: Get datachart for detailed data (last 5 periods)
      const latestShort = xmlRows[0].period.slice(-5);
      const startPeriod = String(Number(latestShort) - 4);
      const chartHtml = await nativeFetchText(`${API_500_CHART}?start=${startPeriod}&end=${latestShort}`);

      const chartMap = {};
      if (chartHtml) {
        const trRegex = /<tr\s+class="t_tr1"[^>]*>([\s\S]*?)<\/tr>/g;
        let trMatch;
        while ((trMatch = trRegex.exec(chartHtml)) !== null) {
          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
          const cells = [];
          let tdMatch;
          while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
            cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
          }
          const cleanCells = cells.filter(c => !c.startsWith('<!--'));
          if (cleanCells.length >= 16) {
            const period = cleanCells[0];
            const fullPeriod = period.length === 5 ? '20' + period : period;
            const red = cleanCells.slice(1, 7).map(n => parseInt(n.trim(), 10));
            const blue = parseInt(cleanCells[7].trim(), 10);
            if (red.length === 6 && red.every(n => n > 0) && blue > 0) {
              chartMap[fullPeriod] = {
                sales: cleanCells[14], pool: cleanCells[9],
                firstPrizeCount: cleanCells[10], firstPrizeAmount: cleanCells[11],
                secondPrizeCount: cleanCells[12], secondPrizeAmount: cleanCells[13],
              };
            }
          }
        }
      }

      // Merge XML + datachart data
      const results = [];
      for (const xmlRow of xmlRows) {
        const detail = chartMap[xmlRow.period] || {};
        results.push({
          period: xmlRow.period, date: xmlRow.date, red: xmlRow.red, blue: xmlRow.blue,
          sales: detail.sales || '', pool: detail.pool || '',
          firstPrizeCount: detail.firstPrizeCount || '', firstPrizeAmount: detail.firstPrizeAmount || '',
          secondPrizeCount: detail.secondPrizeCount || '', secondPrizeAmount: detail.secondPrizeAmount || '',
          prizes: {}, firstPrizeDetail: '', nextPool: detail.pool || '',
        });
        // Only process recent 10 entries
        if (results.length >= 10) break;
      }

      return results.length > 0 ? results : null;
    } catch (e) {
      console.error('[Mobile Bridge] 500.com API 获取失败:', e.message);
      return null;
    }
  }

  // Native fetch that returns text (for XML/HTML APIs)
  async function nativeFetchText(url) {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { CapacitorHttp } = window.Capacitor.Plugins;
        const resp = await CapacitorHttp.request({
          url: url,
          method: 'GET',
          headers: { 'Accept': 'text/html,application/xml,*/*' },
          responseType: 'text',
        });
        return resp.data;
      }
      const resp = await originalFetch(url);
      return await resp.text();
    } catch (e) {
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
