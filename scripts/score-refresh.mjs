import path from 'node:path';
import {
  DATA_DIR,
  loadBlogs,
  hostKey,
  readJson,
  writeJson,
  probe,
  runPool,
} from './lib.mjs';

// 博客评分引擎：给每个收录博客算一个 1-100 的质量分，作为维护者控制列表质量的标尺。
//
//   最终分 = manual.score（人工绝对分）
//          或 clamp(60 + 自动分 + manual.delta)（人工微调）
//
// 自动分维度（可量化，来自每周巡检数据，本脚本补充实时测速）：
//   1. 更新频率   lastupdate.json 的内容级最近更新时间（+14 ~ -12）
//   2. 订阅完备   是否提供 RSS（+2 / 0）
//   3. 打开速度   本轮实时 TTFB 测速（+4 ~ -5）
//   4. 可达性     check-results.json 巡检结论（不可达 -15；403 等反爬存活不罚）
//   5. 读者热度   近 90 天列表页外链点击 TOP150（+4 ~ +2，读者用点击投票）
//
// 人工因素由维护者在后台调整（知名博客直接定 90-100，机器刷活跃的酌情调低）。
// 详细评分标准见 docs/scoring.md。每周巡检通过 docker/audit-job.sh 的 score 步骤刷新。

const SCORES_PATH = path.join(DATA_DIR, 'scores.json');
const KEPT_STATUSES = new Set([401, 402, 403, 406, 407, 416, 429, 456]); // "反爬但活着"保留类
// build.mjs 的置顶博客不在 CSV 里（构建时插入），这里补上让它也参与评分
const PINNED_URL = 'https://blog.xiaowuleyi.com/';

const FAST_MS = 300; // TTFB ≤300ms 视为优秀
const SPEED_TIERS = [
  [FAST_MS, 4, '秒开'],
  [800, 3, '打开很快'],
  [2000, 1, '打开速度正常'],
  [4000, -2, '打开偏慢'],
  [Infinity, -4, '打开很慢'],
];
const SPEED_FAIL = -5; // 测速超时/失败（可能反爬或网络问题，不与"慢"混淆）

function clampScore(n) {
  return Math.max(1, Math.min(100, Math.round(n)));
}

function activityDelta(lastUpdate) {
  if (!lastUpdate) return { d: 0, note: '更新时间未知（不奖不罚）' };
  const days = (Date.now() - Date.parse(lastUpdate)) / 86400e3;
  if (Number.isNaN(days)) return { d: 0, note: '更新时间未知（不奖不罚）' };
  if (days <= 7) return { d: 14, note: '近 7 天有更新' };
  if (days <= 30) return { d: 12, note: '近 30 天有更新' };
  if (days <= 90) return { d: 9, note: '近 90 天有更新' };
  if (days <= 180) return { d: 6, note: '近半年有更新' };
  if (days <= 365) return { d: 2, note: '一年内有更新' };
  if (days <= 730) return { d: -6, note: '沉睡 1-2 年' };
  return { d: -12, note: '沉睡 2 年以上' };
}

function speedDelta(ttfbMs) {
  if (ttfbMs == null) return { d: SPEED_FAIL, note: '测速超时/失败（可能反爬）' };
  for (const [max, d, note] of SPEED_TIERS) {
    if (ttfbMs <= max) return { d, note: `${note}（TTFB ${ttfbMs}ms）` };
  }
  return { d: 0, note: '' };
}

function reachDelta(check) {
  if (!check) return { d: 0, note: '' }; // 无巡检数据：不罚
  if (check.ok) return { d: 0, note: '' };
  if (check.status && KEPT_STATUSES.has(check.status)) return { d: 0, note: `反爬存活（HTTP ${check.status}）` };
  return { d: -15, note: `巡检判定不可达${check.status ? `（HTTP ${check.status}）` : ''}` };
}

/** 读者点击热度：近 90 天外链点击榜名次 → 小幅加分（读者用点击投票） */
function clickRankMap(stats) {
  const ranked = Object.entries(stats.clicks || {})
    .map(([host, v]) => [host, v.total || 0])
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1]);
  const rank = new Map();
  ranked.forEach(([host], i) => rank.set(host, i + 1));
  return rank;
}

function clickDelta(rank) {
  if (!rank) return { d: 0, note: '' };
  if (rank <= 10) return { d: 4, note: `读者点击热度 TOP ${rank}` };
  if (rank <= 50) return { d: 3, note: `读者点击热度 TOP ${rank}` };
  if (rank <= 150) return { d: 2, note: `读者点击热度 TOP ${rank}` };
  return { d: 0, note: '' };
}

function finalize(entry) {
  if (!entry) return 60;
  if (entry.manual && Number.isFinite(entry.manual.score)) return clampScore(entry.manual.score);
  return clampScore(60 + (entry.auto || 0) + (entry.manual?.delta || 0));
}

// ---------- 主流程 ----------

const blogs = loadBlogs();
if (!blogs.some((b) => hostKey(b.url) === hostKey(PINNED_URL))) {
  blogs.push({ name: '小吴乐意Blog', url: PINNED_URL, rss: '', tags: [] });
}

const lastupdate = readJson(path.join(DATA_DIR, 'lastupdate.json'), {});
const checkResults = readJson(path.join(DATA_DIR, 'check-results.json'), {});
const stats = readJson(path.join(DATA_DIR, 'stats.json'), {});
const clickRank = clickRankMap(stats);

// 巡检结果按 hostKey 聚合（同一主机多条 URL 时优先取 ok 的那条）
const checkByHost = new Map();
for (const [url, r] of Object.entries(checkResults)) {
  const k = hostKey(url);
  if (!k) continue;
  const prev = checkByHost.get(k);
  if (!prev || (!prev.ok && r.ok)) checkByHost.set(k, r);
}

// 人工评定永久保留；自动信号每周刷新
const prev = readJson(SCORES_PATH, { blogs: {} });
const prevEntries = prev.blogs || {};

let t0 = Date.now();
const entries = await runPool(blogs, 25, async (b) => {
  const key = hostKey(b.url);
  const lu = lastupdate[key];
  const lastUpdate = lu?.lastUpdate || null;
  const hasRss = !!(b.rss || lu?.rss);

  // 实时测速：GET 首页取首字节时间（与 check-links 同一 UA，行为一致）
  const t = Date.now();
  const r = await probe(b.url, { timeout: 12000 });
  const ttfb = r.error ? null : Date.now() - t;

  const detail = [];
  const act = activityDelta(lastUpdate);
  detail.push({ k: '更新频率', d: act.d, note: act.note });
  detail.push({ k: '订阅完备', d: hasRss ? 2 : 0, note: hasRss ? '提供 RSS 订阅' : '未提供 RSS' });
  const spd = speedDelta(ttfb);
  detail.push({ k: '打开速度', d: spd.d, note: spd.note });
  const rch = reachDelta(checkByHost.get(key));
  if (rch.note) detail.push({ k: '可达性', d: rch.d, note: rch.note });
  const clk = clickDelta(clickRank.get(key));
  if (clk.note) detail.push({ k: '读者热度', d: clk.d, note: clk.note });

  const manual = prevEntries[key]?.manual || null;
  const entry = {
    score: 60,
    auto: detail.reduce((n, x) => n + x.d, 0),
    autoDetail: detail.filter((x) => x.d !== 0 || x.note),
    manual,
    signals: {
      lastUpdate,
      ttfbMs: ttfb,
      reach: checkByHost.get(key)
        ? checkByHost.get(key).ok
          ? 'ok'
          : checkByHost.get(key).status && KEPT_STATUSES.has(checkByHost.get(key).status)
            ? 'kept'
            : 'dead'
        : 'unknown',
      clicks: clickRank.get(key) || null,
    },
    refreshedAt: new Date().toISOString(),
  };
  entry.score = finalize(entry);
  return [key, entry];
});

const scores = { updatedAt: new Date().toISOString(), blogs: {} };
for (const [k, e] of entries) scores.blogs[k] = e;
writeJson(SCORES_PATH, scores);

// 概览
const dist = { elite: 0, good: 0, base: 0, watch: 0 };
let sum = 0;
for (const e of Object.values(scores.blogs)) {
  sum += e.score;
  if (e.score >= 90) dist.elite++;
  else if (e.score >= 80) dist.good++;
  else if (e.score >= 60) dist.base++;
  else dist.watch++;
}
const total = Object.keys(scores.blogs).length || 1;
console.log(
  `score-refresh done: ${total} blogs in ${Math.round((Date.now() - t0) / 1000)}s | ` +
    `精选≥90: ${dist.elite} · 推荐80-89: ${dist.good} · 基准60-79: ${dist.base} · 待观察<60: ${dist.watch} · ` +
    `平均 ${Math.round((sum / total) * 10) / 10}`
);
