import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadBlogs, saveBlogs, hostKey, rootOf, probe, runPool, readJson, writeJson } from './lib.mjs';

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

// blogs we deliberately removed (dead/unreachable) must never come back via sync,
// and neither must the old addresses of blogs we already migrated (urlFixes)
const fixes = readJson(path.join(ROOT, 'data', 'fixes.json'), {});
const offline = readJson(path.join(ROOT, 'data', 'offline.json'), []);
const blocked = new Set();
for (const o of [...offline, ...(fixes.dead || [])]) {
  blocked.add(hostKey(o.url));
  blocked.add(rootOf(o.url));
}
for (const oldUrl of Object.keys(fixes.urlFixes || {})) {
  blocked.add(hostKey(oldUrl));
  blocked.add(rootOf(oldUrl));
}

const fresh = upstream.filter((b) => {
  const key = hostKey(b.url);
  // a row is "new" only if neither its host nor its registrable domain is already
  // listed — and it must not be in the offline archive
  return (
    key &&
    !known.has(key) &&
    !knownRoots.has(rootOf(b.url)) &&
    !blocked.has(key) &&
    !blocked.has(rootOf(b.url))
  );
});

// revival check: archived rows whose exact host is still in upstream get one probe —
// if the blog came back online, restore it and drop it from the offline archive
const norm = (u) => u.replace(/\/+$/, '');
const revived = [];
for (const b of upstream) {
  const key = hostKey(b.url);
  if (!key || known.has(key) || knownRoots.has(rootOf(b.url))) continue;
  if (!blocked.has(key)) continue; // only exact-host offline entries qualify
  const r = await probe(b.url, { timeout: 15000 });
  if (!r.error && r.status < 400) {
    revived.push(b);
    console.log(`REVIVED: ${b.name} ${b.url} is back online`);
  }
}
if (revived.length) {
  const offPath = path.join(ROOT, 'data', 'offline.json');
  const off = readJson(offPath, []);
  const revivedUrls = new Set(revived.map((b) => norm(b.url)));
  writeJson(offPath, off.filter((o) => !revivedUrls.has(norm(o.url))));
  ours.push(...revived);
}

// sanity-check the newcomers so a dead-on-arrival row doesn't pollute the list:
// anything unreachable still gets appended, but tagged in the log for the next audit run.
let unreachableNew = 0;
if (fresh.length) {
  const checked = await runPool(fresh, 15, async (b) => {
    const r = await probe(b.url, { timeout: 15000 });
    b._ok = !r.error && r.status < 400;
    return b._ok;
  });
  unreachableNew = fresh.filter((b) => !b._ok).length;
  for (const b of fresh.filter((b) => !b._ok)) console.log(`WARN new-but-unreachable: ${b.name} ${b.url}`);
  ours.push(...fresh.map(({ _ok, ...b }) => b));
}

if (!fresh.length && !revived.length) {
  console.log('sync: upstream has no new blogs');
  process.exit(0);
}

saveBlogs(ours);
if (fresh.length) console.log(`sync: appended ${fresh.length} new blogs (${unreachableNew} unreachable)`);
if (revived.length) console.log(`sync: restored ${revived.length} revived blog(s)`);
