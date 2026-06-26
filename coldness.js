// ========== 冷门度评分引擎 ==========
// 数学原理:
//   双色球每期中奖概率恒为 1/17,721,088,任何预测函数都无法提升此概率(已证伪)。
//   但期望奖金 = P(中奖) × 奖金池 / 分奖人数,其中"分奖人数"依赖于组合的"热门度" q_c。
//   选冷门组合 → 分奖人数少 → 期望奖金高。
//
// 本模块用 firstPrizeCount 历史数据回归出中国玩家偏好的特征权重,
// 实现 ColdScore(c) → 越高越冷门(越值得选)。

// ========== 特征工程 ==========
// 每个特征返回一个数值,正方向统一为"热门方向"(越大越热门)。
// 最终 ColdScore = -Σ(权重 × 特征),所以越冷门 → 分数越高。

function extractFeatures(red, blue) {
  const sorted = [...red].sort((a, b) => a - b);
  const f = {};

  // 1. 生日号比例 (1-31) - 玩家爱选生日号
  f.birthdayRatio = sorted.filter(r => r <= 31).length / 6;

  // 2. 月日号比例 (1-12) - 月份+日期双重热门
  f.monthDayRatio = sorted.filter(r => r <= 12).length / 6;

  // 3. 连号对数 - 视觉规律号
  let consec = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] === 1) consec++;
  }
  f.consecutivePairs = consec;

  // 4. 全奇/全偶 - 视觉规律号
  const oddCnt = sorted.filter(r => r % 2 === 1).length;
  f.allSameParity = (oddCnt === 0 || oddCnt === 6) ? 1 : 0;

  // 5. 吉祥号数量 (6, 8) - 中国玩家偏好
  f.luckyCount = sorted.filter(r => [6, 8].includes(r)).length;

  // 6. 忌讳号数量 (4) - 中国玩家忌讳
  f.unluckyCount = sorted.filter(r => r === 4).length;

  // 7. 等差数列 - 视觉规律号
  let isArithmetic = 0;
  if (sorted.length >= 3) {
    const step = sorted[1] - sorted[0];
    if (step > 0 && sorted[2] - sorted[1] === step) isArithmetic = 1;
  }
  f.isArithmetic = isArithmetic;

  // 8. 和值 - 玩家偏爱和值在 100-150 中段(直觉区域)
  //    和值 < 80 或 > 150 反而冷门
  const sum = sorted.reduce((a, b) => a + b, 0);
  f.sum = sum;
  // 标准化:偏离 102(理论均值 6×17)的程度
  f.sumDeviation = Math.abs(sum - 102);

  // 9. 重复号 - 与近期开奖重复度(玩家跟风)
  //    (由调用方传入 recentReds,此处留接口)
  f.recentRepeat = 0; // 默认 0,外部可覆盖

  // 10. 蓝球吉祥号 (6, 8) / 忌讳号 (4)
  f.blueLucky = [6, 8].includes(blue) ? 1 : 0;
  f.blueUnlucky = blue === 4 ? 1 : 0;

  // 11. 蓝球小号偏好 (1-7) - 玩家偏爱小号
  f.blueSmall = blue <= 7 ? 1 : 0;

  return f;
}

// ========== 默认特征权重 ==========
// 基于 firstPrizeCount 数据回归 + Bootstrap 验证(见 scripts/coldness-regression.js)
// 正权重 = 该特征使组合更热门 → 应减分
// 负权重 = 该特征使组合更冷门 → 应加分
//
// 统计显著的 6 个特征(95% CI 不含 0):
//   birthdayRatio, monthDayRatio, consecutivePairs, unluckyCount,
//   sumDeviation, blueLucky
//
// 模型表现:
//   - Walk-forward out-of-sample:冷门 10% vs 热门 10% 一等奖注数差异 -4.99
//   - 期望奖金提升:冷门 20% 比热门 20% 高 102.9%
//   - R² = 0.069(低但显著,因玩家偏好只是部分解释变量)

const DEFAULT_FEATURE_WEIGHTS = {
  birthdayRatio:    0.846,  // ★显著 CI[0.48, 1.18]
  monthDayRatio:    0.625,  // ★显著 CI[0.44, 0.82]
  consecutivePairs: 0.056,  // ★显著 CI[0.01, 0.10]
  allSameParity:    0.069,  // 不显著(但保留,视觉规律先验)
  luckyCount:       0.044,  // 边界显著 CI[-0.01, 0.10]
  unluckyCount:    -0.124,  // ★显著 CI[-0.20, -0.04] (4 是冷门)
  isArithmetic:     0.022,  // 不显著
  sumDeviation:    -0.005,  // ★显著 CI[-0.008, -0.003]
  recentRepeat:     0.500,  // 跟风效应(未回归,先验值)
  blueLucky:        0.228,  // ★显著 CI[0.15, 0.31]
  blueUnlucky:      0.056,  // 不显著
  blueSmall:       -0.025,  // 不显著
};

// ========== 冷门度评分 ==========
// 返回值:越高越冷门(越值得选)
// 负值 = 热门组合(不建议选)
// 正值 = 冷门组合(建议选)

function coldScore(red, blue, weights, recentReds) {
  const w = weights || DEFAULT_FEATURE_WEIGHTS;
  const f = extractFeatures(red, blue);

  // 注入近期重复号
  if (recentReds && recentReds.length > 0) {
    const recentSet = new Set(recentReds);
    f.recentRepeat = red.filter(r => recentSet.has(r)).length / 6;
  }

  // 热门度 = Σ(权重 × 特征)
  let hotness = 0;
  for (const key of Object.keys(DEFAULT_FEATURE_WEIGHTS)) {
    if (w[key] !== undefined && f[key] !== undefined) {
      hotness += w[key] * f[key];
    }
  }

  // ColdScore = -hotness(冷门度 = 负的热门度)
  return -hotness;
}

// ========== 批量评分 + 排序 ==========
// 从候选组合中选出冷门度最高的 N 个

function rankByColdness(candidates, weights, recentReds, topN) {
  const scored = candidates.map(c => ({
    red: c.red,
    blue: c.blue,
    score: coldScore(c.red, c.blue, weights, recentReds),
    features: extractFeatures(c.red, c.blue)
  }));
  scored.sort((a, b) => b.score - a.score);
  return topN ? scored.slice(0, topN) : scored;
}

// ========== 从加权预测候选中选冷门 ==========
// 与现有 predict() 配合:生成 K 个加权候选,从中挑冷门度最高的 N 个

function selectColdFromCandidates(candidates, weights, recentReds, topN) {
  return rankByColdness(candidates, weights, recentReds, topN);
}

// ========== 生成完全冷门组合(非加权) ==========
// 纯随机生成 K 个候选,挑冷门度最高的 N 个
// 这是数学上"最公平"的选号方式(覆盖率 + 冷门度)

function generateColdCombinations(count, weights, recentReds, rng) {
  const random = rng || Math.random;
  const candidates = [];
  const candidateCount = Math.max(count * 20, 200); // 生成 20 倍候选再筛

  for (let i = 0; i < candidateCount; i++) {
    const red = [], used = new Set();
    while (red.length < 6) {
      const n = Math.floor(random() * 33) + 1;
      if (!used.has(n)) { red.push(n); used.add(n); }
    }
    red.sort((a, b) => a - b);
    const blue = Math.floor(random() * 16) + 1;
    candidates.push({ red, blue });
  }

  return rankByColdness(candidates, weights, recentReds, count);
}

// ========== 期望奖金估算 ==========
// 输入:组合的冷门度评分、该期总销售额、奖金池
// 输出:若中一等奖,期望奖金(元)
//
// 模型:
//   E[分奖人数] = 1 + (N - 1) × q_c
//   其中 q_c 用 ColdScore 反推:score 越高 → q_c 越低
//
// 校准:score=0 时 q_c = 1/|Ω| (随机基线)
//       score=+10 时 q_c ≈ 0.3 × 基线(很冷门)
//       score=-10 时 q_c ≈ 3 × 基线(很热门)

function estimateExpectedPrize(coldScoreValue, totalSales, prizePool) {
  const totalCombinations = 17721088;
  const N = Math.max(totalSales / 2, 1); // 总投注数(2元/注)

  // q_c 模型:指数衰减/增长
  // 基线 q0 = 1 / totalCombinations
  // q_c = q0 × exp(-score / 5)  (score 高 → q_c 低)
  const q0 = 1 / totalCombinations;
  const q_c = q0 * Math.exp(-coldScoreValue / 5);

  // 期望分奖人数(含自己)
  const expectedSharers = 1 + (N - 1) * q_c;

  // 期望奖金 = 奖金池 / 分奖人数
  return {
    expectedSharers,
    expectedPrize: prizePool / expectedSharers,
    q_c,
    qRatio: q_c / q0 // 相对基线的倍数
  };
}

// ========== 导出(浏览器/Worker/Node 环境)==========
const ColdnessAPI = {
  extractFeatures,
  coldScore,
  rankByColdness,
  selectColdFromCandidates,
  generateColdCombinations,
  estimateExpectedPrize,
  DEFAULT_FEATURE_WEIGHTS
};

if (typeof window !== 'undefined') {
  window.Coldness = ColdnessAPI;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  // Worker 环境
  self.Coldness = ColdnessAPI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColdnessAPI;
}
