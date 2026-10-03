import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeJson } from './lib.mjs';

// Generates docs/stale-blogs.md — the list of blogs whose RSS shows no new post
// for 2+ years, so the maintainer can decide whether to remove them.
// Read-only report: nothing is deleted automatically.
// Also writes data/stale.json for tooling. Run after build.mjs (reads public/data/blogs.json).

const TWO_YEARS = 2 * 365 * 86400e3;
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/blogs.json'), 'utf8'));
const now = Date.now();

const stale = site.blogs
  .filter((b) => b.lastUpdate && now - Date.parse(b.lastUpdate) >= TWO_YEARS)
  .sort((a, b) => Date.parse(a.lastUpdate) - Date.parse(b.lastUpdate));

const unknown = site.blogs.filter((b) => !b.lastUpdate);

writeJson(path.join(ROOT, 'data/stale.json'), {
  generatedAt: new Date().toISOString(),
  cutoff: new Date(now - TWO_YEARS).toISOString().slice(0, 10),
  stale: stale.map((b) => ({ name: b.name, url: b.url, rss: b.rss, lastUpdate: b.lastUpdate })),
  unknownCount: unknown.length,
});

const lines = [
  `# 沉睡博客清单（确认 2 年以上未更新）`,
  '',
  `> 由 \`scripts/stale-report.mjs\` 于 ${new Date().toISOString().slice(0, 10)} 生成，每周自动更新。`,
  `> 判定标准：该博客 RSS 中最新一篇文章的时间早于 ${new Date(now - TWO_YEARS).toISOString().slice(0, 10)}（距今 2 年前）。`,
  `> 这份清单**不会自动删除**，是否剔除由维护者酌情决定；确认要删的，直接删除 \`blogs-original.csv\` 对应行即可。`,
  `> 另有 ${unknown.length} 个博客没有 RSS 或 feed 中无时间，无法判定更新时间（未列入本清单，站点中显示“更新时间未知”并排在沉睡博客之后）。`,
  '',
  `共 ${stale.length} 个（站点中已自动降低排序优先级并标注 💤）。`,
  '',
];

let year = '';
for (const b of stale) {
  const y = b.lastUpdate.slice(0, 4);
  if (y !== year) {
    year = y;
    lines.push(`## ${y} 年`);
    lines.push('');
  }
  lines.push(
    `- [ ] [${b.name}](${b.url}) — 最后更新 ${b.lastUpdate.slice(0, 10)}${b.rss ? ` ｜ RSS: ${b.rss}` : ''}`
  );
}
lines.push('');

fs.writeFileSync(path.join(ROOT, 'docs/stale-blogs.md'), lines.join('\n'), 'utf8');
console.log(`STALE REPORT: ${stale.length} stale (>=2yr), ${unknown.length} unknown -> docs/stale-blogs.md`);
