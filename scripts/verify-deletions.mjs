import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DATA_DIR,
  loadBlogs,
  probe,
  runPool,
  hostKey,
  hostOf,
  feedVariants,
  isFeedBody,
  readJson,
  writeJson,
} from './lib.mjs';

const execFileP = promisify(execFile);

// Re-verify unreliable delete decisions from deep-review.mjs.
// The first run's wayback checks were rate-limited (429 -> treated as "no snapshot"),
// which poisoned the "empty"/"botWall"/"failed" deletion buckets. This pass re-checks
// every delete whose reason is NOT a positively-identified parked/spam/hijack page,
// with patient wayback retries, googlebot WITH body, richer RSS discovery and curl -k.
// Output: data/deep-review.json is rewritten with corrected actions + data/deep-review-corrections.md

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const deep = readJson(path.join(DATA_DIR, 'deep-review.json'), { decisions: [] });
const blogs = loadBlogs();
const byUrl = new Map(blogs.map((b) => [b.url.replace(/\/+$/, ''), b]));

// domain-hijack overrides: these "update" decisions point to proven unrelated sites
const HIJACKS = new Set([
  'xiaix.me', 'xiaozhu.dev', 'tingfei.space', 'lorde627.xyz', 'megamu.icu',
  'hfdavidyu.com', 'scvoet.me',
]);

const UNRELIABLE = (r) =>
  !r.startsWith('复核确认存活') &&   // confirmed alive in a previous pass
  !r.startsWith('域名被抢注') &&     // manually confirmed hijacks
  !r.startsWith('原域名已易主');     // positively verified sedo.com parking (liqiang.io)

// ---------- content classification (same heuristics as deep-review) ----------
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const SPAM_RE = /(棋牌|博彩|娱乐城|澳门|成人|情色|viagra|casino|poker|porn|代刷|刷单|网赚|gacor|judi|slot|casino|bonga|kenyamanan)/i;
const PARKED_STRICT_RE =
  /(此域名可转让|域名出售|域名停放|正在出售|购买该域名|this domain is for sale|buy this domain|domain may be for sale|sedo\.com|afternic|hugedomains|parked free,)/i;
const SPA_RE = /(__NEXT_DATA__|window\.__NUXT__|id=["']root["']|id=["']app["']|id=["']q-app["']|astro-island|wp-content|hexo)/i;
const GENERATOR_RE = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i;
const BLOG_WORDS = /(博客|blog|随笔|日志|notes|journal|'s|’s)/i;

function classifyPage(html, origName) {
  const why = [];
  let score = 0;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  const text = visibleText(html);
  const lower = html.toLowerCase();
  // parked verdict requires the keyword in the title or a very thin page —
  // blog posts merely *mentioning* domain trading must not be killed
  const parkedMatch = lower.match(PARKED_STRICT_RE);
  if (parkedMatch) {
    const kw = parkedMatch[0];
    if (title.toLowerCase().includes(kw) || text.length < 1200)
      return { kind: 'parked', title, why: [`停放/出售页(关键词:${kw})`] };
    why.push(`提及“${kw}”但内容丰富`);
  }
  if (SPAM_RE.test(title)) return { kind: 'spam', title, why: [`标题疑似垃圾站: ${title.slice(0, 40)}`] };
  const gen = html.match(GENERATOR_RE)?.[1];
  if (gen) { score += 3; why.push(`generator=${gen.slice(0, 28)}`); }
  if (/<link[^>]+rel=["']alternate["'][^>]*type=["'][^"']*(rss|atom)/i.test(lower)) { score += 3; why.push('RSS声明'); }
  if (/<article[\s>]/i.test(lower)) { score += 2; why.push('article标签'); }
  if (/\/20\d\d\/|\/posts?\/|\/archives|\/p\//i.test(lower)) { score += 2; why.push('文章路径'); }
  if (/(归档|关于|分类|标签|archives|about)/i.test(lower.slice(0, 20000))) { score += 2; why.push('博客导航'); }
  if (text.length > 500) { score += 1; why.push(`正文${text.length}字`); }
  if (title && BLOG_WORDS.test(title)) { score += 1; why.push(`标题: ${title.slice(0, 36)}`); }
  if (origName) {
    const key = origName.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 6);
    if (key.length >= 2 && (lower.includes(key) || title.includes(origName.slice(0, 6)))) { score += 3; why.push('提及原作者名'); }
  }
  if (text.length < 100 && score < 3) return { kind: 'thin', title, why };
  if (score >= 3) return { kind: 'blog', title, why };
  return { kind: 'unknown', title, why };
}

// ---------- patient wayback (rate-limit aware) ----------
let waybackBusy = 0;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
async function waybackAgeDays(url) {
  // returns days since closest snapshot, or Infinity when none, or null when unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    while (waybackBusy >= 2) await sleep(400);
    waybackBusy++;
    try {
      const res = await fetch(
        `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
        { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'cnblog-list-audit/1.0' } }
      );
      waybackBusy--;
      if (res.status === 429) {
        await sleep(3000 * (attempt + 1) * (attempt + 1));
        continue;
      }
      const j = await res.json().catch(() => null);
      const ts = j?.archived_snapshots?.closest?.timestamp;
      if (!ts) return Infinity;
      return Math.floor((Date.now() - Date.parse(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`)) / 86400e3);
    } catch {
      waybackBusy--;
      await sleep(2000 * (attempt + 1));
    }
  }
  return null; // unknown (still rate-limited after retries)
}

async function curlK(url) {
  const tmp = `/tmp/curlk2-${Math.random().toString(36).slice(2)}.out`;
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-k', '-s', '-L', '--max-time', '18', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', '-o', tmp, '-w', '%{http_code} %{url_effective}', url],
      { timeout: 25000 }
    );
    const [code, finalUrl] = stdout.trim().split(' ');
    const body = fs.existsSync(tmp) ? fs.readFileSync(tmp) : null;
    return { code: parseInt(code, 10), finalUrl, body };
  } catch {
    return { code: 0, finalUrl: url, body: null };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function tryFeeds(cands) {
  const tried = new Set();
  for (const feed of cands.filter(Boolean)) {
    if (tried.has(feed) || tried.size >= 8) continue;
    tried.add(feed);
    const r = await probe(feed, { timeout: 18000, wantBody: true, maxBody: 300000 });
    if (!r.error && r.status < 400 && isFeedBody(r.contentType, r.body)) {
      const text = r.body.toString('utf8');
      const dates = [];
      const re = /<(?:pubDate|published|updated|lastBuildDate|dc:date)>([^<]{10,60})</g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const t = Date.parse(m[1].trim());
        if (!Number.isNaN(t)) dates.push(t);
      }
      return { rss: feed, lastUpdate: dates.length ? new Date(Math.max(...dates)).toISOString() : null };
    }
  }
  return null;
}

// ---------- main ----------
const toVerify = [];
for (const d of deep.decisions) {
  if (HIJACKS.has(hostKey(d.url).replace(/^www\./, '')) || HIJACKS.has(hostKey(d.url))) {
    d.action = 'delete';
    d.reason = '域名被抢注，跳转到无关第三方站点（翻墙SEO站/博彩站）';
    d.verified = 'hijack';
  } else if (d.action === 'delete' && UNRELIABLE(d.reason)) {
    toVerify.push(d);
  }
}
console.log(`re-verifying ${toVerify.length} unreliable delete decisions`);

let t0 = Date.now();
const results = await runPool(
  toVerify,
  8,
  async (d) => {
    const blog = byUrl.get(d.url.replace(/\/+$/, '')) || {};
    const evidence = [];

    // 1. normal fetch
    let cls = null;
    let r = await probe(d.url, { timeout: 25000, wantBody: true, maxBody: 400000 });
    if (!r.error && r.status < 400 && r.body) {
      cls = classifyPage(r.body.toString('utf8'), blog.name);
      evidence.push(`fetch:${cls.kind}`);
    } else {
      evidence.push(`fetch:${r.status || r.error?.slice(0, 30)}`);
    }

    // 2. googlebot with body
    if (!cls || (cls.kind !== 'blog' && cls.kind !== 'parked')) {
      const gb = await probe(d.url, { timeout: 22000, wantBody: true, maxBody: 300000, headers: { 'User-Agent': GOOGLEBOT_UA } });
      if (!gb.error && gb.status < 400 && gb.body) {
        const gcls = classifyPage(gb.body.toString('utf8'), blog.name);
        evidence.push(`googlebot:${gcls.kind}`);
        if (!cls || cls.kind === 'thin' || cls.kind === 'unknown') cls = gcls;
      } else {
        evidence.push(`googlebot:${gb.status || gb.error?.slice(0, 30)}`);
      }
    }

    // 3. curl -k
    if (!cls || (cls.kind !== 'blog' && cls.kind !== 'parked')) {
      const ck = await curlK(d.url);
      if (ck.code >= 200 && ck.code < 400 && ck.body) {
        const ccls = classifyPage(ck.body.toString('utf8'), ck.finalUrl, blog.name);
        evidence.push(`curlk:${ccls.kind}`);
        if (!cls || cls.kind === 'thin' || cls.kind === 'unknown') cls = ccls;
      } else {
        evidence.push(`curlk:${ck.code}`);
      }
    }

    // 4. rss (rich candidates)
    const feed = await tryFeeds([blog.rss, ...feedVariants(d.url), ...feedVariants(r.finalUrl || '')]);
    if (feed) evidence.push(`rss:${feed.rss.slice(0, 50)}${feed.lastUpdate ? '@' + feed.lastUpdate.slice(0, 10) : ''}`);

    // 5. patient wayback
    const wb = await waybackAgeDays(d.url);
    evidence.push(`wayback:${wb === Infinity ? 'none' : wb === null ? 'unknown' : Math.round(wb) + 'd'}`);

    let verdict;
    if (cls && cls.kind === 'parked') verdict = { action: 'delete', reason: `复核确认：域名停放/出售页` };
    else if (cls && cls.kind === 'spam') verdict = { action: 'delete', reason: '复核确认：垃圾/无关站点' };
    else if (cls && cls.kind === 'blog') verdict = { action: 'keep', reason: `复核确认存活（${cls.why.slice(0, 3).join(', ')}）` };
    else if (feed) verdict = { action: 'keep', reason: `RSS 存活（${feed.rss}）` };
    else if (wb !== null && wb <= 500) verdict = { action: 'keep', reason: `无法直检但 ${Math.round(wb)} 天前有存档，保留待人工确认` };
    else if (wb === Infinity || (cls && cls.kind === 'parked')) verdict = { action: 'delete', reason: `多方式复核均无法确认存活${cls ? `（${cls.kind}）` : ''}，且无近期存档` };
    else verdict = { action: 'keep', reason: `信号不足（${evidence.slice(-2).join('; ')}），保守保留待人工确认` };

    d.action = verdict.action;
    d.reason = verdict.reason;
    d.verified = 'recheck';
    d.evidence = evidence;
    return verdict.action;
  },
  {
    onProgress: (n, total) => {
      if (n % 20 === 0) console.log(`recheck ${n}/${total} (${Math.round((Date.now() - t0) / 1000)}s)`);
    },
  }
);

writeJson(path.join(DATA_DIR, 'deep-review.json'), deep);
const cnt = { keep: 0, update: 0, delete: 0 };
for (const x of deep.decisions) cnt[x.action]++;
console.log(`RECHECK DONE keep=${cnt.keep} update=${cnt.update} delete=${cnt.delete}`);
console.log(`now-deleted list (review these):`);
for (const x of deep.decisions.filter((x) => x.action === 'delete'))
  console.log('  DELETE', x.url, '|', x.reason.slice(0, 44), '|', (x.evidence || []).join(' '));
