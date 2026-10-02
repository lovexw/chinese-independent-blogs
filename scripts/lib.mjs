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
