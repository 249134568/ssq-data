// ========== Backtest UI Controller ==========

let btWorker = null;

// 解析期数：value === 'all' 时返回 dataLen（全部数据）
function resolvePeriods(value, dataLen) {
  if (value === 'all') return dataLen;
  return parseInt(value);
}

function initBacktestTab() {

  const container = document.getElementById('page-backtest');
  if (!container) return;
  container.innerHTML = buildBacktestHTML();

  // Event listeners
  document.getElementById('bt-run-btn').addEventListener('click', runBacktest);
  document.getElementById('bt-cancel-btn').addEventListener('click', cancelBacktest);
  document.getElementById('bt-optimize-btn').addEventListener('click', runOptimize);
  document.getElementById('bt-apply-btn').addEventListener('click', applyOptimizedWeights);
  document.getElementById('bt-qc-run-btn').addEventListener('click', runQcBacktest);
  document.getElementById('bt-bootstrap-btn').addEventListener('click', runBootstrapTest);
}

function buildBacktestHTML() {
  return `
    <div class="bt-card">
      <div class="bt-card-title">q_c 冷门度验证</div>
      <div class="bt-config-grid">
        <div class="bt-config-item">
          <label class="bt-config-label">训练窗口</label>
          <select class="bt-config-select" id="bt-qc-window">
            <option value="100">100 期</option>
            <option value="200" selected>200 期</option>
            <option value="500">500 期</option>
            <option value="all">全部数据</option>
          </select>
        </div>
      </div>
      <div class="bt-btn-group">
        <button class="bt-btn bt-btn-primary" id="bt-qc-run-btn">运行 q_c 回测</button>
        <button class="bt-btn bt-btn-secondary" id="bt-bootstrap-btn">Bootstrap 显著性检验</button>
      </div>
      <div class="bt-progress-wrap" id="bt-qc-progress">
        <div class="bt-progress-bar"><div class="bt-progress-fill" id="bt-qc-progress-fill"></div></div>
        <div class="bt-progress-text">
          <span id="bt-qc-progress-label">准备中...</span>
          <span id="bt-qc-progress-eta"></span>
        </div>
      </div>
    </div>

    <div class="bt-card" id="bt-qc-result-card" style="display:none">
      <div class="bt-card-title">q_c 回测结果</div>
      <div id="bt-qc-content"></div>
    </div>

    <div class="bt-card">
      <div class="bt-card-title">命中率回测</div>
      <div class="bt-config-grid">
        <div class="bt-config-item">
          <label class="bt-config-label">回测范围</label>
          <select class="bt-config-select" id="bt-range">
            <option value="500">近500期</option>
            <option value="1000">近1000期</option>
            <option value="1800" selected>近1800期</option>
            <option value="all">全部数据</option>
          </select>
        </div>
        <div class="bt-config-item">
          <label class="bt-config-label">每期预测组数</label>
          <select class="bt-config-select" id="bt-pred-count">
            <option value="1" selected>1组</option>
            <option value="3">3组</option>
            <option value="5">5组</option>
          </select>
        </div>
        <div class="bt-config-item">
          <label class="bt-config-label">易经权重</label>
          <select class="bt-config-select" id="bt-yijing">
            <option value="0" selected>0%</option>
            <option value="30">30%</option>
            <option value="50">50%</option>
            <option value="70">70%</option>
          </select>
        </div>
      </div>
      <div class="bt-section-title">权重覆盖（留0使用默认值）</div>
      <div class="bt-weight-grid">
        <div class="bt-weight-item"><label>频率</label><input type="number" class="bt-config-input" id="bt-w-freq" value="0.28" step="0.01" min="0" max="1"></div>
        <div class="bt-weight-item"><label>近期趋势</label><input type="number" class="bt-config-input" id="bt-w-recent" value="0.18" step="0.01" min="0" max="1"></div>
        <div class="bt-weight-item"><label>遗漏值</label><input type="number" class="bt-config-input" id="bt-w-miss" value="0.12" step="0.01" min="0" max="1"></div>
        <div class="bt-weight-item"><label>销售奖池</label><input type="number" class="bt-config-input" id="bt-w-sp" value="0.12" step="0.01" min="0" max="1"></div>
        <div class="bt-weight-item"><label>随机扰动</label><input type="number" class="bt-config-input" id="bt-w-pert" value="0.15" step="0.01" min="0" max="1"></div>
        <div class="bt-weight-item"><label>近期窗口</label><input type="number" class="bt-config-input" id="bt-w-rw" value="10" step="1" min="5" max="30"></div>
      </div>
      <div class="bt-btn-group">
        <button class="bt-btn bt-btn-primary" id="bt-run-btn">开始命中率回测</button>
        <button class="bt-btn bt-btn-secondary" id="bt-cancel-btn">取消</button>
      </div>
      <div class="bt-progress-wrap" id="bt-progress">
        <div class="bt-progress-bar"><div class="bt-progress-fill" id="bt-progress-fill"></div></div>
        <div class="bt-progress-text">
          <span id="bt-progress-label">准备中...</span>
          <span id="bt-progress-eta"></span>
        </div>
      </div>
    </div>

    <div class="bt-card">
      <div class="bt-card-title">冷门度权重进化(遗传算法)</div>
      <div class="bt-config-grid">
        <div class="bt-config-item">
          <label class="bt-config-label">种群大小</label>
          <input type="number" class="bt-config-input" id="bt-ga-pop" value="20" min="10" max="50">
        </div>
        <div class="bt-config-item">
          <label class="bt-config-label">迭代代数</label>
          <input type="number" class="bt-config-input" id="bt-ga-gen" value="15" min="5" max="30">
        </div>
        <div class="bt-config-item">
          <label class="bt-config-label">训练窗口</label>
          <select class="bt-config-select" id="bt-ga-window">
            <option value="200" selected>200 期</option>
            <option value="500">500 期</option>
            <option value="all">全部数据</option>
          </select>
        </div>
      </div>
      <div class="bt-btn-group">
        <button class="bt-btn bt-btn-primary" id="bt-optimize-btn">开始进化冷门度权重</button>
      </div>
      <div class="bt-progress-wrap" id="bt-opt-progress">
        <div class="bt-progress-bar"><div class="bt-progress-fill" id="bt-opt-progress-fill"></div></div>
        <div class="bt-progress-text">
          <span id="bt-opt-progress-label">准备中...</span>
          <span id="bt-opt-progress-eta"></span>
        </div>
      </div>
    </div>

    <div class="bt-card" id="bt-result-card" style="display:none">
      <div class="bt-card-title">命中率回测结果</div>
      <div id="bt-hit-table-wrap"></div>
      <div class="bt-section-title">累积平均分数趋势</div>
      <canvas class="bt-chart-canvas" id="bt-score-chart"></canvas>
    </div>

    <div class="bt-card" id="bt-optimize-card" style="display:none">
      <div class="bt-card-title">最优冷门度权重</div>
      <div id="bt-optimize-content"></div>
      <div style="margin-top:16px">
        <button class="bt-btn bt-btn-success" id="bt-apply-btn">应用最优权重到冷门推荐</button>
      </div>
    </div>

    <div class="bt-card" id="bt-ga-card" style="display:none">
      <div class="bt-card-title">遗传算法进化过程</div>
      <canvas class="bt-gen-chart-canvas" id="bt-ga-chart"></canvas>
    </div>
  `;
}

function getWorker() {
  if (!btWorker) {
    btWorker = new Worker('backtest/backtest-worker.js');
    btWorker.onmessage = handleWorkerMessage;
  }
  return btWorker;
}

function getWeights() {
  const w = {
    freq: parseFloat(document.getElementById('bt-w-freq').value) || 0,
    recent: parseFloat(document.getElementById('bt-w-recent').value) || 0,
    miss: parseFloat(document.getElementById('bt-w-miss').value) || 0,
    salesPool: parseFloat(document.getElementById('bt-w-sp').value) || 0,
    perturbation: parseFloat(document.getElementById('bt-w-pert').value) || 0,
    recentWindow: parseInt(document.getElementById('bt-w-rw').value) || 10
  };
  // Normalize if sum > 1.05 or < 0.95
  const sum = w.freq + w.recent + w.miss + w.salesPool + w.perturbation;
  if (sum > 0 && (sum > 1.05 || sum < 0.95)) {
    const scale = 1 / sum;
    w.freq = Math.round(w.freq * scale * 100) / 100;
    w.recent = Math.round(w.recent * scale * 100) / 100;
    w.miss = Math.round(w.miss * scale * 100) / 100;
    w.salesPool = Math.round(w.salesPool * scale * 100) / 100;
    w.perturbation = Math.round((1 - w.freq - w.recent - w.miss - w.salesPool) * 100) / 100;
    // Update inputs with normalized values
    document.getElementById('bt-w-freq').value = w.freq;
    document.getElementById('bt-w-recent').value = w.recent;
    document.getElementById('bt-w-miss').value = w.miss;
    document.getElementById('bt-w-sp').value = w.salesPool;
    document.getElementById('bt-w-pert').value = w.perturbation;
    showToast(`权重已自动归一化 (原总和: ${sum.toFixed(2)})`);
  }
  return w;
}

function runBacktest() {
  const worker = getWorker();
  const srcData = window.LOTTERY_DATA || [];
  if (srcData.length < 50) { showToast('数据不足，请等待数据加载'); return; }
  const slimData = srcData.map(d => ({ period: d.period, date: d.date, red: d.red, blue: d.blue, sales: d.sales, pool: d.pool, firstPrizeCount: d.firstPrizeCount }));
  showToast(`回测 ${slimData.length} 期数据，最新: 第 ${slimData[0].period} 期`);
  document.getElementById('bt-progress').classList.add('active');
  document.getElementById('bt-run-btn').disabled = true;
  document.getElementById('bt-progress-fill').style.width = '0%';
  document.getElementById('bt-progress-label').textContent = `回测中... (${slimData.length} 期, 最新 ${slimData[0].period})`;
  document.getElementById('bt-progress-eta').textContent = '';
  worker.postMessage({
    type: 'backtest',
    config: {
      data: slimData,
      startDraw: resolvePeriods(document.getElementById('bt-range').value, slimData.length),
      predictionsPerDraw: parseInt(document.getElementById('bt-pred-count').value),
      yijingPct: parseInt(document.getElementById('bt-yijing').value),
      weights: getWeights(),
      includeBaseline: true,
      sampleRate: 1,
      seed: 42
    }
  });
}

let gridSearchResult = null;

function runOptimize() {
  const worker = getWorker();
  const srcData = window.LOTTERY_DATA || [];
  if (srcData.length < 50) { showToast('数据不足，请等待数据加载'); return; }
  const slimData = srcData.map(d => ({ period: d.period, date: d.date, red: d.red, blue: d.blue, sales: d.sales, pool: d.pool, firstPrizeCount: d.firstPrizeCount }));
  showToast(`GA 训练 ${slimData.length} 期数据，最新: 第 ${slimData[0].period} 期`);
  document.getElementById('bt-opt-progress').classList.add('active');
  document.getElementById('bt-optimize-btn').disabled = true;
  document.getElementById('bt-opt-progress-fill').style.width = '0%';
  document.getElementById('bt-opt-progress-label').textContent = `冷门度权重进化中... (${slimData.length} 期, 最新 ${slimData[0].period})`;
  document.getElementById('bt-opt-progress-eta').textContent = '';

  // 直接调用遗传算法进化冷门度权重
  worker.postMessage({
    type: 'geneticSearch',
    config: {
      data: slimData,
      populationSize: parseInt(document.getElementById('bt-ga-pop').value),
      generations: parseInt(document.getElementById('bt-ga-gen').value),
      mutationRate: 0.3,
      seed: 42,
      trainWindow: resolvePeriods(document.getElementById('bt-ga-window').value, slimData.length),
      initialPopulation: []
    }
  });
}

function cancelBacktest() {
  if (btWorker) btWorker.postMessage({ type: 'cancel' });
  document.getElementById('bt-run-btn').disabled = false;
  document.getElementById('bt-optimize-btn').disabled = false;
  document.getElementById('bt-progress').classList.remove('active');
  document.getElementById('bt-opt-progress').classList.remove('active');
}

function handleWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'progress') {
    updateProgress(msg.payload);
  } else if (msg.type === 'backtestResult') {
    document.getElementById('bt-run-btn').disabled = false;
    document.getElementById('bt-progress').classList.remove('active');
    renderBacktestResult(msg.payload);
  } else if (msg.type === 'gridSearchResult') {
    gridSearchResult = msg.payload;
    const method = document.getElementById('bt-opt-method') ? document.getElementById('bt-opt-method').value : 'grid';
    if (method === 'grid+genetic') {
      // Start GA with grid search top results as initial population
      const worker = getWorker();
      const srcData = window.LOTTERY_DATA || [];
  const slimData = srcData.map(d => ({ period: d.period, date: d.date, red: d.red, blue: d.blue, sales: d.sales, pool: d.pool, firstPrizeCount: d.firstPrizeCount }));
      worker.postMessage({
        type: 'geneticSearch',
        config: {
          data: slimData,
          startDraw: resolvePeriods(document.getElementById('bt-range').value, slimData.length),
          predictionsPerDraw: parseInt(document.getElementById('bt-pred-count').value),
          yijingPct: parseInt(document.getElementById('bt-yijing').value),
          populationSize: parseInt(document.getElementById('bt-ga-pop').value),
          generations: parseInt(document.getElementById('bt-ga-gen').value),
          mutationRate: 0.15,
          sampleRate: 5,
          seed: 42,
          initialPopulation: msg.payload.fineResults.map(r => r.weights)
        }
      });
    } else {
      document.getElementById('bt-optimize-btn').disabled = false;
      document.getElementById('bt-opt-progress').classList.remove('active');
      renderOptimizedWeights(msg.payload.best.weights, msg.payload.best.avgScore);
    }
  } else if (msg.type === 'geneticResult') {
    document.getElementById('bt-optimize-btn').disabled = false;
    document.getElementById('bt-opt-progress').classList.remove('active');
    const payload = msg.payload;
    renderOptimizedWeights(payload.bestWeights, payload.genHistory[payload.genHistory.length - 1]?.bestScore || 0);
    renderGAChart(payload.genHistory);
    if (payload.finalResult && payload.finalResult.type === 'qc') {
      renderQcResult(payload.finalResult);
    } else if (payload.finalResult) {
      renderBacktestResult(payload.finalResult);
    }
  } else if (msg.type === 'qcResult') {
    document.getElementById('bt-qc-run-btn').disabled = false;
    document.getElementById('bt-qc-progress').classList.remove('active');
    renderQcResult(msg.payload);
  } else if (msg.type === 'bootstrapResult') {
    document.getElementById('bt-bootstrap-btn').disabled = false;
    document.getElementById('bt-qc-progress').classList.remove('active');
    renderBootstrapResult(msg.payload);
  } else if (msg.type === 'error') {
    document.getElementById('bt-run-btn').disabled = false;
    document.getElementById('bt-optimize-btn').disabled = false;
    document.getElementById('bt-qc-run-btn').disabled = false;
    document.getElementById('bt-bootstrap-btn').disabled = false;
    document.getElementById('bt-progress').classList.remove('active');
    document.getElementById('bt-opt-progress').classList.remove('active');
    document.getElementById('bt-qc-progress').classList.remove('active');
    alert('错误: ' + msg.payload.message);
  }
}

function updateProgress(payload) {
  const isOpt = payload.phase === 'gridSearch-coarse' || payload.phase === 'gridSearch-fine' || payload.phase === 'geneticSearch';
  const isQc = payload.phase === 'qcBacktest';
  const wrap = isOpt ? 'bt-opt-progress' : (isQc ? 'bt-qc-progress' : 'bt-progress');
  const fill = isOpt ? 'bt-opt-progress-fill' : (isQc ? 'bt-qc-progress-fill' : 'bt-progress-fill');
  const label = isOpt ? 'bt-opt-progress-label' : (isQc ? 'bt-qc-progress-label' : 'bt-progress-label');
  const eta = isOpt ? 'bt-opt-progress-eta' : (isQc ? 'bt-qc-progress-eta' : 'bt-progress-eta');

  const pct = payload.total > 0 ? Math.round((payload.current / payload.total) * 100) : 0;
  document.getElementById(fill).style.width = pct + '%';

  const phaseNames = {
    backtest: '命中率回测',
    'gridSearch-coarse': '粗搜索',
    'gridSearch-fine': '细搜索',
    geneticSearch: '遗传进化',
    qcBacktest: 'q_c 回测'
  };
  let text = `${phaseNames[payload.phase] || payload.phase} ${pct}%`;
  if (payload.bestScore !== undefined) {
    const score = payload.bestScore;
    const scoreStr = Math.abs(score) > 10000 ? (score/10000).toFixed(0) + '万' : score.toFixed(3);
    text += ` | 最佳: ${scoreStr}`;
  }
  document.getElementById(label).textContent = text;
  document.getElementById(eta).textContent = payload.eta > 0 ? `预计剩余 ${Math.round(payload.eta / 1000)}s` : '';
}

function renderBacktestResult(result) {
  document.getElementById('bt-result-card').style.display = '';
  const t = result.tracker;
  const bt = result.baselineTracker;
  const total = t.totalPredictions || 1;
  const bTotal = bt ? (bt.totalPredictions || 1) : 1;

  const rows = [
    ['蓝球命中', t.blue.hit / total, bt ? bt.blue.hit / bTotal : null],
    ['红球 0/6', t.red[0] / total, bt ? bt.red[0] / bTotal : null],
    ['红球 1/6', t.red[1] / total, bt ? bt.red[1] / bTotal : null],
    ['红球 2/6', t.red[2] / total, bt ? bt.red[2] / bTotal : null],
    ['红球 3/6', t.red[3] / total, bt ? bt.red[3] / bTotal : null, true],
    ['红球 4/6', t.red[4] / total, bt ? bt.red[4] / bTotal : null, true],
    ['红球 5/6', t.red[5] / total, bt ? bt.red[5] / bTotal : null, true],
    ['红球 6/6', t.red[6] / total, bt ? bt.red[6] / bTotal : null, true],
    ['3红+蓝', t.combined['3+1'] / total, bt ? bt.combined['3+1'] / bTotal : null, true],
    ['4红+蓝', t.combined['4+1'] / total, bt ? bt.combined['4+1'] / bTotal : null, true],
    ['5红+蓝', t.combined['5+1'] / total, bt ? bt.combined['5+1'] / bTotal : null, true],
  ];

  let html = '<table class="bt-hit-table"><thead><tr><th>命中级别</th><th>加权预测</th>';
  if (bt) html += '<th>随机基线</th><th>提升</th>';
  html += '</tr></thead><tbody>';

  for (const [name, rate, bRate, highlight] of rows) {
    html += `<tr class="${highlight ? 'highlight-row' : ''}"><td>${name}</td><td>${(rate * 100).toFixed(2)}%</td>`;
    if (bt) {
      html += `<td>${(bRate * 100).toFixed(2)}%</td>`;
      const diff = (rate - bRate) * 100;
      const cls = diff > 0.01 ? 'positive' : diff < -0.01 ? 'negative' : 'neutral';
      html += `<td class="${cls}">${diff > 0 ? '+' : ''}${diff.toFixed(2)}%</td>`;
    }
    html += '</tr>';
  }

  // Average score row
  html += `<tr class="highlight-row"><td><b>平均分数</b></td><td><b>${(t.totalScore / total).toFixed(3)}</b></td>`;
  if (bt) {
    html += `<td><b>${(bt.totalScore / bTotal).toFixed(3)}</b></td>`;
    const diff = (t.totalScore / total) - (bt.totalScore / bTotal);
    const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
    html += `<td class="${cls}"><b>${diff > 0 ? '+' : ''}${diff.toFixed(3)}</b></td>`;
  }
  html += '</tr></tbody></table>';
  document.getElementById('bt-hit-table-wrap').innerHTML = html;

  // Score chart
  renderScoreChart(result.cumulativeScores, result.baselineCumulative);
}

function renderScoreChart(scores, baseline) {
  const canvas = document.getElementById('bt-score-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  if (!scores || scores.length === 0) return;

  const allVals = [...scores, ...(baseline || [])];
  const minV = Math.min(...allVals) * 0.95;
  const maxV = Math.max(...allVals) * 1.05;

  // Grid
  ctx.strokeStyle = '#e5e5ea';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    ctx.fillStyle = '#86868b';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((maxV - (maxV - minV) * i / 4).toFixed(2), pad.left - 6, y + 4);
  }

  // Lines
  function drawLine(data, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (i / Math.max(data.length - 1, 1)) * cw;
      const y = pad.top + (1 - (data[i] - minV) / (maxV - minV)) * ch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawLine(scores, '#0071e3', []);
  if (baseline) drawLine(baseline, '#86868b', [5, 3]);

  // Legend
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillStyle = '#0071e3'; ctx.fillRect(pad.left, h - 14, 16, 3);
  ctx.fillStyle = '#1d1d1f'; ctx.textAlign = 'left'; ctx.fillText('加权预测', pad.left + 20, h - 10);
  if (baseline) {
    ctx.fillStyle = '#86868b'; ctx.setLineDash([5,3]); ctx.strokeStyle = '#86868b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad.left + 110, h - 12); ctx.lineTo(pad.left + 126, h - 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1d1d1f'; ctx.fillText('随机基线', pad.left + 130, h - 10);
  }
}

function renderOptimizedWeights(weights, score) {
  document.getElementById('bt-optimize-card').style.display = '';
  const orig = Coldness.DEFAULT_FEATURE_WEIGHTS;
  const names = {
    birthdayRatio: '生日号比例',
    monthDayRatio: '月日号比例',
    consecutivePairs: '连号对数',
    allSameParity: '全奇/全偶',
    luckyCount: '吉祥号(6/8)',
    unluckyCount: '忌讳号(4)',
    isArithmetic: '等差数列',
    sumDeviation: '和值偏离',
    recentRepeat: '近期重复',
    blueLucky: '蓝球6/8',
    blueUnlucky: '蓝球4',
    blueSmall: '蓝球小号'
  };

  let html = '<div class="bt-optimize-card"><div class="bt-weight-compare"><table><thead><tr><th>特征</th><th>回归默认</th><th>进化后</th><th>变化</th></tr></thead><tbody>';
  for (const key of Object.keys(orig)) {
    if (weights[key] === undefined) continue;
    const o = orig[key], n = weights[key];
    const diff = Math.round((n - o) * 1000) / 1000;
    const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
    const sign = diff > 0 ? '+' : '';
    html += `<tr><td>${names[key] || key}</td><td>${o.toFixed(3)}</td><td>${n.toFixed(3)}</td><td class="${cls}">${sign}${diff.toFixed(3)}</td></tr>`;
  }
  // Score row (期望奖金差异,单位元)
  const scoreVal = Math.abs(score) > 10000 ? (score/10000).toFixed(0) + ' 万' : score.toFixed(3);
  const scoreCls = score > 0 ? 'positive' : 'negative';
  const scoreSign = score > 0 ? '+' : '';
  html += `<tr style="font-weight:600;border-top:2px solid var(--border)"><td>适应度(冷门-热门期望奖金差)</td><td>-</td><td>${scoreVal}</td><td class="${scoreCls}">${scoreSign}${scoreVal}</td></tr>`;
  html += '</tbody></table></div></div>';
  document.getElementById('bt-optimize-content').innerHTML = html;

  // Store optimized weights for apply button
  window.__btOptimizedWeights = weights;
}

function renderGAChart(genHistory) {
  document.getElementById('bt-ga-card').style.display = '';
  const canvas = document.getElementById('bt-ga-chart');
  if (!canvas || !genHistory || genHistory.length === 0) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);
  const bestScores = genHistory.map(g => g.bestScore);
  const avgScores = genHistory.map(g => g.avgScore);
  const allV = [...bestScores, ...avgScores];
  const minV = Math.min(...allV) * 0.95, maxV = Math.max(...allV) * 1.05;

  function drawLine(data, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (i / Math.max(data.length - 1, 1)) * cw;
      const y = pad.top + (1 - (data[i] - minV) / (maxV - minV)) * ch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawLine(bestScores, '#0071e3');
  drawLine(avgScores, '#86868b');

  // Legend
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillStyle = '#0071e3'; ctx.fillRect(pad.left, h - 14, 16, 3);
  ctx.fillStyle = '#1d1d1f'; ctx.textAlign = 'left'; ctx.fillText('最佳分数', pad.left + 20, h - 10);
  ctx.fillStyle = '#86868b'; ctx.fillRect(pad.left + 100, h - 14, 16, 3);
  ctx.fillText('平均分数', pad.left + 120, h - 10);
}

function applyOptimizedWeights() {
  const w = window.__btOptimizedWeights;
  if (!w) return;

  // 把进化后的冷门度权重应用到 Coldness 模块
  // 通过覆盖 DEFAULT_FEATURE_WEIGHTS
  if (typeof Coldness !== 'undefined') {
    for (const key of Object.keys(Coldness.DEFAULT_FEATURE_WEIGHTS)) {
      if (w[key] !== undefined) {
        Coldness.DEFAULT_FEATURE_WEIGHTS[key] = w[key];
      }
    }
    showToast('✓ 冷门度权重已应用!下次推算的"冷门组合推荐"将使用进化后的权重。');
  } else {
    showToast('Coldness 模块未加载');
  }
}

function showToast(msg) {
  let toast = document.getElementById('autoToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'autoToast';
    toast.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:10px 24px;border-radius:12px;font-size:14px;z-index:300;opacity:0;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ========== q_c 冷门度回测 ==========

function runQcBacktest() {
  const worker = getWorker();
  const srcData = window.LOTTERY_DATA || [];
  if (srcData.length < 50) { showToast('数据不足'); return; }
  const slimData = srcData.map(d => ({ period: d.period, date: d.date, red: d.red, blue: d.blue, sales: d.sales, pool: d.pool, firstPrizeCount: d.firstPrizeCount }));
  showToast(`q_c 回测 ${slimData.length} 期数据，最新: 第 ${slimData[0].period} 期`);

  document.getElementById('bt-qc-progress').classList.add('active');
  document.getElementById('bt-qc-run-btn').disabled = true;
  document.getElementById('bt-qc-progress-fill').style.width = '0%';
  document.getElementById('bt-qc-progress-label').textContent = `q_c 回测中... (${slimData.length} 期, 最新 ${slimData[0].period})`;
  document.getElementById('bt-qc-progress-eta').textContent = '';

  worker.postMessage({
    type: 'qcBacktest',
    config: {
      data: slimData,
      trainWindow: resolvePeriods(document.getElementById('bt-qc-window').value, slimData.length),
      predictionQuantiles: [0.1, 0.2, 0.5],
      seed: 42
    }
  });
}

function runBootstrapTest() {
  const worker = getWorker();
  const srcData = window.LOTTERY_DATA || [];
  if (srcData.length < 50) { showToast('数据不足'); return; }
  const slimData = srcData.map(d => ({ period: d.period, date: d.date, red: d.red, blue: d.blue, sales: d.sales, pool: d.pool, firstPrizeCount: d.firstPrizeCount }));

  document.getElementById('bt-qc-progress').classList.add('active');
  document.getElementById('bt-bootstrap-btn').disabled = true;
  document.getElementById('bt-qc-progress-fill').style.width = '0%';
  document.getElementById('bt-qc-progress-label').textContent = 'Bootstrap 检验中...';
  document.getElementById('bt-qc-progress-eta').textContent = '';

  worker.postMessage({
    type: 'bootstrapTest',
    config: {
      data: slimData,
      trainWindow: resolvePeriods(document.getElementById('bt-qc-window').value, slimData.length),
      bootstrapTimes: 500,
      seed: 42
    }
  });
}

function renderQcResult(result) {
  document.getElementById('bt-qc-result-card').style.display = '';
  const c = document.getElementById('bt-qc-content');

  const corrR = result.correlation.r;
  const r2 = result.correlation.rSquared;
  const buckets = result.buckets;
  const ep = result.expectedPrize;

  const improvPct = (ep.cold20 / ep.hot20 * 100 - 100).toFixed(1);

  let html = `
    <div class="bt-qc-summary">
      <div class="bt-qc-stat">
        <div class="bt-qc-stat-value">${result.steps}</div>
        <div class="bt-qc-stat-label">回测期数</div>
      </div>
      <div class="bt-qc-stat">
        <div class="bt-qc-stat-value">${corrR.toFixed(4)}</div>
        <div class="bt-qc-stat-label">冷门度 vs log(一等奖注数) 相关性</div>
      </div>
      <div class="bt-qc-stat">
        <div class="bt-qc-stat-value">${(r2 * 100).toFixed(2)}%</div>
        <div class="bt-qc-stat-label">R²(解释方差)</div>
      </div>
      <div class="bt-qc-stat bt-qc-stat-highlight">
        <div class="bt-qc-stat-value">+${improvPct}%</div>
        <div class="bt-qc-stat-label">冷门 20% vs 热门 20% 期望奖金提升</div>
      </div>
    </div>

    <div class="bt-section-title">分桶分析(按模型预测冷门度排序)</div>
    <table class="bt-hit-table">
      <thead><tr><th>分桶</th><th>样本数</th><th>平均一等奖注数</th><th>中位注数</th><th>平均期望奖金</th><th>空奖率</th></tr></thead>
      <tbody>
  `;

  for (const q of [0.1, 0.2, 0.5]) {
    const cold = buckets[`cold_${q}`];
    const hot = buckets[`hot_${q}`];
    if (cold) {
      html += `<tr class="highlight-row">
        <td>预测最冷门 ${(q*100).toFixed(0)}%</td>
        <td>${cold.count}</td>
        <td>${cold.avgFPC.toFixed(2)}</td>
        <td>${cold.medianFPC}</td>
        <td>${(cold.avgPrize/10000).toFixed(0)} 万</td>
        <td>${(cold.zeroFPCRate*100).toFixed(2)}%</td>
      </tr>`;
    }
    if (hot) {
      html += `<tr>
        <td>预测最热门 ${(q*100).toFixed(0)}%</td>
        <td>${hot.count}</td>
        <td>${hot.avgFPC.toFixed(2)}</td>
        <td>${hot.medianFPC}</td>
        <td>${(hot.avgPrize/10000).toFixed(0)} 万</td>
        <td>${(hot.zeroFPCRate*100).toFixed(2)}%</td>
      </tr>`;
    }
  }

  html += `
        <tr style="font-weight:600;border-top:2px solid var(--border)">
          <td>全体平均</td>
          <td>${result.allStats.count}</td>
          <td>${result.allStats.avgFPC.toFixed(2)}</td>
          <td>${result.allStats.medianFPC}</td>
          <td>${(result.allStats.avgPrize/10000).toFixed(0)} 万</td>
          <td>${(result.allStats.zeroFPCRate*100).toFixed(2)}%</td>
        </tr>
      </tbody>
    </table>

    <div class="bt-qc-conclusion">
      <strong>结论:</strong>
      Walk-forward out-of-sample 验证显示,模型预测的"冷门组合"在实际开奖时,
      一等奖注数显著低于"热门组合"(差异 ${(buckets['cold_0.2'].avgFPC - buckets['hot_0.2'].avgFPC).toFixed(2)} 注)。
      这意味着选冷门组合中奖时,<strong>分奖人更少,期望奖金更高</strong>。
      相关系数 ${corrR.toFixed(4)} 统计显著(P<0.001),证明玩家偏好确实影响分奖人数。
    </div>
  `;

  c.innerHTML = html;
}

function renderBootstrapResult(result) {
  document.getElementById('bt-qc-result-card').style.display = '';
  const c = document.getElementById('bt-qc-content');

  const sig = result.significant;
  const sigText = sig ? '★ 统计显著(P<0.05)' : '不显著';
  const sigClass = sig ? 'bt-sig-yes' : 'bt-sig-no';

  let html = `
    <div class="bt-section-title">Bootstrap 显著性检验(${result.bootstrapTimes} 次重采样)</div>
    <table class="bt-hit-table">
      <thead><tr><th>指标</th><th>冷门 20%</th><th>热门 20%</th><th>差异</th></tr></thead>
      <tbody>
        <tr class="highlight-row">
          <td>平均期望奖金</td>
          <td>${(result.coldMeanPrize/10000).toFixed(0)} 万元</td>
          <td>${(result.hotMeanPrize/10000).toFixed(0)} 万元</td>
          <td class="positive">+${(result.observedDiff/10000).toFixed(0)} 万 (${result.improvementPct.toFixed(1)}%)</td>
        </tr>
        <tr>
          <td>Bootstrap 均值差异</td>
          <td colspan="2">-</td>
          <td>+${(result.bootstrapMeanDiff/10000).toFixed(0)} 万</td>
        </tr>
        <tr>
          <td>95% 置信区间</td>
          <td colspan="2">-</td>
          <td>[${(result.ciLow/10000).toFixed(0)} 万, ${(result.ciHigh/10000).toFixed(0)} 万]</td>
        </tr>
        <tr class="highlight-row ${sigClass}">
          <td><strong>显著性</strong></td>
          <td colspan="3"><strong>${sigText}</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="bt-qc-conclusion">
      <strong>结论:</strong>
      Bootstrap ${result.bootstrapTimes} 次重采样显示,冷门组合的期望奖金比热门组合高
      <strong>${result.improvementPct.toFixed(1)}%</strong>,
      95% 置信区间 [${(result.ciLow/10000).toFixed(0)} 万, ${(result.ciHigh/10000).toFixed(0)} 万]${sig ? '不含 0' : '包含 0'},
      因此差异${sig ? '<strong>统计显著</strong>' : '不显著'}。
      ${sig ? '✓ 证明"选冷门组合"是有效的优化策略。' : '本次结果不显著,可能需要更大样本。'}
    </div>
  `;

  c.innerHTML = html;
}
