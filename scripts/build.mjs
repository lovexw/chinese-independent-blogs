import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  DATA_DIR,
  CSV_PATH,
  loadBlogs,
  saveBlogs,
  hostKey,
  hostOf,
  writeJson,
  readJson,
} from './lib.mjs';

// Assembles the final artifacts from blogs-original.csv + data/*.json:
//   1. applies link/rss fixes found by fix-dead.mjs
//   2. removes hard-dead blogs -> data/offline.json
//   3. dedupes by host, pins xiaowuleyi blog to the top
//   4. rewrites blogs-original.csv, README.md, feed.opml
//   5. builds public/data/blogs.json for the showcase site

const APPLY_ONLY = process.argv.includes('--apply-only');
const PIN_URL = 'https://blog.xiaowuleyi.com/';
const PIN_RSS = 'https://blog.xiaowuleyi.com/rss.php';
const PIN_KEY = 'xiaowuleyi.com';

const fixes = readJson(path.join(DATA_DIR, 'fixes.json'), { urlFixes: {}, rssFixes: {}, dead: [] });
const lastupdate = readJson(path.join(DATA_DIR, 'lastupdate.json'), {});

let blogs = loadBlogs();
const before = blogs.length;

// --- 1. apply url fixes ---
for (const b of blogs) {
  const norm = b.url.replace(/\/+$/, '');
  const fix = fixes.urlFixes?.[norm];
  if (fix) b.url = fix;
}

// --- 2. drop hard-dead blogs (archive them) ---
const deadSet = new Map((fixes.dead || []).map((d) => [d.url.replace(/\/+$/, ''), d.reason]));
const offline = [];
blogs = blogs.filter((b) => {
  const norm = b.url.replace(/\/+$/, '');
  if (deadSet.has(norm)) {
    offline.push({
      name: b.name,
      url: b.url,
      rss: b.rss,
      tags: b.tags,
      reason: deadSet.get(norm),
      removedAt: new Date().toISOString().slice(0, 10),
    });
    return false;
  }
  return true;
});

// --- 3. rss fixes + discovered feeds ---
for (const b of blogs) {
  const key = hostKey(b.url);
  const rssFix = fixes.rssFixes?.[key];
  if (rssFix) b.rss = rssFix;
  const lu = lastupdate[key];
  if (!b.rss && lu?.rss) b.rss = lu.rss; // filled by autodiscovery
}

// --- 4. dedupe by host key (keep first) ---
const seen = new Set();
const dupes = [];
blogs = blogs.filter((b) => {
  const key = hostKey(b.url);
  if (!key) return true;
  if (seen.has(key)) {
    dupes.push(b);
    return false;
  }
  seen.add(key);
  return true;
});

// --- 5. pin xiaowuleyi, always first row (match any subdomain of the domain) ---
blogs = blogs.filter((b) => hostOf(b.url) !== PIN_KEY && !hostOf(b.url).endsWith('.' + PIN_KEY));
const luPin = lastupdate[PIN_KEY];
blogs.unshift({
  name: '小吴乐意Blog',
  url: PIN_URL,
  rss: luPin?.rss || PIN_RSS,
  desc: '仓库维护者的博客 · 记录生活随想与商业思考',
  tags: ['生活随想', '商业思考'],
  pinned: true,
});

// --- write csv ---
saveBlogs(blogs);

// --- archive offline list ---
if (offline.length) {
  const prevOffline = readJson(path.join(DATA_DIR, 'offline.json'), []);
  const prevUrls = new Set(prevOffline.map((o) => o.url.replace(/\/+$/, '')));
  const merged = [...prevOffline, ...offline.filter((o) => !prevUrls.has(o.url.replace(/\/+$/, '')))];
  writeJson(path.join(DATA_DIR, 'offline.json'), merged);
  console.log(`archived ${offline.length} offline blogs (total ${merged.length})`);
}

console.log(
  `blogs: ${before} -> ${blogs.length} (removed ${offline.length}, deduped ${dupes.length})`
);

// --- 6. README ---
const siteUrlFile = path.join(DATA_DIR, 'site-url.txt');
const siteUrl = fs.existsSync(siteUrlFile) ? fs.readFileSync(siteUrlFile, 'utf8').trim() : '';
const siteLine = siteUrl ? `\n**🌐 在线浏览：[${siteUrl}](${siteUrl})**\n` : '';

const genAt = new Date().toISOString().slice(0, 10);
const total = blogs.length;
const withRss = blogs.filter((b) => b.rss).length;

function tableRow(b) {
  const rss = b.rss ? `[Feed](${b.rss})` : 'None';
  const intro = (b.pinned ? '📌 ' : '') + b.name;
  return `| ${rss} | ${intro} | ${b.url} | ${b.tags.join('; ')} |`;
}

const readme = `# 中文独立博客列表

${siteLine}
> 本仓库由 [timqian/chinese-independent-blogs](https://github.com/timqian/chinese-independent-blogs) 衍生而来，感谢原作者收集整理。
> 在原列表基础上：定期检测所有链接的可达性、失效博客自动清理归档、修补可迁移的地址与 RSS、并通过 RSS 抓取每个博客的最后更新时间。

| 项目 | 数量 |
| --- | --- |
| 收录博客 | ${total} |
| 提供 RSS | ${withRss} |
| 列表维护时间 | ${genAt} |

## 博客列表

> 排序大致沿用原列表的订阅热度；首位为仓库维护者博客（置顶展示）。

| RSS feed | Introduction | Address | tags |
| --- | --- | --- | --- |
${blogs.map(tableRow).join('\n')}

## 失效与归档

- 每次构建都会重新检测全部链接；无法访问且无可用替代地址的博客会从列表移除，并归档在 [data/offline.json](./data/offline.json)。
- 域名仍在但原地址失效的博客，会自动尝试 \`www. / blog. / 裸域\` 等常见变体地址，命中后同步替换其 RSS 订阅链接。
- 上游新增的博客会通过 [scripts/sync-upstream.mjs](./scripts/sync-upstream.mjs) 定期增量同步（只增不删，已有条目的修复保持不变）。

## 如何提交

1. 在 [./blogs-original.csv](./blogs-original.csv) 尾部添加一行：名称、URL、RSS、标签
2. 提交 PR / Issue

## 本地构建

\`\`\`bash
npm run build        # 检测链接 -> 修复失效 -> 刷新 RSS 时间 -> 生成站点数据
npm run serve        # 本地预览展示站点
\`\`\`

## 部署

纯静态站点，构建产物在 \`public/\`，可直接部署到 Cloudflare Pages，参见 [docs/DEPLOY.md](./docs/DEPLOY.md)。

## 为什么要收集这张列表

不止一次听到有人说："在中国, 独立博客的时代已经过去了"。确实，很多博主都转到了公众号，知乎专栏，小密圈，微博……
这些平台读者比较多、他们的推荐算法可以让你的内容被更多人看到。

但我还是更喜欢独立博客，因为有属于自己的域名，因为可以自由地排版，自由地说话。

这个列表是一个开始，先把独立博客们收集起来。
`;

fs.writeFileSync(path.join(ROOT, 'README.md'), readme, 'utf8');

// --- 7. OPML ---
function attr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
const opmlItems = blogs
  .filter((b) => b.rss)
  .map(
    (b) =>
      `<outline text=${attr(b.name)} title=${attr(b.name)} type="rss" xmlUrl=${attr(b.rss)} htmlUrl=${attr(b.url)}/>`
  )
  .join('\n');
fs.writeFileSync(
  path.join(ROOT, 'feed.opml'),
  `<?xml version="1.0" encoding="UTF-8"?><opml version="1.0"><head><title>中文独立博客列表</title></head><body>\n${opmlItems}\n</body></opml>\n`,
  'utf8'
);

// --- 8. site data ---
if (!APPLY_ONLY) {
  const siteBlogs = blogs.map((b) => ({
    name: b.name,
    url: b.url,
    rss: b.rss,
    // upstream Introduction column doubles as the name; drop it when not a real description
    desc: b.desc && b.desc !== b.name ? b.desc : '',
    tags: b.tags,
    lastUpdate: lastupdate[hostKey(b.url)]?.lastUpdate || null,
  }));
  // name vs desc: in the upstream CSV the Introduction column IS the display name.
  writeJson(path.join(ROOT, 'public/data/blogs.json'), {
    generatedAt: new Date().toISOString(),
    total: siteBlogs.length,
    blogs: siteBlogs,
  });
  fs.copyFileSync(CSV_PATH, path.join(ROOT, 'public', 'blogs.csv'));
  fs.copyFileSync(path.join(ROOT, 'feed.opml'), path.join(ROOT, 'public', 'feed.opml'));
  console.log(`site data written: public/data/blogs.json (${siteBlogs.length} blogs)`);
}

console.log('BUILD DONE');
