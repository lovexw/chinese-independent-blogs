import fs from 'node:fs';
import path from 'node:path';
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

// usage: node scripts/rss-refresh.mjs [--fix-missing] [--fresh]
// Resumable: progress flushes to data/lastupdate.partial.json every 50 blogs;
// re-run the same command after an interruption to continue where it stopped.
const FIX_MISSING = process.argv.includes('--fix-missing');
const FRESH = process.argv.includes('--fresh');

const outPath = path.join(DATA_DIR, 'lastupdate.json');
const PARTIAL = path.join(DATA_DIR, 'lastupdate.partial.json');
const prev = readJson(outPath, {});
const done = FRESH ? {} : readJson(PARTIAL, {}); // keys completed in an interrupted run
if (Object.keys(done).length) console.log(`resuming: ${Object.keys(done).length} blogs already refreshed`);
if (FRESH && fs.existsSync(PARTIAL)) fs.unlinkSync(PARTIAL);

const results = { ...prev, ...done }; // working copy; each processed blog overwrites its key
const blogs = loadBlogs().filter((b) => !(hostKey(b.url) in done));
console.log(`refreshing rss info for ${blogs.length} blogs (fixMissing=${FIX_MISSING})`);

function extractDates(xml) {
  const text = xml.toString('utf8');
  const dates = [];
  const re = /<(?:pubDate|published|updated|lastBuildDate|dc:date)>([^<]{10,60})<\/|datetime="([^"]{10,60})"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || m[2] || '').trim();
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) dates.push(t);
  }
  return dates;
}

let t0 = Date.now();
let fixedRss = 0;

await runPool(
  blogs,
  20,
  async (blog) => {
    const key = hostKey(blog.url);
    const candidates = [];
    if (blog.rss) candidates.push(blog.rss);
    const tried = new Set();
    let found = null; // { rss, lastUpdate }

    for (const rss of candidates) {
      if (tried.has(rss)) continue;
      tried.add(rss);
      const r = await probe(rss, { timeout: 18000, wantBody: true, maxBody: 400000 });
      if (!r.error && r.status < 400 && isFeedBody(r.contentType, r.body)) {
        const dates = extractDates(r.body);
        found = {
          rss,
          lastUpdate: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
        };
        break;
      }
    }

    // missing or broken rss: try to discover (homepage autodiscovery + common paths)
    if (!found && (FIX_MISSING || !blog.rss)) {
      if (blog.rss) fixedRss++;
      // 1) homepage HTML autodiscovery
      const home = await probe(blog.url, { timeout: 15000, wantBody: true, maxBody: 200000 });
      if (!home.error && home.status < 400 && home.body) {
        const html = home.body.toString('utf8');
        const linkRe =
          /<link[^>]+rel=["']alternate["'][^>]*>/gi;
        let m;
        const discovered = [];
        while ((m = linkRe.exec(html)) !== null && discovered.length < 3) {
          const tag = m[0];
          if (!/type=["'][^"']*(rss|atom|feed\+json)/i.test(tag)) continue;
          const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
          if (href) {
            try {
              discovered.push(new URL(href, home.finalUrl || blog.url).toString());
            } catch {}
          }
        }
        for (const d of discovered) {
          if (tried.has(d)) continue;
          tried.add(d);
          const r = await probe(d, { timeout: 15000, wantBody: true, maxBody: 300000 });
          if (!r.error && r.status < 400 && isFeedBody(r.contentType, r.body)) {
            const dates = extractDates(r.body);
            found = {
              rss: d,
              lastUpdate: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
              discovered: true,
            };
            break;
          }
        }
      }
      // 2) common feed paths
      if (!found) {
        for (const p of feedVariants(blog.url)) {
          if (tried.has(p)) continue;
          tried.add(p);
          const r = await probe(p, { timeout: 12000, wantBody: true, maxBody: 300000 });
          if (!r.error && r.status < 400 && isFeedBody(r.contentType, r.body)) {
            const dates = extractDates(r.body);
            found = {
              rss: p,
              lastUpdate: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
              discovered: true,
            };
            break;
          }
        }
      }
    }

    if (found) {
      results[key] = {
        rss: found.rss,
        lastUpdate: found.lastUpdate,
        discovered: !!found.discovered,
        checkedAt: new Date().toISOString(),
      };
    } else {
      // feed temporarily unreachable: keep any previously known rss and date
      // (a week-old date is fine to display; re-derive it when the feed responds again)
      results[key] = {
        rss: prev[key]?.rss || '',
        lastUpdate: prev[key]?.lastUpdate || null,
        checkedAt: new Date().toISOString(),
      };
    }
    return !!found;
  },
  {
    onProgress: (n, total) => {
      if (n % 50 === 0) {
        writeJson(PARTIAL, results); // checkpoint: safe to kill at any time
        console.log(
          `progress ${n}/${total} (${Math.round((Date.now() - t0) / 1000)}s) - ${Object.values(results).filter((x) => x.lastUpdate).length} with dates`
        );
      }
    },
  }
);

writeJson(outPath, results);
try { fs.unlinkSync(PARTIAL); } catch {}
const withDates = Object.values(results).filter((x) => x.lastUpdate).length;
console.log(`DONE feeds=${Object.keys(results).length} withDates=${withDates} brokenRssRetried=${fixedRss}`);
