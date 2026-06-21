// ========== Mobile Bridge: Replace server API with client-side logic ==========
(function() {
  'use strict';

  const DATA_KEY = 'ssq_lottery_data';
  const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/249134568/ssq-data/master/data.json';
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
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
          const { CapacitorHttp } = window.Capacitor.Plugins;
          const resp = await CapacitorHttp.request({
            url: url,
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            responseType: 'text',
          });
          return resp.data;
        }
        const resp = await fetch(url);
        return await resp.text();
      } catch (e) {
        if (i === retries - 1) throw e;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
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
      // Fetch latest data from GitHub Raw (auto-updated by GitHub Actions)
      const remoteData = await fetchGithubData();
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
          // Update if remote has more complete data
          if (isIncomplete(localData[existIdx]) && !isIncomplete(remoteEntry)) {
            localData[existIdx] = remoteEntry;
            changed = true;
          }
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
      // Browser fallback
      const resp = await originalFetch(GITHUB_RAW_URL);
      return await resp.json();
    } catch (e) {
      console.error('[Mobile Bridge] GitHub Raw 获取失败:', e.message);
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
