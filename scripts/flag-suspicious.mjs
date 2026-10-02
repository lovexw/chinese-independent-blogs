import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  ROOT,
  loadBlogs,
  probe,
  runPool,
  hostKey,
  hostOf,
  rootOf,
  readJson,
  writeJson,
} from './lib.mjs';

// Content-level suspicious blog detector. Automated checks can only see HTTP status;
// this pass fetches homepage HTML and flags:
//   parked      — domain-for-sale / parked pages
//   botWall     — captcha / human-verification / anti-bot walls
//   empty       — pages with almost no visible text
//   jsRedirect  — script-based redirects to a different domain
//   redirect    — HTTP redirects whose final domain differs from the listed one
// Output: data/suspicious.json + docs/manual-review.md (checkbox list for humans)

const results = readJson(path.join(DATA_DIR, 'suspicious.json'), {});
const blogs = loadBlogs();

const CAPTCHA_RE =
  /just a moment|attention required|cf-browser-verification|checking your browser|verify you are (a )?human|captcha|人机验证|安全验证|访问验证|请完成验证|istian|ddos-guard|cf-chl/i;
const PARKED_RE =
  /此域名可转让|域名出售|域名停放|购买此域名|domain is for sale|domain for sale|buy this domain|sedo|afternic|dan\.com|parked free|hugedomes/i;

const flags = {}; // hostKey -> { name, url, flags:Set, notes:[] }
function flag(host, name, url, f, note) {
  const key = hostKey(url);
  if (!flags[key])
    flags[key] = { name, url, host, flags: new Set(), notes: [] };
  flags[key].flags.add(f);
  if (note && !flags[key].notes.includes(note)) flags[key].notes.push(note);
}

// 1. redirects already recorded by the health check
const checkResults = readJson(path.join(DATA_DIR, 'check-results.json'), {});
const byUrl = new Map(blogs.map((b) => [b.url.replace(/\/+$/, ''), b]));
for (const [url, r] of Object.entries(checkResults)) {
  if (r.ok && r.finalUrl) {
    const blog = byUrl.get(url.replace(/\/+$/, '')) || byUrl.get(url);
    if (blog && rootOf(r.finalUrl) !== rootOf(url)) {
      flag(hostOf(url), blog.name, url, 'redirect', `HTTP 跳转到 ${hostOf(r.finalUrl)} (${r.finalUrl})`);
    }
  }
}

// 2. bot-blocked / insecure-TLS sites kept alive by the audit
const fixes = readJson(path.join(DATA_DIR, 'fixes.json'), {});
for (const k of fixes.kept || []) {
  const blog = byUrl.get(k.url.replace(/\/+$/, ''));
  if (k.status === 'tls-insecure')
    flag(hostOf(k.url), blog?.name || k.url, k.url, 'tlsInsecure', '证书异常（过期/域名不匹配），浏览器访问需点击继续');
  else
    flag(hostOf(k.url), blog?.name || k.url, k.url, 'botWall', `HTTP ${k.status}：程序化访问被拒绝（可能有人机验证或反爬）`);
}

// 3. content pass over all blogs
let t0 = Date.now();
let checked = 0;
await runPool(
  blogs,
  20,
  async (blog) => {
    const r = await probe(blog.url, { timeout: 20000, wantBody: true, maxBody: 150000 });
    if (r.error || r.status >= 400) return; // dead ones are handled by the audit pipeline

    // cross-domain redirect at content level
    if (r.finalUrl && rootOf(r.finalUrl) !== rootOf(blog.url)) {
      flag(hostOf(blog.url), blog.name, blog.url, 'redirect', `最终落在 ${hostOf(r.finalUrl)} (${r.finalUrl})`);
    }

    if (!r.body) return;
    const html = r.body.toString('utf8');
    const lower = html.toLowerCase();

    if (PARKED_RE.test(lower)) {
      flag(hostOf(blog.url), blog.name, blog.url, 'parked', '页面内容疑似域名停放/出售页');
      return;
    }
    if (r.status === 403 || r.status === 429 || CAPTCHA_RE.test(lower)) {
      flag(hostOf(blog.url), blog.name, blog.url, 'botWall', `HTTP ${r.status}：页面含人机验证/反爬特征`);
      return;
    }
    const m = html.match(/location\.(?:href|replace|assign)\s*[=(]\s*["'](https?:\/\/[^"']+)["']/i);
    if (m) {
      try {
        if (rootOf(m[1]) !== rootOf(r.finalUrl || blog.url))
          flag(hostOf(blog.url), blog.name, blog.url, 'jsRedirect', `JS 跳转到 ${m[1]}`);
      } catch {}
    }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 200) {
      flag(hostOf(blog.url), blog.name, blog.url, 'empty', `页面可见文字仅 ${text.length} 字符，疑似空页`);
    }
    checked++;
    return true;
  },
  {
    onProgress: (done, total) =>
      console.log(`content pass ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s) contentOk=${checked}`),
  }
);

const out = {
  generatedAt: new Date().toISOString(),
  blogs: Object.entries(flags).map(([key, v]) => ({
    name: v.name,
    url: v.url,
    flags: [...v.flags],
    notes: v.notes,
  })),
};
writeJson(path.join(DATA_DIR, 'suspicious.json'), out);

// ---- human review checklist ----
const LABELS = {
  redirect: '跳转到其他网站',
  jsRedirect: 'JS 跳转到其他网站',
  botWall: '人机验证 / 反爬拦截',
  parked: '疑似域名停放',
  empty: '疑似空页面',
  tlsInsecure: '证书异常',
};
const lines = [
  '# 人工核验清单（自动检测无法确定的可疑博客）',
  '',
  `> 由 \`scripts/flag-suspicious.mjs\` 于 ${out.generatedAt.slice(0, 10)} 生成。`,
  '> 自动检查只能看到 HTTP 状态码，以下博客存在自动化无法判断的情况，请人工打开确认。',
  '> 核验后：若确认失效 → 从 `blogs-original.csv` 删除该行；若正常 → 无需处理；',
  '> 也可以直接在仓库提 Issue 备注结论。',
  '',
];
const byFlag = {};
for (const b of out.blogs) for (const f of b.flags) (byFlag[f] ||= []).push(b);
for (const [f, label] of Object.entries(LABELS)) {
  const list = byFlag[f];
  if (!list?.length) continue;
  lines.push(`## ${label}（${list.length}）`);
  lines.push('');
  for (const b of list) {
    lines.push(`- [ ] [${b.name}](${b.url}) — ${b.url}${b.notes.length ? ' ｜ ' + b.notes.join('；') : ''}`);
  }
  lines.push('');
}
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'manual-review.md'), lines.join('\n') + '\n', 'utf8');

console.log(`SUSPICIOUS DONE: ${out.blogs.length} flagged -> data/suspicious.json + docs/manual-review.md`);
