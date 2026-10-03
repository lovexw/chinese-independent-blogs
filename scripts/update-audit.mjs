import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DATA_DIR,
  loadBlogs,
  saveBlogs,
  probe,
  runPool,
  hostKey,
  hostOf,
  feedVariants,
  isFeedBody,
  readJson,
  writeJson,
} from './lib.mjs';

// update-audit: professionally re-evaluate "did this blog really update" for ALL blogs
// using 3 independent signals (beyond the possibly-stale listed RSS):
//   feed     — re-derived RSS (autodiscovery on the FINAL homepage URL + common paths),
//              fixes the "RSS 地址错位" problem where a moved blog keeps an old feed
//   home     — most recent post date visible on the homepage HTML
//   sitemap  — max <lastmod> from sitemap.xml / robots.txt-declared sitemaps
// lastUpdate = max(available signals), with the winning source recorded.
//
// usage:
//   node scripts/update-audit.mjs            gather -> data/update-audit.json
//   node scripts/update-audit.mjs --apply    write corrected dates/rss into lastupdate.json + CSV
//   flags: --fresh, --limit N

const APPLY = process.argv.includes('--apply');
const FRESH = process.argv.includes('--fresh');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : null;
})();
const PARTIAL = path.join(DATA_DIR, 'update-audit.partial.json');
const FINAL = path.join(DATA_DIR, 'update-audit.json');

const blogs = loadBlogs().slice(0, LIMIT || Infinity);
const prevLu = readJson(path.join(DATA_DIR, 'lastupdate.json'), {});
const done = FRESH ? {} : readJson(PARTIAL, {});

// ---------------- date extraction ----------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MIN_TS = Date.parse('2000-01-01');
const MAX_TS = Date.now() + 2 * 86400e3;

function pushDate(list, ts) {
  if (Number.isFinite(ts) && ts >= MIN_TS && ts <= MAX_TS) list.push(ts);
}

function extractHomeDates(html) {
  const dates = [];
  // machine-readable first
  for (const m of html.matchAll(/datetime=["']([^"']{8,40})["']/gi)) {
    const t = Date.parse(m[1]);
    if (!Number.isNaN(t)) pushDate(dates, t);
  }
  for (const m of html.matchAll(/datePublished["']?\s*[:=]\s*["']([^"']{8,40})["'/]/gi)) {
    const t = Date.parse(m[1]);
    if (!Number.isNaN(t)) pushDate(dates, t);
  }
  // ISO-ish: 2026-04-28 / 2026/04/28 / 2026.4.28
  for (const m of html.matchAll(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/g)) {
    pushDate(dates, Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`));
  }
  // Chinese: 2026年4月28日
  for (const m of html.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    pushDate(dates, Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`));
  }
  // English: April 28, 2026 / Apr 28, 2026 / 28 April 2026 / 28 Apr 2026
  const EN = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  for (const m of html.matchAll(new RegExp(`${EN}\\w*\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})`, 'gi'))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 4).replace('sept', 'sep').slice(0, 3)];
    if (mo) pushDate(dates, Date.parse(`${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`));
  }
  for (const m of html.matchAll(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${EN}\\w*,?\\s+(20\\d{2})`, 'gi'))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 4).replace('sept', 'sep').slice(0, 3)];
    if (mo) pushDate(dates, Date.parse(`${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`));
  }
  // NOTE: deliberately NO relative-date extraction ("3天前"/"3 days ago"/"今天"):
  // old posts quoting these words would poison the max-date heuristic toward
  // false-fresh, which is the worse error for a staleness audit.
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

// ---------------- sitemap ----------------

function maxLastmod(xml) {
  const dates = [];
  for (const m of xml.matchAll(/<lastmod>\s*([^<]{8,40})\s*<\/lastmod>/gi)) {
    const t = Date.parse(m[1].trim());
    if (!Number.isNaN(t)) dates.push(t);
  }
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

async function sitemapAudit(siteUrl) {
  const seen = new Set();
  let best = null;
  const fetchOne = async (u, depth) => {
    if (seen.has(u) || seen.size > 4) return;
    seen.add(u);
    const r = await probe(u, { timeout: 15000, wantBody: true, maxBody: 400000 });
    if (r.error || r.status >= 400 || !r.body) return;
    let body = r.body;
    if (u.endsWith('.gz')) {
      try { body = zlib.gunzipSync(body); } catch {}
    }
    const xml = body.toString('utf8');
    const lm = maxLastmod(xml);
    if (lm && (!best || Date.parse(lm) > Date.parse(best.date))) best = { date: lm, url: u };
    if (/<sitemapindex/i.test(xml) && depth < 2) {
      const children = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 2);
      for (const c of children) await fetchOne(c, depth + 1);
    }
  };
  // robots.txt first
  const rob = await probe(new URL('/robots.txt', siteUrl).toString(), { timeout: 12000, wantBody: true, maxBody: 20000 });
  if (!rob.error && rob.status < 400 && rob.body) {
    for (const m of rob.body.toString('utf8').matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      await fetchOne(m[1], 0);
      if (best) break;
    }
  }
  if (!best) {
    for (const p of ['sitemap.xml', 'sitemap_index.xml', 'sitemap.xml.gz']) {
      await fetchOne(new URL('/' + p, siteUrl).toString(), 0);
      if (best) break;
    }
  }
  return best;
}

// ---------------- feeds ----------------

async function tryFeeds(cands, limit = 6) {
  const tried = new Set();
  let best = null;
  for (const feed of cands.filter(Boolean)) {
    // comments feeds track comments, not posts — using them would fake freshness
    if (/comment|评论/i.test(feed)) continue;
    if (tried.has(feed) || tried.size >= limit) continue;
    tried.add(feed);
    const r = await probe(feed, { timeout: 18000, wantBody: true, maxBody: 400000 });
    if (r.error || r.status >= 400 || !isFeedBody(r.contentType, r.body)) continue;
    const text = r.body.toString('utf8');
    const dates = [];
    for (const m of text.matchAll(/<(?:pubDate|published|updated|dc:date)>([^<]{10,60})</g)) {
      const t = Date.parse(m[1].trim());
      if (!Number.isNaN(t)) dates.push(t);
    }
    const lastUpdate = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
    if (!best || (lastUpdate && (!best.lastUpdate || Date.parse(lastUpdate) > Date.parse(best.lastUpdate))))
      best = { rss: feed, lastUpdate };
  }
  return best;
}

function discoverFeeds(siteUrl, html) {
  const cands = [];
  if (html) {
    for (const m of html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)) {
      if (!/type=["'][^"']*(rss|atom|feed\+json)/i.test(m[0])) continue;
      const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (href && !/comment|评论/i.test(href)) {
        try { cands.push(new URL(href, siteUrl).toString()); } catch {}
      }
    }
  }
  cands.push(...feedVariants(siteUrl));
  return cands;
}

// ---------------- gather ----------------

if (!APPLY) {
  console.log(`update audit: ${blogs.length} blogs, signals: feed + homepage dates + sitemap lastmod`);
  let t0 = Date.now();
  await runPool(
    blogs,
    12,
    async (blog) => {
      const key = hostKey(blog.url);
      if (done[key]) return;
      const out = {
        name: blog.name,
        url: blog.url,
        listedRss: blog.rss,
        prevLastUpdate: prevLu[key]?.lastUpdate || null,
        signals: {},
      };

      // homepage (also gives us the FINAL url to re-derive feeds from)
      const home = await probe(blog.url, { timeout: 25000, wantBody: true, maxBody: 500000 });
      const finalUrl = home.finalUrl || blog.url;
      const html = home.body?.toString('utf8') || '';
      if (!home.error && home.status < 400 && html) {
        out.signals.home = { date: extractHomeDates(html), finalUrl };
      }

      // feeds: old listed rss first, then re-derived from the FINAL homepage url
      const feedCands = [blog.rss, ...discoverFeeds(finalUrl, html)];
      const feed = await tryFeeds(feedCands);
      if (feed) {
        out.signals.feed = { date: feed.lastUpdate, url: feed.rss, isListed: feed.rss === blog.rss };
      }

      // sitemap
      const sm = await sitemapAudit(finalUrl);
      if (sm) out.signals.sitemap = { date: sm.date, url: sm.url };

      // combine
      const cands = [];
      if (out.signals.feed?.date) cands.push({ date: out.signals.feed.date, src: 'feed' });
      if (out.signals.home?.date) cands.push({ date: out.signals.home.date, src: 'home' });
      if (out.signals.sitemap?.date) cands.push({ date: out.signals.sitemap.date, src: 'sitemap' });
      cands.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      out.lastUpdate = cands[0]?.date || null;
      out.source = cands[0]?.src || null;
      out.allSignals = cands;

      // rss correction suggestion: a working feed newer than the listed one, on the blog's own host
      out.suggestedRss = null;
      const oldDate = out.signals.feed?.isListed ? Date.parse(out.signals.feed.date || 0) : 0;
      if (feed && !feed.rss.startsWith(blog.rss) && hostOf(feed.rss) === hostOf(finalUrl)) {
        if (Date.parse(feed.lastUpdate || 0) > oldDate || !blog.rss) out.suggestedRss = feed.rss;
      }

      // did our view of "updated" change?
      const prev = out.prevLastUpdate ? Date.parse(out.prevLastUpdate) : 0;
      const nowV = out.lastUpdate ? Date.parse(out.lastUpdate) : 0;
      const TWO_Y = 2 * 365 * 86400e3;
      out.wasConsideredStale = !prev || Date.now() - prev >= TWO_Y;
      out.nowConsideredStale = !nowV || Date.now() - nowV >= TWO_Y;
      out.verdict =
        out.wasConsideredStale && !out.nowConsideredStale ? 'revived'
        : !out.wasConsideredStale && out.nowConsideredStale ? 'newly-stale'
        : Math.abs(nowV - prev) > 86400e3 ? 'date-shifted'
        : 'unchanged';

      done[key] = out;
      return out;
    },
    {
      onProgress: (n, total) => {
        if (n % 25 === 0) {
          writeJson(PARTIAL, done);
          const v = Object.values(done);
          console.log(
            `progress ${n}/${total} (${Math.round((Date.now() - t0) / 1000)}s) revived=${v.filter((x) => x.verdict === 'revived').length} newly-stale=${v.filter((x) => x.verdict === 'newly-stale').length} rss-fix=${v.filter((x) => x.suggestedRss).length}`
          );
        }
      },
    }
  );

  const decisions = Object.values(done);
  writeJson(FINAL, { generatedAt: new Date().toISOString(), decisions });
  try { fs.unlinkSync(PARTIAL); } catch {}
  const cnt = {};
  for (const x of decisions) cnt[x.verdict] = (cnt[x.verdict] || 0) + 1;
  console.log(`UPDATE AUDIT DONE:`, JSON.stringify(cnt), `| rss suggestions: ${decisions.filter((x) => x.suggestedRss).length}`);
  process.exit(0);
}

// ---------------- apply ----------------

const audit = readJson(FINAL, { decisions: [] });
let cur = loadBlogs();
const lu = readJson(path.join(DATA_DIR, 'lastupdate.json'), {});
let nDate = 0, nRss = 0, nKept = 0;
for (const b of cur) {
  const a = audit.decisions.find((x) => hostKey(x.url) === hostKey(b.url));
  if (!a) continue;
  const prevDate = lu[hostKey(b.url)]?.lastUpdate || null;
  if (a.lastUpdate && a.lastUpdate !== prevDate) {
    lu[hostKey(b.url)] = {
      rss: a.suggestedRss || b.rss || lu[hostKey(b.url)]?.rss || '',
      lastUpdate: a.lastUpdate,
      source: a.source,
      checkedAt: new Date().toISOString(),
    };
    nDate++;
  } else if (!a.lastUpdate && prevDate) {
    // transient probe failure this round: keep the previously confirmed date
    nKept++;
  }
  if (a.suggestedRss && a.suggestedRss !== b.rss) {
    b.rss = a.suggestedRss;
    nRss++;
  }
}
saveBlogs(cur);
writeJson(path.join(DATA_DIR, 'lastupdate.json'), lu);
console.log(`APPLY DONE: dates updated=${nDate}, rss corrected=${nRss}, transient-failure dates kept=${nKept}`);
