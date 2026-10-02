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
  hostVariants,
  feedVariants,
  isFeedBody,
  resolveHost,
  readJson,
  writeJson,
} from './lib.mjs';

const execFileP = promisify(execFile);

// statuses that mean "a server answered and refuses bots" -> the site is alive, keep it
const ALIVE_CODES = new Set([401, 402, 403, 406, 407, 416, 429, 456]);
// TLS problems where the server is up but the cert is broken -> verify with curl -k
const TLS_ERRORS = new Set([
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_SSL_TLSV1_UNRECOGNIZED_NAME',
  'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE',
  'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
]);

async function curlOk(url) {
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-k', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-L', '--max-time', '15', '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', url],
      { timeout: 20000 }
    );
    const code = parseInt(stdout.trim(), 10);
    return code >= 200 && code < 400;
  } catch {
    return false;
  }
}

// pass 2: for every url that failed pass 1 — check DNS, try host variants
// (www <-> blog <-> apex, http <-> https), and fix RSS accordingly.
const results = readJson(path.join(DATA_DIR, 'check-results.json'), {});
const blogs = loadBlogs();
const byUrl = new Map(blogs.map((b) => [b.url.replace(/\/+$/, ''), b]));

const failures = Object.entries(results).filter(([, r]) => !r.ok).map(([u]) => u);
console.log(`pass2: re-checking ${failures.length} failed urls with variants`);

const urlFixes = {}; // oldUrl -> newUrl
const rssFixes = {}; // hostKey -> newRss
const dead = []; // { url, name, reason }
const kept = []; // alive-but-fussy (bot-blocked / insecure TLS)

// historical memory: previous fixes stay valid (their urls are now healthy, so they
// won't be re-derived); merge them in so sync-upstream can keep blocking old addresses
const prevFixes = readJson(path.join(DATA_DIR, 'fixes.json'), {});
Object.assign(urlFixes, prevFixes.urlFixes || {});
Object.assign(rssFixes, prevFixes.rssFixes || {});

let t0 = Date.now();
await runPool(
  failures,
  15,
  async (oldUrl) => {
    const blog = byUrl.get(oldUrl);
    const host = hostOf(oldUrl);
    const name = blog?.name || oldUrl;
    const res = results[oldUrl];

    // a server responded and only refuses bots -> alive, keep as-is
    if (res?.status && ALIVE_CODES.has(res.status)) {
      kept.push({ url: oldUrl, name, status: res.status });
      return true;
    }

    // broken TLS but a server is clearly there -> confirm with curl -k, keep if alive
    if (res?.error && TLS_ERRORS.has(res.error.split(':')[0])) {
      const ok = await curlOk(oldUrl);
      if (ok) {
        kept.push({ url: oldUrl, name, status: 'tls-insecure' });
        return true;
      }
      // fall through: try variants (maybe the site moved to a working host)
    }

    // is the domain even registered/resolving?
    const dnsOk = host ? await resolveHost(host) : false;
    if (!dnsOk) {
      dead.push({ url: oldUrl, name, reason: 'DNS 不存在（域名已失效）' });
      return false;
    }

    // try variants of the site url
    let newUrl = null;
    for (const cand of hostVariants(oldUrl)) {
      const r = await probe(cand, { timeout: 12000 });
      if (!r.error && r.status >= 200 && r.status < 400) {
        newUrl = r.finalUrl || cand;
        break;
      }
    }
    if (!newUrl) {
      dead.push({ url: oldUrl, name, reason: '域名解析存在，但所有常见地址均无法访问' });
      return false;
    }

    urlFixes[oldUrl] = newUrl;
    if (newUrl.replace(/\/+$/, '') !== oldUrl.replace(/\/+$/, '')) {
      console.log(`FIX  ${oldUrl} -> ${newUrl}`);
    }

    // fix rss for this blog: original rss on swapped host, else common paths
    const candidates = [];
    if (blog?.rss) {
      try {
        const u = new URL(blog.rss);
        const nu = new URL(newUrl);
        u.protocol = nu.protocol;
        u.host = nu.host;
        candidates.push(u.toString());
      } catch {}
      candidates.push(blog.rss); // maybe the rss itself still works
    }
    for (const p of feedVariants(newUrl)) candidates.push(p);

    for (const cand of [...new Set(candidates)]) {
      const r = await probe(cand, { timeout: 12000, wantBody: true, maxBody: 200000 });
      if (!r.error && r.status < 400 && isFeedBody(r.contentType, r.body)) {
        if (cand !== blog?.rss) {
          rssFixes[hostKey(oldUrl)] = cand;
          console.log(`RSSFIX ${hostKey(oldUrl)} -> ${cand}`);
        }
        break;
      }
    }
    return !!newUrl;
  },
  {
    onProgress: (done, total) =>
      console.log(
        `pass2 progress ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s) - fixes=${Object.keys(urlFixes).length} dead=${dead.length}`
      ),
  }
);

writeJson(path.join(DATA_DIR, 'fixes.json'), { urlFixes, rssFixes, dead, kept, checkedAt: new Date().toISOString() });
console.log(`PASS2 DONE fixes=${Object.keys(urlFixes).length} rssFixes=${Object.keys(rssFixes).length} dead=${dead.length} keptAlive=${kept.length}`);
