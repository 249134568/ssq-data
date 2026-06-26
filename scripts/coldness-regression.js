// ========== 冷门度权重回归验证 ==========
// 用 firstPrizeCount 作为 ground truth,回归出最优特征权重
// 运行: node scripts/coldness-regression.js

const fs = require('fs');
const path = require('path');
const { extractFeatures, DEFAULT_FEATURE_WEIGHTS } = require('../coldness.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf-8'));

console.log('========== 冷门度权重回归验证 ==========');
console.log(`数据量: ${data.length} 期\n`);

// ========== 1. 提取所有特征 ==========
const features = data.map(d => ({
  ...extractFeatures(d.red, d.blue),
  firstPrizeCount: parseInt(d.firstPrizeCount) || 0,
  sales: parseInt((d.sales || '0').replace(/,/g, '')) || 0,
  pool: parseInt((d.pool || '0').replace(/,/g, '')) || 0,
  period: d.period
}));

// ========== 2. Pearson 相关系数 ==========
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; d1 += dx * dx; d2 += dy * dy;
  }
  if (d1 === 0 || d2 === 0) return 0;
  return num / Math.sqrt(d1 * d2);
}

// ========== 3. Spearman 等级相关(更稳健) ==========
function spearman(xs, ys) {
  const rx = rank(xs), ry = rank(ys);
  return pearson(rx, ry);
}

function rank(arr) {
  const sorted = [...arr].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k][1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

console.log('=== 各特征与 log(一等奖注数+1) 的相关性 ===');
const fpcLog = features.map(f => Math.log(f.firstPrizeCount + 1));
const featureKeys = Object.keys(DEFAULT_FEATURE_WEIGHTS).filter(k =>
  features[0][k] !== undefined && k !== 'recentRepeat'
);

const correlations = {};
for (const key of featureKeys) {
  const xs = features.map(f => f[key]);
  const rP = pearson(xs, fpcLog);
  const rS = spearman(xs, fpcLog);
  correlations[key] = { pearson: rP, spearman: rS };
  const sig = Math.abs(rP) > 0.05 ? '★显著' : '  不显著';
  console.log(`  ${key.padEnd(20)} Pearson=${rP.toFixed(4).padStart(8)}  Spearman=${rS.toFixed(4).padStart(8)}  ${sig}`);
}

// ========== 4. 多元线性回归(最小二乘) ==========
// 目标:log(firstPrizeCount+1) ≈ Σ(β_i × feature_i) + intercept
// 用正规方程解 β = (X^T X)^-1 X^T y

function linearRegression(samples, featureKeys, targetFn) {
  const n = samples.length;
  const m = featureKeys.length + 1; // +1 for intercept

  // 构建 X 矩阵(n × m) 和 y 向量(n)
  const X = samples.map(s => [1, ...featureKeys.map(k => s[k] || 0)]);
  const y = samples.map(s => targetFn(s));

  // X^T X (m × m)
  const XtX = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        XtX[a][b] += X[i][a] * X[i][b];
      }
    }
  }

  // X^T y (m)
  const Xty = new Array(m).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < m; a++) {
      Xty[a] += X[i][a] * y[i];
    }
  }

  // 高斯消元解 XtX β = Xty
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let i = 0; i < m; i++) {
    // 选主元
    let maxRow = i;
    for (let k = i + 1; k < m; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    }
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

console.log('\n=== 多元线性回归:log(一等奖注数+1) ~ Σ(β × 特征) ===');
const regression = linearRegression(features, featureKeys, f => Math.log(f.firstPrizeCount + 1));
console.log(`  截距: ${regression.intercept.toFixed(4)}`);
console.log('  系数:');
for (const c of regression.coefficients) {
  console.log(`    ${c.feature.padEnd(20)} β = ${c.beta.toFixed(4)}`);
}

// ========== 5. 模型评估 ==========
function predictLogFPC(features, regression) {
  let p = regression.intercept;
  for (const c of regression.coefficients) {
    p += c.beta * (features[c.feature] || 0);
  }
  return p;
}

const predictions = features.map(f => predictLogFPC(f, regression));
const actuals = features.map(f => Math.log(f.firstPrizeCount + 1));
const r = pearson(predictions, actuals);
const mae = predictions.reduce((s, p, i) => s + Math.abs(p - actuals[i]), 0) / predictions.length;
console.log(`\n模型评估:`);
console.log(`  Pearson R (预测 vs 实际): ${r.toFixed(4)}`);
console.log(`  R²: ${(r * r).toFixed(4)}`);
console.log(`  MAE: ${mae.toFixed(4)}`);

// ========== 6. Bootstrap 置信区间 ==========
console.log('\n=== Bootstrap 置信区间(1000次重采样) ===');
const B = 1000;
const bootCoefs = {};
for (const k of featureKeys) bootCoefs[k] = [];

for (let b = 0; b < B; b++) {
  // 重采样
  const sample = [];
  for (let i = 0; i < features.length; i++) {
    sample.push(features[Math.floor(Math.random() * features.length)]);
  }
  const reg = linearRegression(sample, featureKeys, f => Math.log(f.firstPrizeCount + 1));
  for (const c of reg.coefficients) {
    bootCoefs[c.feature].push(c.beta);
  }
}

console.log('特征                  |  β    |  95% CI下 |  95% CI上 |  显著性');
console.log('----------------------|-------|-----------|-----------|--------');
for (const k of featureKeys) {
  const arr = bootCoefs[k].sort((a, b) => a - b);
  const lo = arr[Math.floor(B * 0.025)];
  const hi = arr[Math.floor(B * 0.975)];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const regCoef = regression.coefficients.find(c => c.feature === k).beta;
  const sig = (lo > 0 || hi < 0) ? '★显著' : '  不显著';
  console.log(`  ${k.padEnd(20)} | ${regCoef.toFixed(3).padStart(5)} | ${lo.toFixed(3).padStart(9)} | ${hi.toFixed(3).padStart(9)} | ${sig}`);
}

// ========== 7. 期望奖金对比(冷门 vs 热门) ==========
console.log('\n=== 期望奖金对比(基于实际数据) ===');

// 用回归模型给每期打分
const scored = features.map((f, i) => ({
  ...f,
  predictedHotness: predictLogFPC(f, regression),
  actualFPC: f.firstPrizeCount
}));
scored.sort((a, b) => a.predictedHotness - b.predictedHotness);

// 最冷门 20% vs 最热门 20%
const cold = scored.slice(0, Math.floor(scored.length * 0.2));
const hot = scored.slice(-Math.floor(scored.length * 0.2));

const avgFPC = (group) => group.reduce((s, d) => s + d.actualFPC, 0) / group.length;
const avgPrize = (group) => group.reduce((s, d) => {
  const pool = d.pool;
  const fpc = Math.max(d.actualFPC, 1);
  return s + pool / fpc;
}, 0) / group.length;

console.log(`  最冷门 20% (按模型预测):`);
console.log(`    平均一等奖注数: ${avgFPC(cold).toFixed(2)}`);
console.log(`    平均一等奖奖金: ${avgPrize(cold).toFixed(0)} 元`);
console.log(`  最热门 20% (按模型预测):`);
console.log(`    平均一等奖注数: ${avgFPC(hot).toFixed(2)}`);
console.log(`    平均一等奖奖金: ${avgPrize(hot).toFixed(0)} 元`);
console.log(`  期望奖金提升: ${(avgPrize(cold) / avgPrize(hot) * 100 - 100).toFixed(1)}%`);

// ========== 8. Walk-Forward 验证 ==========
console.log('\n=== Walk-Forward 验证(滚动 200 期训练,预测下一期) ===');

const trainWindow = 200;
const steps = [];
for (let i = trainWindow; i < features.length - 1; i++) {
  const train = features.slice(i - trainWindow, i);
  const test = features[i + 1];
  const reg = linearRegression(train, featureKeys, f => Math.log(f.firstPrizeCount + 1));

  // 用训练好的模型给测试期打分,选 top 10% 最冷门
  // 检查测试期实际一等奖注数是否低于平均
  const testScore = predictLogFPC(test, reg);
  steps.push({ testScore, actualFPC: test.firstPrizeCount, period: test.period });
}

// 按 model 预测的 hotness 排序
steps.sort((a, b) => a.testScore - b.testScore);
const predictedCold = steps.slice(0, Math.floor(steps.length * 0.1));
const predictedHot = steps.slice(-Math.floor(steps.length * 0.1));

console.log(`  预测最冷门 10% (out-of-sample):`);
console.log(`    平均一等奖注数: ${predictedCold.reduce((s, d) => s + d.actualFPC, 0) / predictedCold.length}`);
console.log(`    平均期号: ${predictedCold[0].period} ~ ${predictedCold[predictedCold.length - 1].period}`);
console.log(`  预测最热门 10% (out-of-sample):`);
console.log(`    平均一等奖注数: ${predictedHot.reduce((s, d) => s + d.actualFPC, 0) / predictedHot.length}`);

const coldAvgFPC = predictedCold.reduce((s, d) => s + d.actualFPC, 0) / predictedCold.length;
const hotAvgFPC = predictedHot.reduce((s, d) => s + d.actualFPC, 0) / predictedHot.length;
console.log(`  Out-of-sample 一等奖注数差异: ${coldAvgFPC.toFixed(2)} vs ${hotAvgFPC.toFixed(2)} (差 ${(coldAvgFPC - hotAvgFPC).toFixed(2)})`);

// ========== 9. 导出推荐权重 ==========
console.log('\n=== 推荐特征权重(用于 Coldness 模块) ===');
console.log('// 基于 firstPrizeCount 回归 + Bootstrap 验证');
console.log('// 正值 = 该特征使组合更热门(应减冷门分)');
console.log('// 负值 = 该特征使组合更冷门(应加冷门分)');
console.log('const REGRESSED_WEIGHTS = {');
for (const c of regression.coefficients) {
  console.log(`  ${c.feature.padEnd(20)}: ${c.beta.toFixed(4)},`);
}
console.log('};');

// 写入文件供后续使用
const outputPath = path.join(__dirname, 'coldness-weights.json');
fs.writeFileSync(outputPath, JSON.stringify({
  regression: {
    intercept: regression.intercept,
    coefficients: regression.coefficients,
    rSquared: r * r,
    mae
  },
  bootstrap: featureKeys.map(k => {
    const arr = bootCoefs[k].sort((a, b) => a - b);
    return {
      feature: k,
      mean: arr.reduce((a, b) => a + b, 0) / arr.length,
      ciLow: arr[Math.floor(B * 0.025)],
      ciHigh: arr[Math.floor(B * 0.975)],
      significant: arr[Math.floor(B * 0.025)] > 0 || arr[Math.floor(B * 0.975)] < 0
    };
  }),
  walkForward: {
    coldAvgFPC: coldAvgFPC,
    hotAvgFPC: hotAvgFPC,
    improvement: (hotAvgFPC - coldAvgFPC) / hotAvgFPC
  }
}, null, 2));
console.log(`\n权重详情已写入: ${outputPath}`);
