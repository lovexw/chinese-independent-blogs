import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';

export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const DATA_DIR = path.join(ROOT, 'data');
export const CSV_PATH = path.join(ROOT, 'blogs-original.csv');
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------- CSV ----------

/** RFC4180-ish CSV parser (handles quoted fields, commas, newlines, escaped quotes). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c === '\r') {
      // ignore, handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function csvEscape(s) {
  s = String(s ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Read blogs-original.csv into a list of {name, url, rss, tags[]}. */
export function loadBlogs(csvPath = CSV_PATH) {
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iName = header.indexOf('introduction');
  const iUrl = header.indexOf('address');
  const iRss = header.indexOf('rss feed');
  const iTags = header.indexOf('tags');
  const blogs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[iName] ?? '').trim();
    const url = (r[iUrl] ?? '').trim();
    if (!name || !url) continue;
    const rss = (r[iRss] ?? '').trim();
    const tags = (r[iTags] ?? '')
      .split(/[;；]/)
      .map((t) => t.trim())
      .filter(Boolean);
    blogs.push({ name, url, rss: rss && rss.toLowerCase() !== 'none' ? rss : '', tags });
  }
  return blogs;
}

export function saveBlogs(blogs, csvPath = CSV_PATH) {
  const lines = ['Introduction, Address, RSS feed, tags'];
  for (const b of blogs) {
    lines.push(
      [b.name, b.url, b.rss || '', b.tags.join('; ')].map(csvEscape).join(', ')
    );
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf8');
}

// ---------- URL helpers ----------

export function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Identity key: hostname minus leading www. — used for dedupe & upstream sync. */
export function hostKey(u) {
  const h = hostOf(u);
  return h.replace(/^www\./, '');
}

const MULTI_TLDS = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.uk', 'org.uk', 'com.hk', 'com.tw', 'co.jp', 'ne.jp', 'or.jp',
  'com.au', 'co.nz', 'com.sg', 'co.kr',
]);

/** Registrable-domain-ish root: last two (or three for multi-part TLDs) labels. */
export function rootOf(u) {
  const h = hostOf(u);
  if (!h) return '';
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_TLDS.has(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return last2;
}

export function withScheme(u, scheme) {
  try {
    const url = new URL(u);
    url.protocol = scheme;
    return url.toString();
  } catch {
    return u;
  }
}

export function hostVariants(u) {
  try {
    const url = new URL(u);
    const h = url.hostname.toLowerCase();
    const rest = u.slice(u.indexOf('://') + 3 + h.length); // path etc, keeps original scheme
    const bare = h.replace(/^www\./, '').replace(/^blog\./, '');
    const hosts = [...new Set([bare, `www.${bare}`, `blog.${bare}`])];
    const out = [];
    for (const host of hosts) {
      out.push(`https://${host}${rest}`);
      out.push(`http://${host}${rest}`);
    }
    return out.filter((c) => c !== u);
  } catch {
    return [];
  }
}

export const COMMON_FEED_PATHS = [
  'feed',
  'feed/',
  'rss',
  'rss/',
  'rss.xml',
  'feed.xml',
  'atom.xml',
  'index.xml',
  'feed.atom',
  'feeds/posts/default',
  '?feed=rss2',
  'feed.php',
  'rss.php',
  'feed.json',
];

export function feedVariants(siteUrl) {
  try {
    const url = new URL(siteUrl);
    const base = `${url.protocol}//${url.host}`;
    return COMMON_FEED_PATHS.map((p) => `${base}/${p}`);
  } catch {
    return [];
  }
}

// ---------- HTTP ----------

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,atom+xml;q=0.7,*/*;q=0.5',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
};

/**
 * Fetch and return {status, finalUrl, error, contentType, body?}.
 * HEAD-free: uses GET; body only read when wanted (capped).
 */
export async function probe(url, { timeout = 15000, wantBody = false, maxBody = 300000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { ...DEFAULT_HEADERS, ...headers },
    });
    let body = null;
    if (wantBody && res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (size < maxBody) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
      } catch {
        /* body read error is tolerable if we already have headers */
      }
      ctrl.abort(); // stop downloading the rest
      body = Buffer.concat(chunks).subarray(0, maxBody);
    } else if (!wantBody && res.body) {
      ctrl.abort(); // headers are enough
    }
    return {
      status: res.status,
      finalUrl: res.url || url,
      contentType: res.headers.get('content-type') || '',
      error: null,
      body,
    };
  } catch (e) {
    const err = e?.cause ?? e;
    const code = err?.code || err?.name || 'error';
    const msg = String(err?.message || err || 'error').slice(0, 120);
    if (code === 'AbortError' || msg === 'timeout' || err?.name === 'TimeoutError')
      return { status: 0, finalUrl: url, contentType: '', error: 'timeout', body: null };
    return { status: 0, finalUrl: url, contentType: '', error: `${code}: ${msg}`, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveHost(hostname) {
  try {
    const addrs = await dns.resolve4(hostname);
    return addrs.length > 0;
  } catch {
    try {
      const addrs = await dns.resolve6(hostname);
      return addrs.length > 0;
    } catch {
      return false;
    }
  }
}

// ---------- concurrency pool ----------

export async function runPool(items, limit, worker, { onProgress } = {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
}

export function isFeedBody(contentType, body) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) return true;
  if (body) {
    const head = body.subarray(0, 2048).toString('utf8').toLowerCase();
    return /<rss|<feed|<\?xml[\s\S]{0,200}<(rss|feed)|application\/(rss|atom)\+xml/.test(head);
  }
  return false;
}

// ---------- 更新时间判定 v2（2026-10-11 起）----------
// 背景：动态站点（如 Flask/Werkzeug 渲染的 feed，见 www.dongwm.com）会在频道级
// <updated>/<lastBuildDate> 上盖"当前时间"，sitemap 会给 /、/auth/* 等应用路由盖
// 动态 lastmod——陈年博客因此永远显示"刚刚更新"。新标准只信内容级日期：
//   feed    → 仅 <entry>/<item> 内部的日期，频道级一概不看
//   sitemap → 仅真实页面 URL 的 lastmod（排除根路径/应用路由/全体同值的生成戳）

const MIN_DATE_TS = Date.parse('2000-01-01');

export function feedItemDates(xml) {
  const text = String(xml ?? '');
  const dates = [];
  const blocks = [...text.matchAll(/<(?:entry|item)[\s>][\s\S]*?<\/(?:entry|item)>/gi)];
  // 没有 entry/item 块的 feed 无法给出内容级日期（宁可返回空，也不要频道级假日期）
  for (const b of blocks) {
    for (const m of b[0].matchAll(/<(?:pubDate|published|updated|dc:date)>([^<]{10,60})</g)) {
      const t = Date.parse(m[1].trim());
      if (!Number.isNaN(t) && t >= MIN_DATE_TS) dates.push(t);
    }
    for (const m of b[0].matchAll(/datetime=["']([^"']{10,60})["']/g)) {
      const t = Date.parse(m[1]);
      if (!Number.isNaN(t) && t >= MIN_DATE_TS) dates.push(t);
    }
  }
  return dates;
}

export function newestFeedItemDate(xml) {
  const ds = feedItemDates(xml);
  return ds.length ? new Date(Math.max(...ds)).toISOString() : null;
}

// sitemap 里典型的"非文章"路径：应用/列表/元数据路由，lastmod 常是动态生成时间
const SITEMAP_META_SEGMENTS = new Set([
  'auth', 'oauth', 'login', 'register', 'signin', 'signup', 'admin', 'api',
  'search', 'feed', 'feeds', 'rss', 'atom', 'sitemap', 'tag', 'tags',
  'topic', 'topics', 'category', 'categories', 'archive', 'archives',
  'page', 'pages', 'about', 'links', 'friend', 'friends', 'comment',
  'comments', 'favorite', 'favorites', 'activity', 'activities',
  'user', 'users', 'member', 'members', 'assets', 'static', 'cdn',
]);

export function sitemapArticleDate(xml) {
  const text = String(xml ?? '');
  const pairs = [];
  for (const m of text.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = m[1];
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1] || '';
    const lm = block.match(/<lastmod>\s*([^<]{8,40})\s*<\/lastmod>/i)?.[1];
    if (!loc || !lm) continue;
    const t = Date.parse(lm.trim());
    if (Number.isNaN(t) || t < MIN_DATE_TS) continue;
    pairs.push({ loc, t });
  }
  if (!pairs.length) return null;
  // 全体 lastmod 同值 = 生成器构建时间戳，不是内容信号
  if (new Set(pairs.map((p) => p.t)).size === 1) return null;
  // 排除：站点根路径、应用路由、生成器 bug 输出（loc 含 HTML 转义）
  const articles = pairs.filter((p) => {
    if (p.loc.includes('&lt;') || p.loc.includes('<')) return false;
    let path = '';
    try {
      path = new URL(p.loc).pathname;
    } catch {
      return false;
    }
    path = path.replace(/\/+$/, '');
    if (path === '') return false; // 站点根
    const firstSeg = path.split('/')[1]?.toLowerCase() || '';
    if (SITEMAP_META_SEGMENTS.has(firstSeg)) return false;
    return true;
  });
  const pool = articles.length ? articles : pairs.filter((p) => !p.loc.endsWith('/sitemap.xml'));
  if (!pool.length) return null;
  return new Date(Math.max(...pool.map((p) => p.t))).toISOString();
}
