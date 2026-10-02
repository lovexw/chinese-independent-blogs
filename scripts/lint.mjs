import { loadBlogs, hostKey, hostOf } from './lib.mjs';

// Lightweight lint for community PRs: every row must be a plausible blog entry.
const blogs = loadBlogs();
const seen = new Set();
let errors = 0;

for (const b of blogs) {
  const row = `${b.name} <${b.url}>`;
  if (!/^https?:\/\//.test(b.url)) {
    console.error(`✗ URL must start with http(s):// — ${row}`);
    errors++;
  }
  if (!hostOf(b.url)) {
    console.error(`✗ URL has no valid host — ${row}`);
    errors++;
  }
  if (b.tags.length > 6) {
    console.error(`✗ too many tags (max 6) — ${row}`);
    errors++;
  }
  for (const t of b.tags) {
    if (t !== t.trim() || t === '') {
      console.error(`✗ tags need trimming — ${row}`);
      errors++;
    }
    if (t.includes('；')) {
      console.error(`✗ 请使用英文分号 ; 分隔标签 — ${row}`);
      errors++;
    }
  }
  const key = hostKey(b.url);
  if (seen.has(key)) {
    console.error(`✗ duplicate blog host — ${row}`);
    errors++;
  }
  seen.add(key);
}

if (errors) {
  console.error(`\nlint failed with ${errors} problem(s)`);
  process.exit(1);
}
console.log(`lint ok: ${blogs.length} blogs`);
