import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  CSV_PATH,
  loadBlogs,
  saveBlogs,
  hostKey,
  rootOf,
  probe,
  isFeedBody,
  readJson,
  writeJson,
} from './lib.mjs';

// 用户提交收录 API + 人工审核后台（零依赖，与数据管线共用 lib.mjs）
// 防垃圾四层：蜜罐 → 限频 → 格式/查重（hostKey+root+墓园+旧修复，与 sync-upstream 同一套）→ 人工审核
// 审核通过 = 写入 blogs-original.csv + build 重建 + git 提交推送（GIT_ASKPASS 走环境变量）

const PORT = Number(process.env.PORT || 8348);
const DB_PATH = path.join(ROOT, 'data', 'submissions.json');
const LOCK_DIR = path.join(ROOT, 'data', '.cib-git.lock');
const STATS_PATH = path.join(ROOT, 'data', 'stats.json');
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const RATE_IP_DAILY = Number(process.env.RATE_IP_DAILY || 8);
const RATE_GLOBAL_DAILY = Number(process.env.RATE_GLOBAL_DAILY || 60);
const MAX_KEEP = 800; // submissions.json 只保留最近 N 条已处理记录，防止无限增长

if (!ADMIN_PASSWORD || !ADMIN_USER) {
  console.error('[submit-api] ADMIN_USER / ADMIN_PASSWORD 未设置，审核后台将不可用（提交接口仍可用）');
}

// ---------- 存储 ----------

function loadDB() {
  return readJson(DB_PATH, { submissions: [], ipStats: {} });
}

function saveDB(db) {
  // 先写临时文件再 rename，避免半截 JSON
  const tmp = DB_PATH + '.tmp';
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function pruneDB(db) {
  const keep = db.submissions.filter((s) => s.status === 'pending');
  const done = db.submissions.filter((s) => s.status !== 'pending').slice(-MAX_KEEP);
  db.submissions = [...keep, ...done];
  const d = today();
  for (const ip of Object.keys(db.ipStats)) {
    if (db.ipStats[ip].day !== d) delete db.ipStats[ip];
  }
}

// ---------- 访问统计（匿名计数：PV / 站外点击 / 来路域名，不存 IP 不存指纹）----------

function loadStats() {
  return readJson(STATS_PATH, { days: {}, clicks: {}, refs: {} });
}

let stats = loadStats();
let statsDirty = false;

function saveStats() {
  try {
    const tmp = STATS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stats));
    fs.renameSync(tmp, STATS_PATH);
    statsDirty = false;
  } catch (e) {
    console.error('[submit-api] saveStats failed:', e?.message);
  }
}

// 5 秒合并落盘，避免每次点击都写盘；保留 90 天
setInterval(() => {
  if (statsDirty) {
    const cutoff = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
    for (const d of Object.keys(stats.days)) if (d < cutoff) delete stats.days[d];
    saveStats();
  }
}, 5000).unref();

function recordHit(type, target, ref) {
  const day = new Date().toISOString().slice(0, 10);
  stats.days[day] = stats.days[day] || { pv: 0, clicks: 0 };
  if (ref) stats.refs[ref] = (stats.refs[ref] || 0) + 1;
  if (type === 'pv') {
    stats.days[day].pv++;
    statsDirty = true;
    return;
  }
  // click：按目标站点 hostKey 聚合
  let key = '';
  try {
    key = new URL(target).hostname.toLowerCase().replace(/^www\./, '').slice(0, 80);
  } catch {
    return;
  }
  if (!key) return;
  stats.days[day].clicks++;
  stats.clicks[key] = stats.clicks[key] || { total: 0, days: {} };
  stats.clicks[key].total++;
  stats.clicks[key].days[day] = (stats.clicks[key].days[day] || 0) + 1;
  if (Object.keys(stats.clicks).length > 2000) {
    // 防膨胀：总量最少的 200 个键清掉
    const keys = Object.keys(stats.clicks).sort((a, b) => stats.clicks[a].total - stats.clicks[b].total);
    for (const k of keys.slice(0, 200)) delete stats.clicks[k];
  }
  statsDirty = true;
}

function statsSummary() {
  const day = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
  let pvTotal = 0, clickTotal = 0, pv7 = 0;
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    const v = stats.days[d] || { pv: 0, clicks: 0 };
    pvTotal += v.pv;
    clickTotal += v.clicks;
    if (d >= weekAgo) pv7 += v.pv;
    series.push({ date: d, pv: v.pv, clicks: v.clicks });
  }
  const topClicks = Object.entries(stats.clicks)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 20)
    .map(([host, v]) => ({ host, total: v.total }));
  const topRefs = Object.entries(stats.refs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([host, n]) => ({ host, n }));
  return {
    pvToday: stats.days[day]?.pv || 0,
    pvYesterday: stats.days[yesterday]?.pv || 0,
    pv7,
    pvTotal,
    clickTotal,
    series,
    topClicks,
    topRefs,
  };
}

// ---------- 会话（HMAC 签名 cookie）----------

const SESSION_TTL = 1000 * 60 * 60 * 12; // 12h

function secret() {
  return crypto.createHash('sha256').update(`cib-admin:${ADMIN_USER}:${ADMIN_PASSWORD}`).digest();
}

function signSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() < exp;
  } catch {
    return false;
  }
}

function isAdmin(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/(?:^|;\s*)cib_admin=([^\s;]+)/);
  return verifySession(m ? m[1] : '');
}

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 登录防爆破：同 IP 连续失败 5 次 → 锁 15 分钟；XFF 可被直连源站伪造，
// 另设全站熔断：1 小时内失败 ≥30 次 → 全局锁 15 分钟（强随机密码下实际不可爆破）
const loginFails = new Map(); // ip -> { n, until }
let globalFail = { n: 0, windowStart: 0, until: 0 };
function loginBlocked(ip) {
  const f = loginFails.get(ip);
  if (f && f.until > Date.now()) return true;
  if (globalFail.until > Date.now()) return true;
  return false;
}
function recordLoginFail(ip) {
  const now = Date.now();
  if (now - globalFail.windowStart > 3600e3) {
    globalFail = { n: 0, windowStart: now, until: 0 };
  }
  globalFail.n++;
  if (globalFail.n >= 30) {
    globalFail.until = now + 15 * 60e3;
    console.warn('[submit-api] GLOBAL login lock 15m (brute-force guard)');
  }
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) {
    f.until = now + 15 * 60e3;
    f.n = 0;
    console.warn(`[submit-api] login locked for ${ip} (15m, brute-force guard)`);
  }
  loginFails.set(ip, f);
  if (loginFails.size > 5000) loginFails.clear();
}

// ---------- 校验 ----------

const BAD_WORDS = /博彩|赌场|赌博|棋牌|电子游艺|彩票|双色球|ag视讯|威尼斯人|色情|成人|约炮|私服|外挂|代刷|刷单|快排|留痕|蜘蛛池|泛目录|收购域名/i;

function clean(s, maxLen) {
  // 去控制字符与 CSV 破坏字符；收尾空白
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f",]/g, '')
    .trim()
    .slice(0, maxLen);
}

function validHttpUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const h = url.hostname;
    if (!h.includes('.') || net.isIP(h) || h.endsWith('.local')) return null;
    if (u.length > 300) return null;
    return url;
  } catch {
    return null;
  }
}

/** 与 sync-upstream 完全一致的屏蔽集：墓园 + fixes.dead + urlFixes 旧地址 */
function blockedSets() {
  const fixes = readJson(path.join(ROOT, 'data', 'fixes.json'), {});
  const offline = readJson(path.join(ROOT, 'data', 'offline.json'), []);
  const blocked = new Set();
  for (const o of [...offline, ...(fixes.dead || [])]) {
    if (hostKey(o.url)) blocked.add(hostKey(o.url));
    if (rootOf(o.url)) blocked.add(rootOf(o.url));
  }
  for (const oldUrl of Object.keys(fixes.urlFixes || {})) {
    if (hostKey(oldUrl)) blocked.add(hostKey(oldUrl));
    if (rootOf(oldUrl)) blocked.add(rootOf(oldUrl));
  }
  return blocked;
}

function dupCheck(url, db) {
  const key = hostKey(url);
  const root = rootOf(url);
  const ours = loadBlogs();
  const knownKeys = new Set(ours.map((b) => hostKey(b.url)));
  const knownRoots = new Set(ours.map((b) => rootOf(b.url)));
  if (knownKeys.has(key)) return '已收录（同域名）';
  if (knownRoots.has(root)) return '已收录（同主域）';
  const blocked = blockedSets();
  if (blocked.has(key) || blocked.has(root)) return '曾因失效被移除（墓园）';
  const pendRoots = new Set(
    db.submissions.filter((s) => s.status === 'pending').map((s) => rootOf(s.url))
  );
  if (pendRoots.has(root)) return '已有待审的同主域提交';
  return null;
}

async function turnstileVerify(token, ip) {
  if (!TURNSTILE_SECRET) return { skipped: true };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json();
    return { success: !!j.success, errors: j['error-codes'] };
  } catch (e) {
    return { success: false, error: String(e?.message || e).slice(0, 80) };
  }
}

// 提交时的实时体检，产出自动预判（人工审核仍是最后一关）
async function liveCheck(b) {
  const v = { reachable: null, rssOk: null, suspicious: [], notes: [] };
  const r = await probe(b.url, { timeout: 15000, wantBody: true, maxBody: 200000 });
  if (r.error) {
    v.reachable = false;
    v.notes.push(`访问失败: ${r.error}`);
    return v;
  }
  const suspended = /\/cgi-sys\/suspendedpage\.cgi/i.test(r.finalUrl || '');
  const antiBot = [401, 402, 403, 406, 407, 416, 429, 456].includes(r.status);
  if (suspended) {
    v.reachable = false;
    v.suspicious.push('cPanel 暂停页');
    return v;
  }
  v.reachable = r.status < 400 || antiBot;
  if (antiBot) v.notes.push(`HTTP ${r.status}（疑似反爬但活着）`);

  const finalRoot = rootOf(r.finalUrl || b.url);
  if (finalRoot && finalRoot !== rootOf(b.url)) {
    v.suspicious.push(`跳转到其他主域 ${finalRoot}`);
  }
  if (r.body) {
    const head = r.body.subarray(0, 4000).toString('utf8');
    const titleM = head.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
    const title = titleM ? titleM[1] : '';
    if (BAD_WORDS.test(head.slice(0, 2000)) || BAD_WORDS.test(title)) {
      v.suspicious.push('页面含博彩/违规关键词');
    }
    if (/域名.*出售|domain.*for\s*sale|sedoparking|parkingcrew|hugedomains/i.test(head)) {
      v.suspicious.push('疑似停放页');
    }
    if (title && b.name && !title.includes(b.name.slice(0, 6)) && head.length > 500) {
      // 名称与标题完全无关仅作提示，不判死
      v.notes.push(`站点标题「${title.trim().slice(0, 40)}」与提交名称不同`);
    }
  }
  if (b.rss) {
    const rr = await probe(b.rss, { timeout: 10000, wantBody: true, maxBody: 60000 });
    v.rssOk = !rr.error && (isFeedBody(rr.contentType, rr.body) || (rr.status < 400 && isFeedBody(rr.contentType, null)));
    if (!v.rssOk) v.notes.push('RSS 暂不可解析（不阻塞，每周巡检会自动发现 feed）');
  }
  return v;
}

function gradeOf(v) {
  if (v.suspicious.length) return 'C';
  if (v.reachable === false) return 'C';
  if (v.reachable && v.rssOk !== false) return 'A';
  return 'B';
}

// ---------- git 操作（审核通过时）----------

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 180000, ...opts });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.slice(-2000) };
}

async function withGitLock(fn) {
  const t0 = Date.now();
  while (true) {
    try {
      fs.mkdirSync(LOCK_DIR);
      break;
    } catch {
      if (Date.now() - t0 > 150000) return { ok: false, error: 'git 忙碌（巡检进行中），请稍后重试' };
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.rmdirSync(LOCK_DIR); } catch {}
  }
}

// 统一的仓库变更流水线：拉齐远端 → 变更 CSV → build+lint（失败回滚）→ commit+push
// mutate(ours) 直接修改 loadBlogs() 返回的数组，返回错误字符串或 null
async function applyRepoChange(mutate, commitMsg) {
  return withGitLock(async () => {
    // 0. 丢弃工作区可再生的构建产物差异（时间戳等），否则 pull --rebase 会被拒
    const st = run('git', ['status', '--porcelain']);
    if (st.out.trim()) {
      run('git', ['checkout', '--', '.']);
    }

    // 1. 同步远端（两个写入方：审核与每周巡检）
    let g = run('git', ['pull', '--rebase', 'origin', GIT_BRANCH]);
    if (g.code !== 0) return { ok: false, error: `git pull 失败: ${g.out.slice(-300)}` };

    // 2. 变更 CSV（失败可整体回滚）
    const before = fs.readFileSync(CSV_PATH, 'utf8');
    const ours = loadBlogs();
    const err = mutate(ours);
    if (err) return { ok: false, error: err };
    saveBlogs(ours);

    // 3. 重建 + 格式校验
    const build = run('node', ['scripts/build.mjs']);
    if (build.code !== 0) {
      fs.writeFileSync(CSV_PATH, before);
      run('node', ['scripts/build.mjs']);
      return { ok: false, error: `build 失败，已回滚: ${build.out.slice(-300)}` };
    }
    const lint = run('node', ['scripts/lint.mjs']);
    if (lint.code !== 0) {
      fs.writeFileSync(CSV_PATH, before);
      run('node', ['scripts/build.mjs']);
      return { ok: false, error: `lint 失败，已回滚: ${lint.out.slice(-300)}` };
    }

    // 4. 提交推送
    run('git', ['add', '-A']);
    g = run('git', ['commit', '-m', commitMsg]);
    if (g.code !== 0 && !/nothing to commit/.test(g.out)) {
      return { ok: false, error: `git commit 失败: ${g.out.slice(-300)}` };
    }
    g = run('git', ['push', 'origin', GIT_BRANCH]);
    if (g.code !== 0) {
      run('git', ['pull', '--rebase', 'origin', GIT_BRANCH]);
      g = run('git', ['push', 'origin', GIT_BRANCH]);
      if (g.code !== 0) {
        return { ok: false, error: `git push 失败（本地已提交，下轮巡检会重试推送）: ${g.out.slice(-300)}` };
      }
    }
    return { ok: true };
  });
}

async function approveToRepo(sub) {
  return applyRepoChange((ours) => {
    // 复核查重（以最新 CSV 为准）
    const knownKeys = new Set(ours.map((b) => hostKey(b.url)));
    const knownRoots = new Set(ours.map((b) => rootOf(b.url)));
    if (knownKeys.has(hostKey(sub.url)) || knownRoots.has(rootOf(sub.url))) {
      return '该博客已被收录（或巡检刚加入），无需重复添加';
    }
    ours.push({ name: sub.name, url: sub.url, rss: sub.rss || '', tags: sub.tags });
    return null;
  }, `feat: 新增博客 ${sub.name}（用户提交，人工审核通过）`);
}

// 后台编辑：按原 url 定位行，替换字段
async function editInRepo(origUrl, fields) {
  const origKey = hostKey(origUrl);
  return applyRepoChange((ours) => {
    const row = ours.find((b) => hostKey(b.url) === origKey);
    if (!row) return '未找到该博客（可能已被删除或巡检刚调整）';
    if (fields.url && hostKey(fields.url) !== origKey) {
      // 换域名：新 hostKey/root 不能与其他行冲突
      const newK = hostKey(fields.url);
      const newR = rootOf(fields.url);
      for (const b of ours) {
        if (b === row) continue;
        if (hostKey(b.url) === newK || rootOf(b.url) === newR) {
          return `新地址与已有博客冲突：${b.name} (${b.url})`;
        }
      }
    }
    if (fields.name) row.name = fields.name;
    if (fields.url) row.url = fields.url;
    if (fields.rss !== undefined) row.rss = fields.rss;
    if (fields.tags !== undefined) row.tags = fields.tags;
    // 同步 lastupdate.json 的键（换域名时迁移，删除时清理由 delete 流程处理）
    const luPath = path.join(ROOT, 'data', 'lastupdate.json');
    const lu = readJson(luPath, {});
    if (fields.url && hostKey(fields.url) !== origKey && lu[origKey]) {
      lu[hostKey(fields.url)] = lu[origKey];
      delete lu[origKey];
      writeJson(luPath, lu);
    }
    return null;
  }, `fix: 后台编辑博客 ${fields.name || origUrl}（人工操作）`);
}

// 后台删除：移除行；blacklist 时同时写入墓园（上游同步永不回加）
async function deleteFromRepo(targetUrl, blacklist, name) {
  const tKey = hostKey(targetUrl);
  return applyRepoChange((ours) => {
    const idx = ours.findIndex((b) => hostKey(b.url) === tKey);
    if (idx === -1) return '未找到该博客（可能已被删除或巡检刚调整）';
    const [row] = ours.splice(idx, 1);
    if (blacklist) {
      const offPath = path.join(ROOT, 'data', 'offline.json');
      const off = readJson(offPath, []);
      if (!off.some((o) => hostKey(o.url) === tKey)) {
        off.push({
          name: row.name,
          url: row.url,
          rss: row.rss || '',
          tags: row.tags || [],
          reason: '维护者后台手动移除（拉黑）',
          removedAt: new Date().toISOString().slice(0, 10),
        });
        writeJson(offPath, off);
      }
    }
    const luPath = path.join(ROOT, 'data', 'lastupdate.json');
    const lu = readJson(luPath, {});
    if (lu[tKey]) {
      delete lu[tKey];
      writeJson(luPath, lu);
    }
    return null;
  }, `chore: 后台移除博客 ${name || targetUrl}${blacklist ? '（已拉黑）' : ''}（人工操作）`);
}

// ---------- HTTP 基础 ----------

function json(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function clientIP(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || 'unknown';
}

function readBody(req, cap = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------- 提交接口 ----------

async function handleSubmit(req, res) {
  const db = loadDB();
  const ip = clientIP(req);
  const d = today();

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { ok: false, error: '请求体不合法' });
  }

  // 限频：所有提交请求都计数（含蜜罐命中，机器人刷接口也烧额度）
  const stat = db.ipStats[ip] || { day: d, count: 0 };
  const globalToday = Object.values(db.ipStats).reduce(
    (n, s) => n + (s.day === d ? s.count : 0),
    0
  );
  if (stat.day === d && stat.count >= RATE_IP_DAILY) {
    return json(res, 429, { ok: false, error: '今天提交次数已达上限，请明天再试' });
  }
  if (globalToday >= RATE_GLOBAL_DAILY) {
    return json(res, 429, { ok: false, error: '今日全站提交额度已用完，请明天再试' });
  }
  db.ipStats[ip] = { day: d, count: (stat.day === d ? stat.count : 0) + 1 };
  pruneDB(db);
  saveDB(db);

  // 蜜罐：正常用户永远看不到这个字段；命中即假装成功，不给机器人任何信号
  if (clean(body.website2, 100)) {
    return json(res, 200, { ok: true, message: '已收到，感谢提交！' });
  }

  // Turnstile（可选）
  if (TURNSTILE_SECRET) {
    const tv = await turnstileVerify(body.turnstileToken, ip);
    if (!tv.success) {
      return json(res, 403, { ok: false, error: '人机验证未通过，请重试' });
    }
  }

  // 字段
  const name = clean(body.name, 40);
  const desc = clean(body.desc, 150);
  const tagStr = clean(body.tags, 60);
  const rssUrl = clean(body.rss, 300);
  const rawUrl = clean(body.url, 300);
  const urlObj = validHttpUrl(rawUrl);
  if (name.length < 2) return json(res, 400, { ok: false, error: '博客名称至少 2 个字符' });
  if (!urlObj) return json(res, 400, { ok: false, error: '博客地址不合法（需 http/https 正常域名）' });
  if (rssUrl && !validHttpUrl(rssUrl)) return json(res, 400, { ok: false, error: 'RSS 地址不合法' });
  const url = urlObj.toString();
  const tags = tagStr.split(/[;；]/).map((t) => t.trim()).filter(Boolean).slice(0, 6);

  // 查重：现列表 + 墓园 + 修复历史 + 待审队列
  const dup = dupCheck(url, db);
  if (dup) return json(res, 409, { ok: false, error: dup });

  // 实时体检（用户等待期间完成，约 5-25 秒）
  const verdict = await liveCheck({ name, url, rss: rssUrl });

  const sub = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ip,
    name,
    url,
    rss: rssUrl,
    desc,
    tags,
    verdict,
    grade: gradeOf(verdict),
    status: 'pending',
  };
  db.submissions.push(sub);
  pruneDB(db);
  saveDB(db);

  const msg =
    sub.grade === 'A'
      ? '提交成功！自动检测全部通过，等待人工确认后即可上架。'
      : sub.grade === 'B'
        ? '提交成功！站点可达，但部分检测项未通过，等待人工确认。'
        : '已收到提交。自动检测发现问题（详见后台），会由维护者人工复核。';
  return json(res, 200, { ok: true, id: sub.id, grade: sub.grade, verdict, message: msg });
}

// ---------- 审核 API ----------

async function handleAction(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'bad request' });
  }
  const { id, action } = body;
  const db = loadDB();
  const sub = db.submissions.find((s) => s.id === id && s.status === 'pending');
  if (!sub) return json(res, 404, { ok: false, error: '提交不存在或已处理' });

  if (action === 'reject') {
    sub.status = 'rejected';
    sub.reviewedAt = new Date().toISOString();
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  if (action !== 'approve') return json(res, 400, { ok: false, error: 'unknown action' });

  const r = await approveToRepo(sub);
  sub.reviewedAt = new Date().toISOString();
  sub.status = r.ok ? 'approved' : 'pending';
  if (!r.ok) sub.pushError = r.error;
  saveDB(db);
  if (!r.ok) return json(res, 500, { ok: false, error: r.error });
  return json(res, 200, { ok: true, message: '已加入列表并重建站点' });
}

// ---------- 审核后台 UI：独立 HTML 文件（避免嵌套模板的转义地狱）----------

const ADMIN_HTML = fs.readFileSync(new URL('./submit-admin-ui.html', import.meta.url), 'utf8');

// ---------- 路由 ----------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().split(':')[0].toLowerCase();
  const isOps = host === 'ops.bloghao.com';

  try {
    if (p === '/api/health') return json(res, 200, { ok: true, service: 'cib-submit-api' });

    if (p === '/api/config') {
      return json(res, 200, { ok: true, turnstileSiteKey: TURNSTILE_SITE_KEY || null });
    }

    // 匿名访问统计信标（公开站前端 sendBeacon 调用；只存聚合计数，不存 IP）
    if (p === '/api/hit' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const type = body.type === 'click' ? 'click' : 'pv';
      const ref = clean(body.ref, 60).replace(/^www\./, '');
      recordHit(type, clean(body.target, 300), ref === host || !ref ? '' : ref);
      res.writeHead(204).end();
      return;
    }

    if (p === '/api/submit' && req.method === 'POST') {
      return await handleSubmit(req, res);
    }

    if (p === '/admin/login' && req.method === 'POST') {
      const ip = clientIP(req);
      if (loginBlocked(ip)) {
        return json(res, 429, { ok: false, error: '失败次数过多，请 15 分钟后再试' });
      }
      const body = await readJsonBody(req).catch(() => ({}));
      const okUser = ADMIN_USER && timingSafeEq(String(body.username ?? ''), ADMIN_USER);
      const okPass = ADMIN_PASSWORD && timingSafeEq(String(body.password ?? ''), ADMIN_PASSWORD);
      if (okUser && okPass) {
        loginFails.delete(ip);
        const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
        return json(res, 200, { ok: true }, {
          'Set-Cookie': `cib_admin=${signSession()}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${SESSION_TTL / 1000}`,
        });
      }
      recordLoginFail(ip);
      return json(res, 401, { ok: false, error: '用户名或密码错误' });
    }

    if (p === '/admin/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'cib_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    // 旧入口跳转：list.bloghao.com/admin → ops.bloghao.com/blog-admin/
    if (!isOps && (p === '/admin' || p === '/admin/') && !p.startsWith('/admin/api')) {
      res.writeHead(301, { Location: 'https://ops.bloghao.com/blog-admin/' }).end();
      return;
    }

    // ops 面板根路径 = 审核后台
    if (isOps && (p === '/' || p === '/admin')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(ADMIN_HTML);
    }

    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) {
        if (p === '/admin/api/list' || p === '/admin/api/action' || p === '/admin/api/blogs' || p === '/admin/api/edit' || p === '/admin/api/delete' || p === '/admin/api/stats') {
          return json(res, 401, { ok: false, error: 'unauthorized' });
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(ADMIN_HTML);
      }
      if (p === '/admin/api/list') {
        const db = loadDB();
        return json(res, 200, {
          ok: true,
          submissions: db.submissions.map(({ ip, ...s }) => (s.status === 'pending' ? { ...s, ip } : s)),
        });
      }
      if (p === '/admin/api/action' && req.method === 'POST') {
        return await handleAction(req, res);
      }
      // 博客管理：全量列表（一次读完 lastupdate，客户端本地过滤 = 毫秒级搜索）
      if (p === '/admin/api/blogs') {
        const lu = readJson(path.join(ROOT, 'data', 'lastupdate.json'), {});
        const blogs = loadBlogs().map((b) => ({
          name: b.name,
          url: b.url,
          rss: b.rss || '',
          tags: b.tags,
          lastUpdate: lu[hostKey(b.url)]?.lastUpdate || null,
        }));
        return json(res, 200, { ok: true, total: blogs.length, blogs });
      }
      // 博客管理：编辑
      if (p === '/admin/api/edit' && req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        const origUrl = clean(body.url, 300);
        if (!origUrl) return json(res, 400, { ok: false, error: '缺少定位 url' });
        const fields = {};
        if (body.name !== undefined) {
          fields.name = clean(body.name, 40);
          if (fields.name.length < 2) return json(res, 400, { ok: false, error: '名称至少 2 个字符' });
        }
        if (body.newUrl !== undefined && clean(body.newUrl, 300)) {
          const uo = validHttpUrl(clean(body.newUrl, 300));
          if (!uo) return json(res, 400, { ok: false, error: '新地址不合法' });
          fields.url = uo.toString();
        }
        if (body.rss !== undefined) {
          const rss = clean(body.rss, 300);
          if (rss && !validHttpUrl(rss)) return json(res, 400, { ok: false, error: 'RSS 地址不合法' });
          fields.rss = rss;
        }
        if (body.tags !== undefined) {
          fields.tags = clean(body.tags, 60).split(/[;；]/).map((t) => t.trim()).filter(Boolean).slice(0, 6);
        }
        const r = await editInRepo(origUrl, fields);
        if (!r.ok) return json(res, 500, { ok: false, error: r.error });
        return json(res, 200, { ok: true, message: '已保存并重建站点' });
      }
      // 博客管理：删除
      if (p === '/admin/api/delete' && req.method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        const targetUrl = clean(body.url, 300);
        if (!targetUrl) return json(res, 400, { ok: false, error: '缺少定位 url' });
        const r = await deleteFromRepo(targetUrl, !!body.blacklist, clean(body.name, 40));
        if (!r.ok) return json(res, 500, { ok: false, error: r.error });
        return json(res, 200, { ok: true, message: body.blacklist ? '已删除并拉黑' : '已删除' });
      }
      // 访问统计
      if (p === '/admin/api/stats') {
        return json(res, 200, { ok: true, stats: statsSummary() });
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(ADMIN_HTML);
    }

    if (p === '/') return json(res, 200, { ok: true, service: 'cib-submit-api', admin: '/admin' });
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    console.error('[submit-api]', e);
    if (!res.headersSent) json(res, 500, { ok: false, error: '服务器内部错误' });
  }
});

// 容器内监听所有接口（宿主机由 compose 把端口绑到 127.0.0.1，再由 Caddy 对外）
server.listen(PORT, () => {
  console.log(`[submit-api] listening on :${PORT} (admin: /admin${TURNSTILE_SECRET ? ', turnstile: on' : ', turnstile: off'})`);
});
