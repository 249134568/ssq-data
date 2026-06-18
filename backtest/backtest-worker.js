// ========== Backtest Worker ==========
// Deterministic prediction engine + sliding window backtest + grid search + genetic algorithm

importScripts('prng.js');

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
  const startIndex = data.length - startDraw;
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
function runGeneticSearch(data, config) {
  const { startDraw, predictionsPerDraw, yijingPct, populationSize, generations, mutationRate, sampleRate, seed, initialPopulation } = config;
  const gaPrng = createPRNG(seed + 99999);

  function randomIndividual() {
    const f = 0.05 + gaPrng.next() * 0.40;
    const r = 0.05 + gaPrng.next() * 0.30;
    const m = gaPrng.next() * 0.25;
    const sp = gaPrng.next() * 0.15;
    const sum = f + r + m + sp;
    const scale = 0.92 / Math.max(sum, 0.01);
    const wf = Math.round(f * scale * 100) / 100;
    const wr = Math.round(r * scale * 100) / 100;
    const wm = Math.round(m * scale * 100) / 100;
    const wsp = Math.round(sp * scale * 100) / 100;
    const pert = Math.round((1 - wf - wr - wm - wsp) * 100) / 100;
    return { freq: wf, recent: wr, miss: wm, salesPool: wsp, perturbation: Math.max(0.05, pert), recentWindow: 5 + gaPrng.nextInt(26) };
  }

  function normalizeWeights(ind) {
    const sum = ind.freq + ind.recent + ind.miss + ind.salesPool + ind.perturbation;
    if (Math.abs(sum - 1) < 0.01) return ind;
    const scale = 1 / sum;
    return { ...ind, freq: Math.round(ind.freq * scale * 100) / 100, recent: Math.round(ind.recent * scale * 100) / 100, miss: Math.round(ind.miss * scale * 100) / 100, salesPool: Math.round(ind.salesPool * scale * 100) / 100, perturbation: Math.round(ind.perturbation * scale * 100) / 100 };
  }

  // Initialize population
  let population = [];
  if (initialPopulation && initialPopulation.length > 0) {
    population = initialPopulation.map(w => ({ ...w }));
    while (population.length < populationSize) population.push(randomIndividual());
  } else {
    for (let i = 0; i < populationSize; i++) population.push(randomIndividual());
  }

  const elitism = 5;
  const genHistory = [];
  const startTime = Date.now();

  for (let gen = 0; gen < generations; gen++) {
    if (cancelled) return null;

    // Evaluate fitness
    const fitness = population.map(ind => {
      const w = normalizeWeights(ind);
      const result = runBacktest(data, { startDraw, predictionsPerDraw, weights: w, yijingPct, includeBaseline: false, sampleRate, seed });
      return { ind: w, fitness: result ? result.tracker.totalScore / result.tracker.totalPredictions : 0 };
    });

    fitness.sort((a, b) => b.fitness - a.fitness);
    const bestFit = fitness[0].fitness;
    const avgFit = fitness.reduce((s, f) => s + f.fitness, 0) / fitness.length;
    genHistory.push({ gen, bestScore: bestFit, avgScore: avgFit, bestWeights: fitness[0].ind });

    self.postMessage({ type: 'progress', payload: { phase: 'geneticSearch', current: gen + 1, total: generations, elapsed: Date.now() - startTime, eta: Math.round((Date.now() - startTime) / (gen + 1) * (generations - gen - 1)), bestScore: bestFit, avgScore: avgFit } });

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

      // BLX-alpha crossover
      const alpha = 0.3;
      const child = {};
      for (const key of ['freq', 'recent', 'miss', 'salesPool', 'perturbation']) {
        const lo = Math.min(parent1[key], parent2[key]);
        const hi = Math.max(parent1[key], parent2[key]);
        const range = hi - lo;
        child[key] = lo - alpha * range + gaPrng.next() * (1 + 2 * alpha) * range;
        child[key] = Math.max(key === 'salesPool' ? 0 : 0.05, Math.min(key === 'freq' ? 0.50 : key === 'recent' ? 0.40 : 0.30, child[key]));
      }
      child.recentWindow = Math.round((parent1.recentWindow + parent2.recentWindow) / 2 + (gaPrng.next() - 0.5) * 6);
      child.recentWindow = Math.max(5, Math.min(30, child.recentWindow));

      // Mutation
      if (gaPrng.next() < mutationRate) {
        const key = ['freq', 'recent', 'miss', 'salesPool', 'perturbation'][gaPrng.nextInt(5)];
        child[key] += (gaPrng.next() - 0.5) * 0.1;
        child[key] = Math.max(key === 'salesPool' ? 0 : 0.05, Math.min(0.50, child[key]));
      }
      if (gaPrng.next() < mutationRate) {
        child.recentWindow += Math.round((gaPrng.next() - 0.5) * 6);
        child.recentWindow = Math.max(5, Math.min(30, child.recentWindow));
      }

      newPop.push(normalizeWeights(child));
    }

    population = newPop;
  }

  // Final evaluation of best on full dataset
  const best = genHistory[genHistory.length - 1].bestWeights;
  const finalResult = runBacktest(data, { startDraw, predictionsPerDraw, weights: best, yijingPct, includeBaseline: true, sampleRate: 1, seed });
  return { genHistory, bestWeights: best, finalResult };
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
    }
  } catch (e) {
    self.postMessage({ type: 'error', payload: { message: e.message } });
  }
};
