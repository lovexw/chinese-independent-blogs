import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadBlogs, probe, runPool, writeJson } from './lib.mjs';

// 机器更新扫描：识别"cron 定时批量生成内容冒充博主活跃"的站点
// 双重指纹才算实锤（缺一只算待复核，绝不误伤）：
//   A. cron 秒级指纹 —— ≥3 篇文章 pubDate 的时分秒完全相同、分布在不同日期
//   B. 标题模板化    —— 标题去掉日期/数字后雷同的 ≥3 篇
// 另记录：动态盖戳（pubDate 落在抓取时刻 ±5 分钟内的条目数）
// 用法：node scripts/machine-scan.mjs [--days N]（默认 3，扫最近 N 天有更新的博客）[--all]

const DAYS = (() => {
  const i = process.argv.indexOf('--days');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : 3;
})();
const ALL = process.argv.includes('--all');
const OUT_MD = path.join(ROOT_DIR(), 'docs', 'machine-update-review.md');
const OUT_JSON = path.join(DATA_DIR, 'machine-scan.json');
function ROOT_DIR() {
  return path.resolve(new URL('..', import.meta.url).pathname);
}

const blogs = loadBlogs();
const lu = readJsonLocal(path.join(DATA_DIR, 'lastupdate.json'), {});
const cutoff = Date.now() - DAYS * 86400e3;
const cohort = blogs.filter((b) => {
  if (ALL) return true;
  const t = lu[hostKeyLocal(b.url)]?.lastUpdate ? Date.parse(lu[hostKeyLocal(b.url)].lastUpdate) : 0;
  return t >= cutoff;
});
console.log(`扫描范围：${cohort.length}/${blogs.length} 个博客（最近 ${DAYS} 天有更新${ALL ? '，实际全量' : ''}）`);

function hostKeyLocal(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return u;
  }
}
function readJsonLocal(p, fb) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
}

function parseItems(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<(?:entry|item)[\s>][\s\S]*?<\/(?:entry|item)>/gi)) {
    const block = m[0];
    const title = block.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const pd = block.match(/<(?:pubDate|published|updated|dc:date)>([^<]{10,60})</)?.[1]?.trim() || '';
    const t = Date.parse(pd);
    items.push({ title, ts: Number.isNaN(t) ? null : t });
  }
  return items;
}

function stripTemplate(title) {
  return title
    .replace(/20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}日?/g, '')
    .replace(/\d+/g, '')
    .replace(/[\s\-—_·.、|#【】\[\]()（）]+/g, '')
    .trim();
}

const results = [];
await runPool(cohort, 10, async (blog) => {
  if (!blog.rss) return;
  const r = await probe(blog.rss, { timeout: 18000, wantBody: true, maxBody: 400000 });
  if (r.error || r.status >= 400) return;
  const items = parseItems(r.body.toString('utf8')).filter((it) => it.ts);
  if (items.length < 3) return;

  // A. cron 秒级指纹：同一 HH:MM:SS 出现在 ≥3 篇、且分布在 ≥2 个不同日期
  const bySec = new Map();
  for (const it of items) {
    const d = new Date(it.ts);
    const key = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    const days = bySec.get(key) ?? new Set();
    days.add(d.toISOString().slice(0, 10));
    bySec.set(key, days);
  }
  const cronGroups = [...bySec.entries()].filter(([, days]) => days.size >= 2);
  const cronItems = cronGroups.reduce((n, [, days]) => n + [...days].length, 0);
  const cron = cronGroups.reduce((n, [, days]) => n + [...days].length, 0) >= 3;

  // B. 标题模板化：去掉日期/数字后雷同 ≥3 篇
  const byTpl = new Map();
  for (const it of items) {
    const tpl = stripTemplate(it.title);
    if (tpl.length < 2) continue; // 全是数字的标题无意义
    byTpl.set(tpl, (byTpl.get(tpl) || 0) + 1);
  }
  const [topTpl, topTplN] = [...byTpl.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const templated = topTplN >= 3;

  // C. 动态盖戳：pubDate 落在抓取时刻 ±5 分钟内的条目数
  const now = Date.now();
  const stampN = items.filter((it) => Math.abs(now - it.ts) < 5 * 60e3).length;

  const evidence = {
    url: blog.url,
    rss: blog.rss,
    items: items.length,
    cronSeconds: cronGroups.map(([sec, days]) => `${sec} x${[...days].length}天`).slice(0, 4),
    cron,
    template: templated ? `"${topTpl}" x${topTplN}` : null,
    stampNearFetch: stampN,
    newest: new Date(Math.max(...items.map((it) => it.ts))).toISOString(),
    sampleTitles: items.slice(0, 4).map((it) => it.title),
  };
  evidence.verdict = cron && templated ? 'CONFIRMED 机器批量生成'
    : cron || stampN >= 2 ? 'SUSPECT 待人工复核'
      : 'clean';
  results.push(evidence);
});

results.sort((a, b) => (a.verdict.startsWith('CONFIRMED') ? -1 : b.verdict.startsWith('CONFIRMED') ? 1 : 0));
writeJson(OUT_JSON, { scannedAt: new Date().toISOString(), days: ALL ? 'all' : DAYS, results });

const conf = results.filter((r) => r.verdict.startsWith('CONFIRMED'));
const susp = results.filter((r) => r.verdict.startsWith('SUSPECT'));
console.log(`\n扫描完成：实锤 ${conf.length} 个，待复核 ${susp.length} 个`);
for (const r of conf) console.log(`  [实锤] ${r.url} | ${r.cronSeconds.join(', ')} | 模板 ${r.template}`);
for (const r of susp) console.log(`  [待复核] ${r.url} | cron=${r.cron ? r.cronSeconds.join(',') : 'no'} | stamp=${r.stampNearFetch}`);

// 生成人工复核文档
const lines = [
  `# 机器更新扫描报告（${new Date().toISOString().slice(0, 10)}，范围：最近 ${ALL ? '全部' : DAYS + ' 天'}有更新的 ${cohort.length} 个博客）`,
  '',
  `> 判定标准（双重指纹，缺一不杀）：A=cron 秒级指纹（≥3 篇发布时间精确到同一秒且跨 ≥2 天）+ B=标题模板化（≥3 篇）。`,
  `> 单一指纹进待复核名单。维护者确认后移除并写入 offline.json 永久拉黑。`,
  '',
];
if (conf.length) {
  lines.push(`## 实锤（${conf.length}）`, '');
  for (const r of conf) {
    lines.push(`### ${r.url}`, `- cron 指纹：${r.cronSeconds.join('，')}（共 ${r.items} 条）`, r.template ? `- 标题模板：${r.template}` : '', `- 样例标题：${r.sampleTitles.map((t) => JSON.stringify(t)).join('、')}`, '');
  }
}
if (susp.length) {
  lines.push(`## 待人工复核（${susp.length}）`, '');
  for (const r of susp) {
    lines.push(`- ${r.url} — cron:${r.cron ? r.cronSeconds.join(',') : '-'} / 靠近抓取时间的条目:${r.stampNearFetch} / 样例:${r.sampleTitles[0]}`);
  }
}
fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
fs.writeFileSync(OUT_MD, lines.join('\n') + '\n');
console.log(`\n报告已写入 ${OUT_MD}`);
