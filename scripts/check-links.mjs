import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadBlogs, probe, runPool, hostOf, withScheme, writeJson, readJson } from './lib.mjs';

// Resumable: progress is flushed to data/check-results.partial.json every 50 checks;
// if the run is interrupted, simply re-run the same command and it continues where it
// stopped. Use `node scripts/check-links.mjs --fresh` to ignore the checkpoint.

const PARTIAL = path.join(DATA_DIR, 'check-results.partial.json');
const FINAL = path.join(DATA_DIR, 'check-results.json');
const FRESH = process.argv.includes('--fresh');

const results = {};
if (!FRESH) {
  const partial = readJson(PARTIAL, null);
  if (partial) console.log(`resuming: ${Object.keys(partial).length} urls already checked`);
  Object.assign(results, partial || {});
} else if (fs.existsSync(PARTIAL)) {
  fs.unlinkSync(PARTIAL);
}

const inPath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
let urls;

if (inPath) {
  urls = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  console.log(`checking ${urls.length} urls from ${inPath}`);
} else {
  const blogs = loadBlogs();
  urls = [...new Set(blogs.map((b) => b.url.replace(/\/+$/, '')).filter(Boolean))];
  console.log(`checking ${urls.length} unique blog urls`);
}

urls = urls.filter((u) => !(u in results));
console.log(`${urls.length} urls left to check`);

let t0 = Date.now();
await runPool(
  urls,
  25,
  async (url) => {
    let r = await probe(url, { timeout: 15000 });
    // http-only sites that fail: retry once over https (very common fix)
    if ((r.error || r.status >= 400) && url.startsWith('http://')) {
      const r2 = await probe(withScheme(url, 'https:'), { timeout: 15000 });
      if (!r2.error && r2.status < 400) r = { ...r2, upgradedFrom: url };
    }
    // one more try on transient errors / 5xx
    if (r.error || r.status >= 500) {
      await new Promise((s) => setTimeout(s, 1200));
      const r3 = await probe(url, { timeout: 18000 });
      if (!r3.error && r3.status < 500) r = r3;
    }
    const ok = !r.error && r.status >= 200 && r.status < 400;
    results[url] = {
      ok,
      status: r.status,
      error: r.error,
      finalUrl: r.finalUrl === url ? undefined : r.finalUrl,
    };
    return ok;
  },
  {
    onProgress: (done, total) => {
      if (done % 50 === 0) {
        writeJson(PARTIAL, results); // checkpoint: safe to kill at any time
        console.log(
          `progress ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s) - ${Object.values(results).filter((x) => x.ok).length} ok`
        );
      }
    },
  }
);

writeJson(FINAL, results);
try { fs.unlinkSync(PARTIAL); } catch {}
const ok = Object.values(results).filter((x) => x.ok).length;
console.log(`DONE ok=${ok} fail=${Object.keys(results).length - ok} in ${Math.round((Date.now() - t0) / 1000)}s`);
