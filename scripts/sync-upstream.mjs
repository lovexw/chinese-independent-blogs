import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadBlogs, saveBlogs, hostKey, rootOf, probe, runPool } from './lib.mjs';

const UPSTREAM_CSV =
  'https://raw.githubusercontent.com/timqian/chinese-independent-blogs/master/blogs-original.csv';

// Incremental sync: only NEW blogs from upstream are appended.
// Existing rows (incl. our fixes/removals/pinning) are never touched.

const res = await fetch(UPSTREAM_CSV, { redirect: 'follow' });
if (!res.ok) {
  console.error(`failed to fetch upstream csv: ${res.status}`);
  process.exit(1);
}
const upstreamText = await res.text();
fs.writeFileSync(path.join(ROOT, 'data', 'upstream-latest.csv'), upstreamText);

const upstream = loadBlogs(path.join(ROOT, 'data', 'upstream-latest.csv'));
const ours = loadBlogs();
const known = new Set(ours.map((b) => hostKey(b.url)));
const knownRoots = new Set(ours.map((b) => rootOf(b.url)));

const fresh = upstream.filter((b) => {
  const key = hostKey(b.url);
  // a row is "new" only if neither its host nor its registrable domain is already listed
  return key && !known.has(key) && !knownRoots.has(rootOf(b.url));
});

if (!fresh.length) {
  console.log('sync: upstream has no new blogs');
  process.exit(0);
}

// sanity-check the newcomers so a dead-on-arrival row doesn't pollute the list:
// anything unreachable still gets appended, but tagged in the log for the next audit run.
const checked = await runPool(fresh, 15, async (b) => {
  const r = await probe(b.url, { timeout: 15000 });
  b._ok = !r.error && r.status < 400;
  return b._ok;
});

const dead = fresh.filter((b) => !b._ok);
for (const b of dead) console.log(`WARN new-but-unreachable: ${b.name} ${b.url}`);

ours.push(...fresh.map(({ _ok, ...b }) => b));
saveBlogs(ours);
console.log(`sync: appended ${fresh.length} new blogs (${dead.length} unreachable)`);
