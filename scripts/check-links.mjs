import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadBlogs, probe, runPool, hostOf, withScheme, writeJson } from './lib.mjs';

const results = {};
const inPath = process.argv[2];
let urls;

if (inPath) {
  urls = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  console.log(`checking ${urls.length} urls from ${inPath}`);
} else {
  const prev = fs.existsSync(path.join(DATA_DIR, 'check-results.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'check-results.json'), 'utf8'))
    : {};
  Object.assign(results, prev); // keep old results for urls we skip? no — we re-check all below
  const blogs = loadBlogs();
  urls = [...new Set(blogs.map((b) => b.url.replace(/\/+$/, '')).filter(Boolean))];
  console.log(`checking ${urls.length} unique blog urls`);
}

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
    onProgress: (done, total) =>
      console.log(
        `progress ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s) - ${Object.values(results).filter((x) => x.ok).length} ok`
      ),
  }
);

t0 = Date.now();
writeJson(path.join(DATA_DIR, 'check-results.json'), results);
const ok = Object.values(results).filter((x) => x.ok).length;
console.log(`DONE ok=${ok} fail=${Object.keys(results).length - ok} in ${t0 - 0}ms`);
