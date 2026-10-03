import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

// Generates docs/update-audit.md from data/update-audit.json —
// the human-readable record of the multi-signal update audit.
// Run after update-audit.mjs (gather) — before or after --apply.

const TWO_YEARS = 2 * 365 * 86400e3;
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/update-audit.json'), 'utf8'));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/blogs.json'), 'utf8'));
const now = Date.now();

const decisions = audit.decisions;
const cnt = {};
for (const x of decisions) cnt[x.verdict] = (cnt[x.verdict] || 0) + 1;
const srcCnt = {};
for (const x of decisions) if (x.source) srcCnt[x.source] = (srcCnt[x.source] || 0) + 1;
const staleNow = site.blogs.filter((b) => b.lastUpdate && now - Date.parse(b.lastUpdate) >= TWO_YEARS).length;
const unknownNow = site.blogs.filter((b) => !b.lastUpdate).length;
const rssFixed = decisions.filter((x) => x.suggestedRss);

const lines = [
  `# 更新时间审计报告（多信号）`,
  '',
  `> 由 \`scripts/update-audit.mjs\` 于 ${audit.generatedAt.slice(0, 10)} 生成，每周随巡检更新。`,
  '',
  '## 方法论',
  '',
  '单纯依赖列表里的 RSS 地址会产生两类误判：博客改版/搬家后旧 feed 还挂着（**真更新了却显示沉睡**），',
  '或 feed 的 lastBuildDate/评论时间被误当文章时间（**没更新却显示活跃**）。本次审计对每个博客采集三种独立信号：',
  '',
  '1. **feed** — 重新推导 RSS：从首页**实际落点 URL** 做自动发现 + 常见路径探测，修“地址错位”；评论 feed 一律排除',
  '2. **home** — 首页可见的最新文章日期（ISO / 中文 / 英文 / `<time datetime>` / JSON-LD，全部为绝对日期；',
  '   相对日期“3天前/今天”刻意不用——旧文章引用这些词会造成假新鲜）',
  '3. **sitemap** — sitemap.xml（含 robots.txt 声明、sitemapindex 子文件）的最大 `<lastmod>`',
  '',
  '最终 `lastUpdate = max(信号)`，并记录命中来源。某轮探测失败的博客**保留上次确认的日期**，不会被抹成“未知”。',
  '',
  '## 本次结果',
  '',
  '| 判定 | 数量 | 含义 |',
  '| --- | --- | --- |',
  `| unchanged | ${cnt.unchanged || 0} | 与之前一致 |`,
  `| date-shifted | ${cnt['date-shifted'] || 0} | 日期得到修正 |`,
  `| revived | ${cnt.revived || 0} | **原本以为沉睡/未知，实际仍在更新** |`,
  `| newly-stale | ${cnt['newly-stale'] || 0} | **原本以为活跃，实际已沉睡** |`,
  '',
  `信号来源分布：feed=${srcCnt.feed || 0}，home=${srcCnt.home || 0}，sitemap=${srcCnt.sitemap || 0}`,
  '',
  `| 指标 | 审计前 | 审计后 |`,
  '| --- | --- | --- |',
  `| 确认沉睡(2年+) | 148 | ${staleNow} |`,
  `| 更新时间未知 | 293 | ${unknownNow} |`,
  '',
  `RSS 地址修正：${rssFixed.length} 个（评论区 feed 排除后自动发现的新 feed，仅限同域名）`,
  '',
];

function list(title, arr, fmt) {
  lines.push(`## ${title}（${arr.length}）`, '');
  if (!arr.length) lines.push('（无）', '');
  for (const x of arr) lines.push(`- [${x.name}](${x.url}) — ${fmt(x)}`);
  lines.push('');
}

list(
  '复活：以为沉睡，实际在更新',
  decisions.filter((x) => x.verdict === 'revived'),
  (x) => `${x.prevLastUpdate ? '此前记录 ' + x.prevLastUpdate.slice(0, 10) : '此前未知'} → 实际 ${x.lastUpdate.slice(0, 10)}（来源: ${x.source}）`
);
list(
  '新发现沉睡：以为活跃，实际已停更',
  decisions.filter((x) => x.verdict === 'newly-stale'),
  (x) => `此前记录 ${x.prevLastUpdate?.slice(0, 10) || '未知'} → 实际 ${x.lastUpdate?.slice(0, 10) || '未知'}（来源: ${x.source || '-'}）`
);
list(
  'RSS 地址修正',
  rssFixed,
  (x) => `\`${x.listedRss || '（无）'}\` → \`${x.suggestedRss}\``
);

fs.writeFileSync(path.join(ROOT, 'docs/update-audit.md'), lines.join('\n') + '\n', 'utf8');
console.log(`UPDATE AUDIT REPORT -> docs/update-audit.md`);
