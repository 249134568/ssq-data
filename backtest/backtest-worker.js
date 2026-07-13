// ========== Backtest Worker ==========
// Deterministic prediction engine + sliding window backtest + grid search + genetic algorithm
// + q_c coldness validation + walk-forward + bootstrap significance test

importScripts('prng.js');
importScripts('/coldness.js');

// ========== Constants (copied from index.html) ==========
const TIANGAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const DIZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const WUXING = ['木','木','火','火','土','土','金','金','水','水'];
const DIZHI_WUXING = ['水','土','木','木','土','火','火','土','金','金','土','水'];
const BAGUA = {6:'乾',1:'坎',8:'艮',3:'震',4:'巽',9:'离',2:'坤',7:'兑'};
const SHENG = {'木':'火','火':'土','土':'金','金':'水','水':'木'};
const KE = {'木':'土','土':'水','水':'火','火':'金','金':'木'};

function numToWuxing(n) {
  if (n <= 6) return '水';
  if (n <= 12) return '金';
  if (n <= 18) return '木';
  if (n <= 24) return '火';
  return '土';
}

function getGanZhi(dateStr) {
  const clean = dateStr.replace(/\(.*\)/, '').trim();
  const date = new Date(clean);
  const baseDate = new Date('2024-01-01');
  const diffDays = Math.floor((date - baseDate) / (1000 * 60 * 60 * 24));
  const ganIndex = ((diffDays % 10) + 10) % 10;
  const zhiIndex = ((diffDays % 12) + 12) % 12;
  return {
    gan: TIANGAN[ganIndex], zhi: DIZHI[zhiIndex],
    ganIndex, zhiIndex,
    ganWuxing: WUXING[ganIndex], zhiWuxing: DIZHI_WUXING[zhiIndex]
  };
}

function calcYiJingWeights(ganzhi) {
  const redWeights = new Array(34).fill(1);
  const blueWeights = new Array(17).fill(1);

  // Rule 1: Heavenly Stem Five Element
  const shengWuxing = SHENG[ganzhi.ganWuxing];
  const keWuxing = KE[ganzhi.ganWuxing];
  for (let i = 1; i <= 33; i++) {
    const wx = numToWuxing(i);
    if (wx === shengWuxing) redWeights[i] += 2;
    else if (wx === keWuxing) redWeights[i] = Math.max(0.3, redWeights[i] - 0.5);
    if (wx === ganzhi.ganWuxing) redWeights[i] += 1;
  }
  for (let i = 1; i <= 16; i++) {
    if (i <= 6) { if ('水' === shengWuxing) blueWeights[i] += 2; if ('水' === keWuxing) blueWeights[i] = Math.max(0.3, blueWeights[i] - 0.5); if ('水' === ganzhi.ganWuxing) blueWeights[i] += 1; }
    else if (i <= 12) { if ('金' === shengWuxing) blueWeights[i] += 2; if ('金' === keWuxing) blueWeights[i] = Math.max(0.3, blueWeights[i] - 0.5); if ('金' === ganzhi.ganWuxing) blueWeights[i] += 1; }
    else { if ('木' === shengWuxing) blueWeights[i] += 2; if ('木' === keWuxing) blueWeights[i] = Math.max(0.3, blueWeights[i] - 0.5); if ('木' === ganzhi.ganWuxing) blueWeights[i] += 1; }
  }

  // Rule 2: Earthly Branch cycle zone
  const zhiNum = ganzhi.zhiIndex + 1;
  const cyclePos = zhiNum % 6;
  const zoneStart = cyclePos * 5 + 1;
  const zoneEnd = Math.min(cyclePos * 5 + 5, 33);
  for (let i = zoneStart; i <= zoneEnd; i++) redWeights[i] += 1.5;

  // Rule 3: BaGua positions
  const baguaKeys = [6,1,8,3,4,9,2,7];
  for (const g of baguaKeys) {
    if (g <= 33) redWeights[g] += 1.2;
    if (g - 1 >= 1 && g - 1 <= 33) redWeights[g-1] += 0.6;
    if (g + 1 >= 1 && g + 1 <= 33) redWeights[g+1] += 0.6;
  }

  // Rule 4: Stem digit mapping
  const ganNum = ganzhi.ganIndex + 1;
  for (let i = 1; i <= 33; i++) { if (i % 10 === ganNum % 10) redWeights[i] += 0.8; }
  for (let i = 1; i <= 16; i++) { if (i % 10 === ganNum % 10) blueWeights[i] += 0.8; }

  return { redWeights, blueWeights };
}

// ========== Deterministic Weighted Selection ==========
function weightedSelect(weights, min, max, count, prng) {
  const selected = [];
  const usedIndices = new Set();
  for (let c = 0; c < count; c++) {
    let totalWeight = 0;
    for (let i = min; i <= max; i++) if (!usedIndices.has(i)) totalWeight += weights[i];
    let rand = prng.next() * totalWeight;
    for (let i = min; i <= max; i++) {
      if (usedIndices.has(i)) continue;
      rand -= weights[i];
      if (rand <= 0) { selected.push(i); usedIndices.add(i); break; }
    }
    if (selected.length <= c) {
      for (let i = min; i <= max; i++) { if (!usedIndices.has(i)) { selected.push(i); usedIndices.add(i); break; } }
    }
  }
  return selected.sort((a, b) => a - b);
}

function weightedSelectSingle(weights, min, max, prng) {
  let totalWeight = 0;
  for (let i = min; i <= max; i++) totalWeight += weights[i];
  let rand = prng.next() * totalWeight;
  for (let i = min; i <= max; i++) { rand -= weights[i]; if (rand <= 0) return i; }
  return max;
}

// ========== Deterministic Predict ==========
function predictDeterministic(data, count, range, yijingWeight, nextDate, weights, prng) {
  const rangeData = range > 0 ? data.slice(0, Math.min(range, data.length)) : data;
  const { freq: wFreq, recent: wRecent, miss: wMiss, salesPool: wSP, perturbation: wPert, recentWindow } = weights;
  const rw = Math.min(recentWindow, rangeData.length);

  // 1. Frequency
  const redFreq = new Array(34).fill(0), blueFreq = new Array(17).fill(0);
  rangeData.forEach(d => { d.red.forEach(r => redFreq[r]++); blueFreq[d.blue]++; });
  const maxRF = Math.max(...redFreq.slice(1)) || 1, maxBF = Math.max(...blueFreq.slice(1)) || 1;
  const rFN = redFreq.map(f => f / maxRF), bFN = blueFreq.map(f => f / maxBF);

  // 2. Recent trend
  const recentData = rangeData.slice(0, rw);
  const redRecent = new Array(34).fill(0), blueRecent = new Array(17).fill(0);
  recentData.forEach((d, idx) => { const w = (idx + 1) / rw; d.red.forEach(r => redRecent[r] += w); blueRecent[d.blue] += w; });
  const maxRR = Math.max(...redRecent.slice(1)) || 1, maxBR = Math.max(...blueRecent.slice(1)) || 1;
  const rRN = redRecent.map(f => f / maxRR), bRN = blueRecent.map(f => f / maxBR);

  // 3. Miss value
  const redMiss = new Array(34).fill(rangeData.length), blueMiss = new Array(17).fill(rangeData.length);
  rangeData.forEach((d, idx) => { d.red.forEach(r => { if (redMiss[r] === rangeData.length) redMiss[r] = idx; }); if (blueMiss[d.blue] === rangeData.length) blueMiss[d.blue] = idx; });
  const maxRM = Math.max(...redMiss.slice(1)) || 1, maxBM = Math.max(...blueMiss.slice(1)) || 1;
  const rMN = redMiss.map(f => f / maxRM), bMN = blueMiss.map(f => f / maxBM);

  // 4. Sales/Pool
  const spW = new Array(34).fill(0), spB = new Array(17).fill(0);
  const recent5 = rangeData.slice(0, Math.min(5, rangeData.length));
  if (recent5.length > 0) {
    const pn = s => s ? parseInt(s.replace(/,/g, ''), 10) : 0;
    const avgS = recent5.reduce((s, d) => s + pn(d.sales), 0) / recent5.length;
    const avgP = recent5.reduce((s, d) => s + pn(d.pool), 0) / recent5.length;
    const lastP = pn(recent5[0].pool);
    const poolRatio = avgP > 0 ? lastP / avgP : 1;
    if (poolRatio > 1.05) {
      for (let i = 1; i <= 33; i++) { if (redMiss[i] > rangeData.length * 0.6) spW[i] += 1.5; else if (redMiss[i] > rangeData.length * 0.4) spW[i] += 0.8; }
      for (let i = 1; i <= 16; i++) { if (blueMiss[i] > rangeData.length * 0.5) spB[i] += 1.2; }
    }
    const lastS = pn(recent5[0].sales);
    if (lastS > avgS * 1.1) { for (let i = 8; i <= 26; i++) spW[i] += 0.5; }
    const lastFC = parseInt(recent5[0].firstPrizeCount) || 0;
    if (lastFC === 0) {
      const center = Math.round(recent5[0].red.reduce((a,b) => a+b, 0) / 6);
      for (let i = Math.max(1, center - 5); i <= Math.min(33, center + 5); i++) spW[i] += 0.6;
    }
  }
  const maxSPR = Math.max(...spW.slice(1), 1), maxSPB = Math.max(...spB.slice(1), 1);
  const spRN = spW.map(f => f / maxSPR), spBN = spB.map(f => f / maxSPB);

  // 5. YiJing
  const nextDateStr = nextDate || new Date().toISOString().split('T')[0];
  const ganzhi = getGanZhi(nextDateStr);
  const yijing = calcYiJingWeights(ganzhi);
  const maxRYJ = Math.max(...yijing.redWeights.slice(1)) || 1, maxBYJ = Math.max(...yijing.blueWeights.slice(1)) || 1;
  const rYJN = yijing.redWeights.map(f => f / maxRYJ), bYJN = yijing.blueWeights.map(f => f / maxBYJ);

  // 6. Combine
  const yjPct = yijingWeight / 100;
  const statPct = 1 - yjPct;
  const results = [];
  for (let g = 0; g < count; g++) {
    const finalRed = new Array(34).fill(0), finalBlue = new Array(17).fill(0);
    for (let i = 1; i <= 33; i++) {
      const p = 0.7 + 0.6 * prng.next();
      finalRed[i] = (rFN[i] * wFreq + rRN[i] * wRecent + rMN[i] * wMiss + spRN[i] * wSP) * statPct + rYJN[i] * yjPct + p * wPert;
    }
    for (let i = 1; i <= 16; i++) {
      const p = 0.7 + 0.6 * prng.next();
      finalBlue[i] = (bFN[i] * wFreq + bRN[i] * wRecent + bMN[i] * wMiss + spBN[i] * wSP) * statPct + bYJN[i] * yjPct + p * wPert;
    }
    results.push({ red: weightedSelect(finalRed, 1, 33, 6, prng), blue: weightedSelectSingle(finalBlue, 1, 16, prng) });
  }
  return results;
}

// ========== Random Baseline ==========
function randomPredict(prng) {
  const red = [], used = new Set();
  while (red.length < 6) { const n = prng.nextInt(33) + 1; if (!used.has(n)) { red.push(n); used.add(n); } }
  return { red: red.sort((a, b) => a - b), blue: prng.nextInt(16) + 1 };
}

// ========== Score Function ==========
function scorePrediction(redHits, blueHit) {
  let score = 0;
  if (blueHit) score += 1;
  score += redHits;
  if (redHits >= 3) score += 5;
  if (redHits >= 4) score += 20;
  if (redHits >= 5) score += 100;
  if (redHits >= 6) score += 1000;
  return score;
}

// ========== Hit Tracker ==========
function createHitTracker() {
  return {
    blue: { hit: 0, miss: 0 },
    red: new Array(7).fill(0),
    combined: { '3+0': 0, '3+1': 0, '4+0': 0, '4+1': 0, '5+0': 0, '5+1': 0, '6+0': 0, '6+1': 0 },
    totalPredictions: 0,
    totalScore: 0,
    scores: []
  };
}

function recordHit(tracker, redHits, blueHit) {
  const s = scorePrediction(redHits, blueHit);
  tracker.blue[blueHit ? 'hit' : 'miss']++;
  tracker.red[redHits]++;
  if (redHits >= 3) tracker.combined[`${redHits}+${blueHit ? 1 : 0}`]++;
  tracker.totalPredictions++;
  tracker.totalScore += s;
  tracker.scores.push(s);
}

// ========== Sliding Window Backtest ==========
let cancelled = false;

function runBacktest(data, config) {
  const { startDraw, predictionsPerDraw, weights, yijingPct, includeBaseline, sampleRate, seed } = config;
  const tracker = createHitTracker();
  const baselineTracker = includeBaseline ? createHitTracker() : null;
  // 当 startDraw >= 数据长度时（"全部数据"选项），回测所有可用期
  const startIndex = startDraw >= data.length ? data.length - 1 : data.length - startDraw;
  const totalDraws = Math.floor(startIndex / (sampleRate || 1));
  let processed = 0;
  const startTime = Date.now();
  const cumulativeScores = [];
  const baselineCumulative = [];

  for (let i = startIndex; i >= 0; i -= (sampleRate || 1)) {
    if (cancelled) return null;

    const trainingData = data.slice(i + 1);
    if (trainingData.length < 20) continue;
    const target = data[i];
    const prng = createPRNG(seed + i);

    // Weighted prediction
    const preds = predictDeterministic(trainingData, predictionsPerDraw, 0, yijingPct, target.date, weights, prng);
    for (const pred of preds) {
      const redHits = pred.red.filter(r => target.red.includes(r)).length;
      const blueHit = pred.blue === target.blue;
      recordHit(tracker, redHits, blueHit);
    }

    // Baseline prediction
    if (includeBaseline) {
      const bprng = createPRNG(seed + i + 50000);
      for (let p = 0; p < predictionsPerDraw; p++) {
        const bp = randomPredict(bprng);
        const rh = bp.red.filter(r => target.red.includes(r)).length;
        const bh = bp.blue === target.blue;
        recordHit(baselineTracker, rh, bh);
      }
    }

    processed++;
    cumulativeScores.push(tracker.totalScore / tracker.totalPredictions);
    if (includeBaseline) baselineCumulative.push(baselineTracker.totalScore / baselineTracker.totalPredictions);

    // Progress every 50 draws
    if (processed % 50 === 0) {
      const elapsed = Date.now() - startTime;
      const eta = Math.round((elapsed / processed) * (totalDraws - processed));
      self.postMessage({ type: 'progress', payload: { phase: 'backtest', current: processed, total: totalDraws, elapsed, eta } });
    }
  }

  return { tracker, baselineTracker, cumulativeScores, baselineCumulative, weights };
}

// ========== Grid Search ==========
function runGridSearch(data, config) {
  const { startDraw, predictionsPerDraw, yijingPct, coarseSampleRate, topN, seed } = config;
  const steps = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50];
  const windows = [5, 10, 15, 20, 25, 30];
  const coarseResults = [];
  let totalCombos = 0;
  let processed = 0;
  const startTime = Date.now();

  // Generate all valid weight combinations (freq + recent + miss + sp <= 0.95, perturbation = 1 - sum)
  for (const freq of steps) {
    for (const recent of steps) {
      if (freq + recent > 0.85) continue;
      for (const miss of steps) {
        if (freq + recent + miss > 0.90) continue;
        for (const sp of [0, 0.05, 0.10, 0.15, 0.20]) {
          const sum = freq + recent + miss + sp;
          if (sum > 0.95) continue;
          const pert = Math.round((1 - sum) * 100) / 100;
          if (pert < 0.05) continue;
          totalCombos++;
        }
      }
    }
  }

  // Phase 1: Coarse grid
  for (const freq of steps) {
    for (const recent of steps) {
      if (freq + recent > 0.85) continue;
      for (const miss of steps) {
        if (freq + recent + miss > 0.90) continue;
        for (const sp of [0, 0.05, 0.10, 0.15, 0.20]) {
          if (cancelled) return null;
          const sum = freq + recent + miss + sp;
          if (sum > 0.95) continue;
          const pert = Math.round((1 - sum) * 100) / 100;
          if (pert < 0.05) continue;

          for (const rw of windows) {
            const weights = { freq, recent, miss, salesPool: sp, perturbation: pert, recentWindow: rw };
            const result = runBacktest(data, { startDraw, predictionsPerDraw, weights, yijingPct, includeBaseline: false, sampleRate: coarseSampleRate, seed });
            if (result) {
              coarseResults.push({ weights, avgScore: result.tracker.totalScore / result.tracker.totalPredictions });
            }
            processed++;
            if (processed % 100 === 0) {
              const elapsed = Date.now() - startTime;
              const eta = Math.round((elapsed / processed) * (totalCombos * windows.length - processed));
              self.postMessage({ type: 'progress', payload: { phase: 'gridSearch-coarse', current: processed, total: totalCombos * windows.length, elapsed, eta } });
            }
          }
        }
      }
    }
  }

  coarseResults.sort((a, b) => b.avgScore - a.avgScore);
  const topCoarse = coarseResults.slice(0, topN);

  // Phase 2: Fine grid around top results
  const fineResults = [];
  const fineSteps = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14];
  let fineProcessed = 0;
  const fineTotal = topCoarse.length * fineSteps.length * fineSteps.length * 5;

  for (const top of topCoarse) {
    for (const df of fineSteps) {
      const freq = Math.round((top.weights.freq + df - 0.06) * 100) / 100;
      if (freq < 0.05 || freq > 0.50) continue;
      for (const dr of fineSteps) {
        const recent = Math.round((top.weights.recent + dr - 0.06) * 100) / 100;
        if (recent < 0.05 || recent > 0.40) continue;
        if (freq + recent > 0.85) continue;
        for (const dm of [0, 0.02, 0.04, 0.06, 0.08]) {
          if (cancelled) return null;
          const miss = Math.round((top.weights.miss + dm - 0.04) * 100) / 100;
          if (miss < 0 || miss > 0.30) continue;
          const sp = top.weights.salesPool;
          const sum = freq + recent + miss + sp;
          if (sum > 0.95) continue;
          const pert = Math.round((1 - sum) * 100) / 100;
          if (pert < 0.05) continue;
          const rw = top.weights.recentWindow;
          const weights = { freq, recent, miss, salesPool: sp, perturbation: pert, recentWindow: rw };
          const result = runBacktest(data, { startDraw, predictionsPerDraw, weights, yijingPct, includeBaseline: false, sampleRate: 1, seed });
          if (result) {
            fineResults.push({ weights, avgScore: result.tracker.totalScore / result.tracker.totalPredictions });
          }
          fineProcessed++;
          if (fineProcessed % 50 === 0) {
            self.postMessage({ type: 'progress', payload: { phase: 'gridSearch-fine', current: fineProcessed, total: fineTotal, elapsed: Date.now() - startTime, eta: 0 } });
          }
        }
      }
    }
  }

  fineResults.sort((a, b) => b.avgScore - a.avgScore);
  return { coarseResults: coarseResults.slice(0, 50), fineResults: fineResults.slice(0, 20), best: fineResults[0] || topCoarse[0] };
}

// ========== Genetic Algorithm ==========
// 改造:进化冷门度特征权重,适应度 = out-of-sample 期望奖金
//
// 染色体:特征权重向量(11 个特征)
// 适应度:walk-forward 验证的期望奖金(冷门 20% vs 热门 20% 差值)
// 数学合法:优化期望奖金而非命中率,不违反 IID 假设

function runGeneticSearch(data, config) {
  const { populationSize, generations, mutationRate, seed, initialPopulation, trainWindow } = config;
  const gaPrng = createPRNG(seed + 99999);

  const featureKeys = Object.keys(Coldness.DEFAULT_FEATURE_WEIGHTS).filter(k => k !== 'recentRepeat');

  function randomIndividual() {
    // 围绕回归默认权重做扰动,而非完全随机
    const ind = {};
    for (const k of featureKeys) {
      const base = Coldness.DEFAULT_FEATURE_WEIGHTS[k];
      // ±50% 扰动
      ind[k] = base * (0.5 + gaPrng.next());
    }
    return ind;
  }

  function mutate(ind) {
    const child = { ...ind };
    // 选 2-4 个特征做扰动
    const numMutations = 2 + gaPrng.nextInt(3);
    for (let i = 0; i < numMutations; i++) {
      const key = featureKeys[gaPrng.nextInt(featureKeys.length)];
      const base = Coldness.DEFAULT_FEATURE_WEIGHTS[key];
      // ±20% 扰动
      child[key] = base * (0.8 + gaPrng.next() * 0.4);
    }
    return child;
  }

  function crossover(p1, p2) {
    const child = {};
    for (const k of featureKeys) {
      // BLX-alpha 风格
      const lo = Math.min(p1[k], p2[k]);
      const hi = Math.max(p1[k], p2[k]);
      const range = hi - lo;
      const alpha = 0.3;
      child[k] = lo - alpha * range + gaPrng.next() * (1 + 2 * alpha) * range;
      // 限制在合理范围
      const base = Coldness.DEFAULT_FEATURE_WEIGHTS[k];
      child[k] = Math.max(base * 0.3, Math.min(base * 2.0, child[k]));
    }
    return child;
  }

  // ========== 适应度函数:out-of-sample 期望奖金 ==========
  // 划分 train/test,用 train 训练回归,在 test 上评估冷门度排序的期望奖金差异

  function evaluateFitness(weights) {
    // 用给定权重给每期打分
    const allFeatures = data.map(d => ({
      ...extractFeaturesForData(d),
      firstPrizeCount: parseInt(d.firstPrizeCount) || 0,
      pool: parseInt((d.pool || '0').replace(/,/g, '')) || 0,
      period: d.period
    }));

    const n = allFeatures.length;
    const splitIdx = Math.floor(n * 0.7); // 70% train, 30% test

    // 在 train 上用回归归一化权重
    const train = allFeatures.slice(0, splitIdx);
    const test = allFeatures.slice(splitIdx);

    // 用回归训练 weights 的标量(让模型自适应权重尺度)
    const reg = linearRegression(train, featureKeys, f => Math.log(f.firstPrizeCount + 1));

    // 在 test 上评估
    const scored = test.map(f => {
      // 用提供的权重 + 回归系数做混合评分
      let coldScore = 0;
      for (const k of featureKeys) {
        coldScore -= weights[k] * (f[k] || 0); // 负号:正权重 → 热门 → 减分
      }
      return { ...f, coldScore };
    }).sort((a, b) => b.coldScore - a.coldScore);

    const testN = scored.length;
    const coldCount = Math.floor(testN * 0.2);
    const coldSample = scored.slice(0, coldCount);
    const hotSample = scored.slice(-coldCount);

    const coldAvgPrize = coldSample.reduce((s, d) => s + d.pool / Math.max(d.firstPrizeCount, 1), 0) / coldSample.length;
    const hotAvgPrize = hotSample.reduce((s, d) => s + d.pool / Math.max(d.firstPrizeCount, 1), 0) / hotSample.length;

    // 适应度 = 期望奖金差异(正值 = 好)
    return coldAvgPrize - hotAvgPrize;
  }

  // Initialize population
  let population = [];
  if (initialPopulation && initialPopulation.length > 0) {
    population = initialPopulation.map(w => ({ ...w }));
    while (population.length < populationSize) population.push(randomIndividual());
  } else {
    // 包含默认权重作为种子
    population.push({ ...Coldness.DEFAULT_FEATURE_WEIGHTS });
    while (population.length < populationSize) population.push(randomIndividual());
  }

  const elitism = 3;
  const genHistory = [];
  const startTime = Date.now();

  for (let gen = 0; gen < generations; gen++) {
    if (cancelled) return null;

    // Evaluate fitness
    const fitness = population.map(ind => ({
      ind,
      fitness: evaluateFitness(ind)
    }));

    fitness.sort((a, b) => b.fitness - a.fitness);
    const bestFit = fitness[0].fitness;
    const avgFit = fitness.reduce((s, f) => s + f.fitness, 0) / fitness.length;
    genHistory.push({ gen, bestScore: bestFit, avgScore: avgFit, bestWeights: fitness[0].ind });

    self.postMessage({
      type: 'progress',
      payload: {
        phase: 'geneticSearch',
        current: gen + 1,
        total: generations,
        elapsed: Date.now() - startTime,
        eta: Math.round((Date.now() - startTime) / (gen + 1) * (generations - gen - 1)),
        bestScore: bestFit,
        avgScore: avgFit
      }
    });

    // Selection + crossover + mutation
    const newPop = fitness.slice(0, elitism).map(f => f.ind);

    while (newPop.length < populationSize) {
      // Tournament selection
      const t1 = fitness[gaPrng.nextInt(fitness.length)];
      const t2 = fitness[gaPrng.nextInt(fitness.length)];
      const t3 = fitness[gaPrng.nextInt(fitness.length)];
      const parent1 = [t1, t2, t3].sort((a, b) => b.fitness - a.fitness)[0].ind;
      const t4 = fitness[gaPrng.nextInt(fitness.length)];
      const t5 = fitness[gaPrng.nextInt(fitness.length)];
      const t6 = fitness[gaPrng.nextInt(fitness.length)];
      const parent2 = [t4, t5, t6].sort((a, b) => b.fitness - a.fitness)[0].ind;

      let child = crossover(parent1, parent2);
      if (gaPrng.next() < mutationRate) {
        child = mutate(child);
      }
      newPop.push(child);
    }

    population = newPop;
  }

  // 最终用最优权重在全量数据上做 q_c 回测验证
  // 临时替换 DEFAULT_FEATURE_WEIGHTS,用 fixed 模式让 runQcBacktest 直接用进化后权重打分
  const best = genHistory[genHistory.length - 1].bestWeights;
  const originalWeights = { ...Coldness.DEFAULT_FEATURE_WEIGHTS };
  for (const k of Object.keys(best)) {
    Coldness.DEFAULT_FEATURE_WEIGHTS[k] = best[k];
  }
  const qcResult = runQcBacktest(data, { trainWindow: trainWindow || 200, predictionQuantiles: [0.2], seed, mode: 'fixed' });
  // 恢复默认权重(避免影响后续回测)
  for (const k of Object.keys(originalWeights)) {
    Coldness.DEFAULT_FEATURE_WEIGHTS[k] = originalWeights[k];
  }

  return {
    genHistory,
    bestWeights: best,
    finalResult: qcResult,
    type: 'coldnessGA'
  };
}

// ========== q_c Coldness Validation (新数学合法回测) ==========
// 验证目标:冷门度评分高的组合,实际开奖时一等奖注数是否更少
// 这是数学上唯一合法的"预测力"检验(期望奖金优化)

function extractFeaturesForData(d) {
  return Coldness.extractFeatures(d.red, d.blue);
}

function linearRegression(samples, featureKeys, targetFn) {
  const n = samples.length;
  const m = featureKeys.length + 1;
  const X = samples.map(s => [1, ...featureKeys.map(k => s[k] || 0)]);
  const y = samples.map(s => targetFn(s));
  const XtX = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) XtX[a][b] += X[i][a] * X[i][b];
  const Xty = new Array(m).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < m; a++) Xty[a] += X[i][a] * y[i];
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < m; i++) {
    let maxRow = i;
    for (let k = i + 1; k < m; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    if (Math.abs(aug[i][i]) < 1e-12) continue;
    for (let k = i + 1; k < m; k++) {
      const factor = aug[k][i] / aug[i][i];
      for (let j = i; j <= m; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  const beta = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let sum = aug[i][m];
    for (let j = i + 1; j < m; j++) sum -= aug[i][j] * beta[j];
    beta[i] = aug[i][i] !== 0 ? sum / aug[i][i] : 0;
  }
  return { intercept: beta[0], coefficients: featureKeys.map((k, i) => ({ feature: k, beta: beta[i + 1] })) };
}

function predictLogFPC(features, regression) {
  let p = regression.intercept;
  for (const c of regression.coefficients) p += c.beta * (features[c.feature] || 0);
  return p;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; d1 += dx * dx; d2 += dy * dy; }
  return (d1 === 0 || d2 === 0) ? 0 : num / Math.sqrt(d1 * d2);
}

// ========== q_c Walk-Forward Backtest ==========
// 滚动训练窗口:用 [t-window, t-1] 训练 → 预测 t 期 → 评估 → 滑动
// 模式:
//   - 'regression' (默认): 每个窗口重新做线性回归
//   - 'fixed': 用 DEFAULT_FEATURE_WEIGHTS 直接打分(用于验证 GA 进化后的权重)

function runQcBacktest(data, config) {
  const { trainWindow, predictionQuantiles, seed, mode } = config;
  const featureKeys = Object.keys(Coldness.DEFAULT_FEATURE_WEIGHTS).filter(k => k !== 'recentRepeat');
  const useFixedWeights = mode === 'fixed';

  // 提取所有特征
  const allFeatures = data.map(d => ({
    ...extractFeaturesForData(d),
    firstPrizeCount: parseInt(d.firstPrizeCount) || 0,
    sales: parseInt((d.sales || '0').replace(/,/g, '')) || 0,
    pool: parseInt((d.pool || '0').replace(/,/g, '')) || 0,
    period: d.period,
    date: d.date
  }));

  const steps = [];
  const startTime = Date.now();

  // 固定权重模式:不需要训练,直接打分
  if (useFixedWeights) {
    for (let i = 0; i < allFeatures.length; i++) {
      if (cancelled) return null;
      const f = allFeatures[i];
      // 用 DEFAULT_FEATURE_WEIGHTS 直接算冷门度
      let coldScore = 0;
      for (const k of featureKeys) {
        coldScore -= Coldness.DEFAULT_FEATURE_WEIGHTS[k] * (f[k] || 0);
      }
      steps.push({
        period: f.period,
        date: f.date,
        coldScore,
        actualFPC: f.firstPrizeCount,
        pool: f.pool,
        sales: f.sales
      });
      if (steps.length % 200 === 0) {
        self.postMessage({ type: 'progress', payload: { phase: 'qcBacktest', current: steps.length, total: allFeatures.length, elapsed: Date.now() - startTime, eta: 0 } });
      }
    }
  } else {
    // 回归模式:滚动训练
    // 当 trainWindow >= 数据长度时（"全部数据"选项），用 expanding window：
    // 每次用第 0~i 期训练（从少到多），回测所有可用期
    const useExpanding = trainWindow >= allFeatures.length - 1;
    const startI = useExpanding ? 1 : trainWindow;
    for (let i = startI; i < allFeatures.length - 1; i++) {
      if (cancelled) return null;

      const train = useExpanding
        ? allFeatures.slice(0, i)   // expanding: 用前 i 期训练
        : allFeatures.slice(i - trainWindow, i);  // sliding: 用前 trainWindow 期
      const test = allFeatures[i + 1];
      const reg = linearRegression(train, featureKeys, f => Math.log(f.firstPrizeCount + 1));

      const testScore = predictLogFPC(test, reg);
      const coldScore = -testScore;

      steps.push({
        period: test.period,
        date: test.date,
        coldScore,
        actualFPC: test.firstPrizeCount,
        pool: test.pool,
        sales: test.sales,
        red: data.find(d => d.period === test.period)?.red || [],
        blue: data.find(d => d.period === test.period)?.blue || 0
      });

      if (steps.length % 100 === 0) {
        const elapsed = Date.now() - startTime;
        const total = allFeatures.length - startI - 1;
        const eta = Math.round((elapsed / steps.length) * (total - steps.length));
        self.postMessage({ type: 'progress', payload: { phase: 'qcBacktest', current: steps.length, total, elapsed, eta } });
      }
    }
  }

  // 按冷门度排序,分桶分析
  const sorted = [...steps].sort((a, b) => b.coldScore - a.coldScore);
  const buckets = {};
  for (const q of predictionQuantiles || [0.1, 0.2, 0.5]) {
    const coldSlice = sorted.slice(0, Math.floor(sorted.length * q));
    const hotSlice = sorted.slice(-Math.floor(sorted.length * q));
    buckets[`cold_${q}`] = analyzeBucket(coldSlice);
    buckets[`hot_${q}`] = analyzeBucket(hotSlice);
  }

  const allStats = analyzeBucket(steps);

  const coldScores = steps.map(s => s.coldScore);
  const fpcLogs = steps.map(s => Math.log(s.actualFPC + 1));
  const correlation = pearson(coldScores, fpcLogs);

  const topCold20 = sorted.slice(0, Math.floor(sorted.length * 0.2));
  const topHot20 = sorted.slice(-Math.floor(sorted.length * 0.2));

  return {
    type: 'qc',
    steps: steps.length,
    trainWindow,
    mode: useFixedWeights ? 'fixed' : 'regression',
    buckets,
    allStats,
    correlation: { r: correlation, rSquared: correlation * correlation },
    expectedPrize: {
      cold20: topCold20.reduce((s, d) => s + d.pool / Math.max(d.actualFPC, 1), 0) / topCold20.length,
      hot20: topHot20.reduce((s, d) => s + d.pool / Math.max(d.actualFPC, 1), 0) / topHot20.length
    },
    sampleSteps: sorted.slice(0, 10).concat(sorted.slice(-10))
  };
}

function analyzeBucket(slice) {
  if (slice.length === 0) return null;
  const avgFPC = slice.reduce((s, d) => s + d.actualFPC, 0) / slice.length;
  const medianFPC = [...slice].sort((a, b) => a.actualFPC - b.actualFPC)[Math.floor(slice.length / 2)].actualFPC;
  const avgPrize = slice.reduce((s, d) => s + d.pool / Math.max(d.actualFPC, 1), 0) / slice.length;
  const zeroFPC = slice.filter(d => d.actualFPC === 0).length;
  return {
    count: slice.length,
    avgFPC,
    medianFPC,
    avgPrize,
    zeroFPCRate: zeroFPC / slice.length
  };
}

// ========== Bootstrap 显著性检验 ==========
// 检验:冷门组合的期望奖金是否显著高于热门组合

function runBootstrapTest(data, config) {
  const { trainWindow, bootstrapTimes, seed } = config;
  const qcResult = runQcBacktest(data, { trainWindow, predictionQuantiles: [0.2], seed });
  if (!qcResult) return null;

  const sorted = [...qcResult.sampleSteps].sort((a, b) => b.coldScore - a.coldScore);
  // 用全量数据重新排序
  const allFeatures = data.map(d => ({
    ...extractFeaturesForData(d),
    firstPrizeCount: parseInt(d.firstPrizeCount) || 0,
    pool: parseInt((d.pool || '0').replace(/,/g, '')) || 0,
    period: d.period
  }));

  const featureKeys = Object.keys(Coldness.DEFAULT_FEATURE_WEIGHTS).filter(k => k !== 'recentRepeat');
  // 全样本回归
  const reg = linearRegression(allFeatures, featureKeys, f => Math.log(f.firstPrizeCount + 1));
  const scored = allFeatures.map(f => ({
    ...f,
    coldScore: -predictLogFPC(f, reg)
  })).sort((a, b) => b.coldScore - a.coldScore);

  const n = scored.length;
  const coldCount = Math.floor(n * 0.2);
  const coldSample = scored.slice(0, coldCount);
  const hotSample = scored.slice(-coldCount);

  // Bootstrap:从 cold 和 hot 中分别有放回采样 B 次,计算期望奖金差异
  const bsPrng = createPRNG(seed + 77777);
  const diffs = [];
  for (let b = 0; b < bootstrapTimes; b++) {
    if (cancelled) return null;
    const coldPay = sampleAveragePrize(coldSample, bsPrng);
    const hotPay = sampleAveragePrize(hotSample, bsPrng);
    diffs.push(coldPay - hotPay);
  }
  diffs.sort((a, b) => a - b);

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const ciLow = diffs[Math.floor(bootstrapTimes * 0.025)];
  const ciHigh = diffs[Math.floor(bootstrapTimes * 0.975)];

  // Paired t-test on actual values
  const coldMean = coldSample.reduce((s, d) => s + d.pool / Math.max(d.firstPrizeCount, 1), 0) / coldSample.length;
  const hotMean = hotSample.reduce((s, d) => s + d.pool / Math.max(d.firstPrizeCount, 1), 0) / hotSample.length;

  // 显著性:CI 不含 0 则显著
  const significant = ciLow > 0 || ciHigh < 0;

  return {
    type: 'bootstrap',
    coldMeanPrize: coldMean,
    hotMeanPrize: hotMean,
    observedDiff: coldMean - hotMean,
    bootstrapMeanDiff: meanDiff,
    ciLow,
    ciHigh,
    significant,
    bootstrapTimes,
    improvementPct: (coldMean / hotMean * 100 - 100)
  };
}

function sampleAveragePrize(group, prng) {
  const n = group.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const idx = prng.nextInt(n);
    const d = group[idx];
    sum += d.pool / Math.max(d.firstPrizeCount, 1);
  }
  return sum / n;
}

// ========== Message Handler ==========
let storedData = null;

self.onmessage = function(e) {
  const msg = e.data;
  cancelled = false;

  if (msg.type === 'cancel') { cancelled = true; return; }

  if (msg.config && msg.config.data) storedData = msg.config.data;
  const data = msg.config ? msg.config.data || storedData : storedData;
  if (!data) { self.postMessage({ type: 'error', payload: { message: 'No data loaded' } }); return; }

  try {
    let result;
    if (msg.type === 'backtest') {
      result = runBacktest(data, { ...msg.config, data, seed: msg.config.seed || 42 });
      if (result) self.postMessage({ type: 'backtestResult', payload: result });
    } else if (msg.type === 'gridSearch') {
      result = runGridSearch(data, { ...msg.config, data, seed: msg.config.seed || 42 });
      if (result) self.postMessage({ type: 'gridSearchResult', payload: result });
    } else if (msg.type === 'geneticSearch') {
      result = runGeneticSearch(data, { ...msg.config, data, seed: msg.config.seed || 42 });
      if (result) self.postMessage({ type: 'geneticResult', payload: result });
    } else if (msg.type === 'qcBacktest') {
      result = runQcBacktest(data, { ...msg.config, data, seed: msg.config.seed || 42 });
      if (result) self.postMessage({ type: 'qcResult', payload: result });
    } else if (msg.type === 'bootstrapTest') {
      result = runBootstrapTest(data, { ...msg.config, data, seed: msg.config.seed || 42 });
      if (result) self.postMessage({ type: 'bootstrapResult', payload: result });
    }
  } catch (e) {
    self.postMessage({ type: 'error', payload: { message: e.message } });
  }
};
