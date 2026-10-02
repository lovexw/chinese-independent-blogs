import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DATA_DIR,
  ROOT,
  loadBlogs,
  saveBlogs,
  probe,
  runPool,
  hostKey,
  hostOf,
  rootOf,
  feedVariants,
  isFeedBody,
  resolveHost,
  readJson,
  writeJson,
} from './lib.mjs';

const execFileP = promisify(execFile);

// Deep review of suspicious blogs (output of flag-suspicious.mjs).
// Gathers stronger signals per blog and emits a decision:
//   keep    — clearly alive as a blog / personal page
//   update  — moved: original URL redirects to the author's new blog / profile page
//   delete  — parked / hijacked / empty-nothing / confirmed dead
// Run:  node scripts/deep-review.mjs            (gather decisions -> data/deep-review.json)
//       node scripts/deep-review.mjs --apply    (apply decisions to blogs-original.csv)
// Resumable: checkpoint at data/deep-review.partial.json; --fresh to redo.

const APPLY = process.argv.includes('--apply');
const FRESH = process.argv.includes('--fresh');
const PARTIAL = path.join(DATA_DIR, 'deep-review.partial.json');
const FINAL = path.join(DATA_DIR, 'deep-review.json');

const sus = readJson(path.join(DATA_DIR, 'suspicious.json'), { blogs: [] });
const blogs = loadBlogs();
const byUrl = new Map(blogs.map((b) => [b.url.replace(/\/+$/, ''), b]));

const done = FRESH ? {} : readJson(PARTIAL, {}); // hostKey -> decision
const FRESHLY_DONE = new Set();
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// ---------- content classification ----------

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPAM_RE =
  /(棋牌|博彩|娱乐城|新利|澳门|威尼斯人|成人|情色|国产精品|viagra|casino|poker|porn|外链|代刷|刷单|采集站|网赚|make \$\d)/i;
const PARKED_STRICT_RE =
  /(此域名可转让|域名出售|域名停放|正在出售|购买该域名|this domain is for sale|buy this domain|domain may be for sale|sedo\.com|afternic|hugedomains|parked free,)/i;
const SPA_RE =
  /(__NEXT_DATA__|window\.__NUXT__|id=["']root["']|id=["']app["']|id=["']q-app["']|astro-island|wp-content|hexo|html\s+class=["'][^"']*route)/i;
const GENERATOR_RE =
  /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i;
const BLOG_WORDS = /(博客|blog|随笔|日志|记|notes|journal|'s|’s)/i;

function classifyPage(html, finalUrl, origName) {
  const why = [];
  let score = 0;
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
  const text = visibleText(html);
  const lower = html.toLowerCase();

  if (PARKED_STRICT_RE.test(lower)) return { kind: 'parked', score: -10, title, why: ['域名停放/出售页'] };
  if (SPAM_RE.test(title)) return { kind: 'spam', score: -10, title, why: [`标题疑似垃圾站: ${title.slice(0, 40)}`] };

  const gen = html.match(GENERATOR_RE)?.[1];
  if (gen) { score += 3; why.push(`generator=${gen.slice(0, 30)}`); }
  if (/<link[^>]+rel=["']alternate["'][^>]*type=["'][^"']*(rss|atom)/i.test(lower)) { score += 3; why.push('有RSS声明'); }
  if ((lower.match(/<article[\s>]/g) || []).length > 0) { score += 2; why.push('article标签'); }
  if (/\/20\d\d\/|\/posts?\/|\/archives|\/articles|\/p\//i.test(lower)) { score += 2; why.push('文章路径'); }
  if (/(归档|关于|分类|标签|archives|about|categories|tags)/i.test(lower.slice(0, 20000))) { score += 2; why.push('博客导航'); }
  if (text.length > 500) { score += 1; why.push(`正文${text.length}字`); }
  if (title && BLOG_WORDS.test(title)) { score += 1; why.push(`标题像博客: ${title.slice(0, 40)}`); }
  if (origName) {
    // author name appearing on the target page is a strong ownership signal
    const key = origName.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 6);
    if (key.length >= 2 && (lower.includes(key) || title.includes(origName.slice(0, 6)))) {
      score += 3; why.push(`提及原作者名“${origName.slice(0, 10)}”`);
    }
  }
  const platHost = rootOf(finalUrl || '');
  if (/(csdn\.net|zhihu\.com|juejin\.cn|medium\.com|jianshu\.com|cnblogs\.com|51cto\.com|segmentfault\.com|blogspot\.com|wordpress\.com|tumblr\.com|x\.com|twitter\.com|weixin\.qq\.com|sspai\.com|yuque\.com|notion\.site|substack\.com|github\.io|vercel\.app|netlify\.app|pages\.dev)$/.test(platHost)) {
    score += 3; why.push('平台/托管页');
  }
  if (SPAM_RE.test(lower) && text.length < 800) { score -= 5; why.push('含垃圾关键词'); }
  if (text.length < 100 && score < 3) return { kind: 'thin', score, title, why };

  if (score >= 3) return { kind: 'blog', score, title, why };
  return { kind: 'unknown', score, title, why };
}

// ---------- signal helpers ----------

async function tryFeeds(candidates, limit = 5) {
  const tried = new Set();
  for (const feed of candidates) {
    if (!feed || tried.has(feed) || tried.size >= limit) continue;
    tried.add(feed);
    const r = await probe(feed, { timeout: 15000, wantBody: true, maxBody: 300000 });
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

async function discoverFeed(siteUrl, html, finalUrl) {
  const cands = [];
  if (html) {
    const linkRe = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null && cands.length < 3) {
      if (!/type=["'][^"']*(rss|atom|feed\+json)/i.test(m[0])) continue;
      const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (href) {
        try { cands.push(new URL(href, finalUrl || siteUrl).toString()); } catch {}
      }
    }
  }
  for (const p of feedVariants(siteUrl)) cands.push(p);
  return tryFeeds(cands);
}

async function waybackTs(url) {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    const ts = j?.archived_snapshots?.closest?.timestamp;
    return ts ? ts : null; // YYYYMMDDhhmmss
  } catch {
    return null;
  }
}

const waybackAgeDays = (ts) => (ts ? Math.floor((Date.now() - Date.parse(`${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`)) / 86400e3) : Infinity);

async function curlK(url) {
  const tmp = `/tmp/curlk-${Math.random().toString(36).slice(2)}.out`;
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-k', '-s', '-L', '--max-time', '15', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', '-o', tmp, '-w', '%{http_code} %{url_effective}', url],
      { timeout: 20000 }
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

const months = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86400e3 / 30 : Infinity);

// ---------- gather decisions ----------

if (!APPLY) {
  console.log(`deep review: ${sus.blogs.length} suspicious blogs`);
  let t0 = Date.now();
  await runPool(
    sus.blogs,
    12,
    async (entry) => {
      const key = hostKey(entry.url);
      if (done[key]) return; // resumed
      const blog = byUrl.get(entry.url.replace(/\/+$/, '')) || { name: entry.name, url: entry.url, rss: '' };
      const flags = entry.flags;
      const d = { name: blog.name || entry.name, url: entry.url, flags, action: 'keep', reason: '', newUrl: null, rss: null, lastUpdate: null, why: [] };

      const home = await probe(entry.url, { timeout: 25000, wantBody: true, maxBody: 400000 });
      const finalUrl = home.finalUrl || entry.url;
      const crossDomain = rootOf(finalUrl) !== rootOf(entry.url);

      // --- site gone entirely ---
      if (home.error && /ENOTFOUND|ECONNREFUSED/.test(home.error)) {
        const dnsOk = await resolveHost(hostOf(entry.url));
        if (!dnsOk) {
          d.action = 'delete';
          d.reason = '域名已失效（DNS 不存在）';
          done[key] = d;
          return d;
        }
      }

      // --- redirect cases: judge the target page ---
      if (crossDomain && (flags.includes('redirect') || flags.includes('jsRedirect'))) {
        let cls = null;
        let html = home.body?.toString('utf8') || '';
        if (!home.error && home.status < 400 && html) {
          cls = classifyPage(html, finalUrl, blog.name);
        } else {
          // blocked at target? try curl -k as fallback (some CDNs choke node fetch)
          const ck = await curlK(finalUrl);
          if (ck.code >= 200 && ck.code < 400 && ck.body) {
            cls = classifyPage(ck.body.toString('utf8'), ck.finalUrl, blog.name);
          }
        }
        if (cls && (cls.kind === 'blog' || (cls.kind === 'thin' && cls.score >= 1))) {
          d.action = 'update';
          d.newUrl = finalUrl;
          d.reason = `原域名跳转到博主新地址，目标页判定为博客/个人页（${cls.why.slice(0, 3).join(', ')}）`;
        } else if (cls && cls.kind === 'parked') {
          d.action = 'delete';
          d.reason = '原域名已易主，跳转到域名停放/出售页';
        } else if (cls && cls.kind === 'spam') {
          d.action = 'delete';
          d.reason = '原域名已易主，跳转到垃圾/无关站点';
        } else {
          // unknown target: check wayback for the ORIGINAL site's fate
          const ts = await waybackTs(entry.url);
          d.why.push(`目标页无法判定(${cls ? cls.kind + ':' + cls.score : 'no-body'})，wayback ${waybackAgeDays(ts) === Infinity ? '无快照' : Math.round(waybackAgeDays(ts)) + '天前'}`);
          if (ts && waybackAgeDays(ts) < 500) {
            d.action = 'keep';
            d.reason = '跳转目标无法自动判定，但原站近期有存档快照，保留待人工确认';
          } else {
            d.action = 'delete';
            d.reason = '原域名跳转到无法确认相关性的站点，且无近期存档';
          }
        }
        // try to carry the RSS over to the new location
        const feed = await discoverFeed(d.action === 'update' ? finalUrl : entry.url, home.body?.toString('utf8'), finalUrl);
        if (d.action === 'update' && feed) { d.rss = feed.rss; d.lastUpdate = feed.lastUpdate; }
        done[key] = d;
        return d;
      }

      // --- parked claims: confirm strictly on fresh content ---
      if (flags.includes('parked')) {
        const html = home.body?.toString('utf8') || '';
        if (!home.error && home.status < 400 && html) {
          const cls = classifyPage(html, finalUrl, blog.name);
          if (cls.kind === 'parked') {
            d.action = 'delete';
            d.reason = '页面为域名停放/出售页';
            done[key] = d;
            return d;
          }
          if (cls.kind === 'blog') {
            d.why.push('停放关键词误报，页面像正常博客');
            d.reason = `复核为正常博客（${cls.why.slice(0, 3).join(', ')}）`;
            done[key] = d;
            return d;
          }
          d.why.push(`停放复核结果不明确(${cls.kind}:${cls.score})`);
        }
      }

      // --- bot-wall cases: find any proof of life ---
      if (flags.includes('botWall') || (home.error && /timeout|ECONNRESET/i.test(home.error || '')) || (home.status >= 400 && ![404, 410].includes(home.status))) {
        // 1) rss feeds are usually not bot-walled
        const feed = await tryFeeds([blog.rss, ...feedVariants(finalUrl)].filter(Boolean));
        if (feed && (!feed.lastUpdate || months(feed.lastUpdate) < 24)) {
          d.action = 'keep';
          d.reason = `被反爬拦截，但 RSS 存活${feed.lastUpdate ? `（最近更新 ${feed.lastUpdate.slice(0, 10)}）` : ''}`;
          d.rss = feed.rss;
          d.lastUpdate = feed.lastUpdate;
          done[key] = d;
          return d;
        }
        // 2) googlebot often bypasses human checks
        const gb = await probe(entry.url, { timeout: 20000, headers: { 'User-Agent': GOOGLEBOT_UA } });
        if (!gb.error && gb.status < 400) {
          d.action = 'keep';
          d.reason = '被反爬拦截，但 Googlebot UA 可正常访问（站点存活）';
          done[key] = d;
          return d;
        }
        // 3) wayback recency
        const ts = await waybackTs(entry.url);
        d.why.push(`googlebot=${gb.status || gb.error}, wayback ${ts ? Math.round(waybackAgeDays(ts)) + '天前' : '无快照'}`);
        if (ts && waybackAgeDays(ts) < 500) {
          d.action = 'keep';
          d.reason = '被反爬拦截无法直检，但近期有存档快照，保留';
        } else {
          d.action = 'delete';
          d.reason = '反爬拦截且 RSS 失效、无近期存档，判定失联';
        }
        done[key] = d;
        return d;
      }

      // --- empty page cases ---
      if (flags.includes('empty')) {
        const html = home.body?.toString('utf8') || '';
        const feed = await discoverFeed(finalUrl, html, finalUrl);
        if (feed) {
          d.action = 'keep';
          d.reason = `页面可见文字少（可能为客户端渲染），但 RSS 存活${feed.lastUpdate ? `（${feed.lastUpdate.slice(0, 10)}）` : ''}`;
          d.rss = feed.rss;
          d.lastUpdate = feed.lastUpdate;
          done[key] = d;
          return d;
        }
        const isSPA = SPA_RE.test(html) && !!html.match(/<title[^>]*>[^<]{2,}<\/title>/i);
        const ts = await waybackTs(entry.url);
        if (isSPA) {
          d.action = 'keep';
          d.why.push('检测到前端框架特征（客户端渲染）');
          d.reason = '页面为客户端渲染的 SPA，非空站（RSS 未发现）';
          done[key] = d;
          return d;
        }
        if (ts && waybackAgeDays(ts) < 500) {
          d.action = 'keep';
          d.reason = '页面内容极少但近期有存档快照，保留待人工确认';
          done[key] = d;
          return d;
        }
        d.action = 'delete';
        d.reason = `页面近乎空内容且无 RSS、无近期存档${d.why.length ? '（' + d.why.join('; ') + '）' : ''}`;
        done[key] = d;
        return d;
      }

      // --- tls-insecure / everything else: did the page load & look like a blog? ---
      if (flags.includes('tlsInsecure')) {
        const ck = await curlK(entry.url);
        if (ck.code >= 200 && ck.code < 400 && ck.body) {
          const cls = classifyPage(ck.body.toString('utf8'), ck.finalUrl, blog.name);
          if (cls.kind === 'blog') {
            d.action = 'keep';
            d.reason = `证书异常但站点存活且为博客（忽略证书后可访问，${cls.why.slice(0, 2).join(', ')}）`;
            done[key] = d;
            return d;
          }
          d.why.push(`忽略证书后判定为 ${cls.kind}`);
        } else {
          d.why.push(`忽略证书后仍无法访问(${ck.code})`);
        }
      }

      // --- generic fallback: classify what we got this round ---
      if (!home.error && home.status < 400 && home.body) {
        const cls = classifyPage(home.body.toString('utf8'), finalUrl, blog.name);
        if (cls.kind === 'blog') {
          d.reason = `复核为正常博客（${cls.why.slice(0, 3).join(', ')}）`;
        } else if (cls.kind === 'parked') {
          d.action = 'delete';
          d.reason = '页面为域名停放/出售页';
        } else if (cls.kind === 'spam') {
          d.action = 'delete';
          d.reason = '页面为垃圾/无关站点';
        } else {
          const ts = await waybackTs(entry.url);
          if (ts && waybackAgeDays(ts) < 500) {
            d.reason = `内容特征弱(${cls.kind}:${cls.score})但近期有存档，保留待人工确认`;
          } else {
            d.action = 'delete';
            d.reason = `内容特征弱且无近期存档(${cls.kind}:${cls.score})`;
          }
        }
      } else {
        // still failing this round
        const ts = await waybackTs(entry.url);
        if (ts && waybackAgeDays(ts) < 500) {
          d.reason = `本轮访问失败(${home.error || home.status})但近期有存档，保留`;
        } else {
          d.action = 'delete';
          d.reason = `本轮访问失败且无近期存档(${home.error || home.status})`;
        }
      }
      done[key] = d;
      return d;
    },
    {
      onProgress: (n, total) => {
        if (n % 20 === 0) {
          writeJson(PARTIAL, done);
          const acts = Object.values(done);
          console.log(
            `progress ${n}/${total} (${Math.round((Date.now() - t0) / 1000)}s) keep=${acts.filter((x) => x.action === 'keep').length} update=${acts.filter((x) => x.action === 'update').length} delete=${acts.filter((x) => x.action === 'delete').length}`
          );
        }
      },
    }
  );

  // ---- write final decisions (sorted: delete, update, keep) ----
  const order = { delete: 0, update: 1, keep: 2 };
  const decisions = Object.values(done).sort((a, b) => order[a.action] - order[b.action]);
  writeJson(FINAL, { generatedAt: new Date().toISOString(), decisions });
  try { fs.unlinkSync(PARTIAL); } catch {}
  const cnt = { keep: 0, update: 0, delete: 0 };
  for (const x of decisions) cnt[x.action]++;
  console.log(`DEEP REVIEW DONE keep=${cnt.keep} update=${cnt.update} delete=${cnt.delete}`);
  process.exit(0);
}

// ---------- apply mode ----------

const final = readJson(FINAL, { decisions: [] });
let cur = loadBlogs();
const offline = readJson(path.join(DATA_DIR, 'offline.json'), []);
const lastupdate = readJson(path.join(DATA_DIR, 'lastupdate.json'), {});
let nDel = 0, nUpd = 0;

const offlineUrls = new Set(offline.map((o) => o.url.replace(/\/+$/, '')));
const next = [];
for (const b of cur) {
  const dec = final.decisions.find((x) => hostKey(x.url) === hostKey(b.url) && x.action !== 'keep');
  if (dec && dec.action === 'delete' && !offlineUrls.has(b.url.replace(/\/+$/, ''))) {
    offline.push({
      name: b.name, url: b.url, rss: b.rss, tags: b.tags,
      reason: `深度复核：${dec.reason}`,
      removedAt: new Date().toISOString().slice(0, 10),
    });
    delete lastupdate[hostKey(b.url)];
    nDel++;
    continue;
  }
  if (dec && dec.action === 'update' && dec.newUrl) {
    console.log(`UPDATE ${b.url} -> ${dec.newUrl}${dec.rss ? ' (rss: ' + dec.rss + ')' : ''}`);
    b.url = dec.newUrl;
    if (dec.rss) b.rss = dec.rss;
    if (dec.lastUpdate) {
      delete lastupdate[hostKey(dec.url)];
      lastupdate[hostKey(b.url)] = { rss: b.rss, lastUpdate: dec.lastUpdate, checkedAt: new Date().toISOString() };
    }
    nUpd++;
  }
  next.push(b);
}

// pin stays first (build.mjs re-pins, but keep csv sane too)
saveBlogs(next);
writeJson(path.join(DATA_DIR, 'offline.json'), offline);
writeJson(path.join(DATA_DIR, 'lastupdate.json'), lastupdate);
console.log(`APPLY DONE deleted=${nDel} updated=${nUpd} (blogs ${cur.length} -> ${next.length})`);
