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
} from './lib.mjs';

// 用户提交收录 API + 人工审核后台（零依赖，与数据管线共用 lib.mjs）
// 防垃圾四层：蜜罐 → 限频 → 格式/查重（hostKey+root+墓园+旧修复，与 sync-upstream 同一套）→ 人工审核
// 审核通过 = 写入 blogs-original.csv + build 重建 + git 提交推送（GIT_ASKPASS 走环境变量）

const PORT = Number(process.env.PORT || 8348);
const DB_PATH = path.join(ROOT, 'data', 'submissions.json');
const LOCK_DIR = path.join(ROOT, 'data', '.cib-git.lock');
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const RATE_IP_DAILY = Number(process.env.RATE_IP_DAILY || 8);
const RATE_GLOBAL_DAILY = Number(process.env.RATE_GLOBAL_DAILY || 60);
const MAX_KEEP = 800; // submissions.json 只保留最近 N 条已处理记录，防止无限增长

if (!ADMIN_PASSWORD) {
  console.error('[submit-api] ADMIN_PASSWORD 未设置，审核后台将不可用（提交接口仍可用）');
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

// ---------- 会话（HMAC 签名 cookie）----------

const SESSION_TTL = 1000 * 60 * 60 * 12; // 12h

function secret() {
  return crypto.createHash('sha256').update(`cib-admin:${ADMIN_PASSWORD}`).digest();
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

// ---------- 校验 ----------

const BAD_WORDS = /博彩|赌场|赌博|棋牌|电子游艺|彩票|双色球|ag视讯|威尼斯人|色情|成人|约炮|隔套路由|私服|外挂|代刷|刷单|快排|留痕|蜘蛛池|泛目录|收购域名|cheng Ren/i;

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

async function approveToRepo(sub) {
  return withGitLock(async () => {
    // 1. 同步远端（两个写入方：审核与每周巡检）
    let g = run('git', ['pull', '--rebase', 'origin', GIT_BRANCH]);
    if (g.code !== 0) return { ok: false, error: `git pull 失败: ${g.out.slice(-300)}` };

    // 2. 复核查重（以最新 CSV 为准）
    const ours = loadBlogs();
    const knownKeys = new Set(ours.map((b) => hostKey(b.url)));
    const knownRoots = new Set(ours.map((b) => rootOf(b.url)));
    if (knownKeys.has(hostKey(sub.url)) || knownRoots.has(rootOf(sub.url))) {
      return { ok: false, error: '该博客已被收录（或巡检刚加入），无需重复添加' };
    }

    // 3. 追加 CSV（失败可整体回滚）
    const before = fs.readFileSync(CSV_PATH, 'utf8');
    ours.push({ name: sub.name, url: sub.url, rss: sub.rss || '', tags: sub.tags });
    saveBlogs(ours);

    // 4. 重建 + 格式校验
    let build = run('node', ['scripts/build.mjs']);
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

    // 5. 提交推送
    run('git', ['add', '-A']);
    g = run('git', ['commit', '-m', `feat: 新增博客 ${sub.name}（用户提交，人工审核通过）`]);
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

async function handleAction(req, res, urlObj) {
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

// ---------- 审核后台 UI ----------

const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>博客收录审核 · bloghao</title>
<style>
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --fg:#e8eaf0; --dim:#8b93a5; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; --acc:#6ea8fe; }
  @media (prefers-color-scheme: light) { :root { --bg:#f5f6f8; --card:#fff; --line:#e3e6ec; --fg:#1a1d24; --dim:#69718a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:880px; margin:0 auto; padding:24px 16px 60px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--dim); font-size:13px; margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:14px; }
  .head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .name { font-weight:600; font-size:16px; }
  .grade { font-size:12px; padding:1px 8px; border-radius:99px; }
  .gA { background:rgba(74,222,128,.15); color:var(--ok); } .gB { background:rgba(251,191,36,.15); color:var(--warn); } .gC { background:rgba(248,113,113,.15); color:var(--bad); }
  .meta { color:var(--dim); font-size:12.5px; margin-top:6px; word-break:break-all; }
  .meta a { color:var(--acc); text-decoration:none; }
  .verdict { margin-top:8px; font-size:13px; }
  .badge { display:inline-block; margin:2px 6px 2px 0; padding:1px 8px; border-radius:6px; font-size:12px; border:1px solid var(--line); color:var(--dim); }
  .badge.ok { color:var(--ok); border-color:rgba(74,222,128,.4); } .badge.bad { color:var(--bad); border-color:rgba(248,113,113,.4); } .badge.warn { color:var(--warn); border-color:rgba(251,191,36,.4); }
  .acts { margin-top:12px; display:flex; gap:10px; }
  button { cursor:pointer; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--fg); padding:7px 16px; font-size:14px; }
  .primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  .danger { color:var(--bad); border-color:rgba(248,113,113,.5); }
  button:disabled { opacity:.5; cursor:default; }
  .err { color:var(--bad); font-size:13px; margin-top:8px; white-space:pre-wrap; }
  input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--fg); font-size:15px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
  .empty { text-align:center; color:var(--dim); padding:60px 0; }
  h2 { font-size:14px; color:var(--dim); font-weight:500; margin:28px 0 10px; }
  .done { font-size:13px; color:var(--dim); padding:8px 0; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:10px; }
</style>
</head>
<body><div class="wrap">
<div id="app"><div class="empty">加载中…</div></div>
</div>
<script>
const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, body) {
  const r = await fetch(path, body ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) } : {});
  if (r.status === 401) { renderLogin(); throw new Error('unauthorized'); }
  return r.json();
}

function renderLogin(err) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const c = $(<div class="card" style="max-width:360px;margin:80px auto"><h1>博客收录审核</h1><div class="sub">请输入管理密码</div><input id="pw" type="password" placeholder="管理密码" autofocus><div class="err"></div><div class="acts"><button class="primary" style="flex:1">登录</button></div></div>\`');
  app.appendChild(c);
  const doLogin = async () => {
    const r = await fetch('/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: c.querySelector('#pw').value }) });
    if (r.ok) { load(); } else { c.querySelector('.err').textContent = '密码错误'; }
  };
  c.querySelector('button').onclick = doLogin;
  c.querySelector('#pw').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  if (err) c.querySelector('.err').textContent = err;
}

function verdictBadges(v) {
  let h = '';
  h += v.reachable === true ? '<span class="badge ok">站点可达</span>' : v.reachable === false ? '<span class="badge bad">不可达</span>' : '<span class="badge">未检测</span>';
  h += v.rssOk === true ? '<span class="badge ok">RSS 正常</span>' : v.rssOk === false ? '<span class="badge warn">RSS 未解析</span>' : '<span class="badge">RSS 未填</span>';
  for (const s of v.suspicious || []) h += '<span class="badge bad">' + esc(s) + '</span>';
  for (const n of v.notes || []) h += '<span class="badge">' + esc(n) + '</span>';
  return h;
}

function renderList(data) {
  const app = document.getElementById('app');
  app.innerHTML = '';
  const bar = $(<div class="topbar"><h1>博客收录审核</h1><button id="out">退出</button></div>\`');
  bar.querySelector('#out').onclick = async () => { await fetch('/admin/logout', { method:'POST' }); renderLogin(); };
  app.appendChild(bar);

  const pend = data.submissions.filter((s) => s.status === 'pending');
  if (!pend.length) app.appendChild($(<div class="empty">暂无待审提交 ✓</div>\`'));
  for (const s of pend) {
    const d = new Date(s.ts).toLocaleString('zh-CN');
    const card = $(<div class="card"><div class="head"><span class="name">' + esc(s.name) + '</span><span class="grade g' + esc(s.grade) + '">' + esc(s.grade) + ' 级</span></div><div class="meta">' + esc(s.url) + (s.rss ? ' · <a href="' + esc(s.rss) + '">RSS</a>' : '') + '</div>' + (s.desc ? '<div class="meta">' + esc(s.desc) + '</div>' : '') + (s.tags.length ? '<div class="meta">标签: ' + esc(s.tags.join('；')) + '</div>' : '') + '<div class="verdict">' + verdictBadges(s.verdict) + '</div><div class="meta">IP ' + esc(s.ip) + ' · ' + esc(d) + '</div><div class="acts"><button class="primary b-ok">通过并上架</button><button class="danger b-no">拒绝</button><span class="err"></span></div></div>\`');
    const errEl = card.querySelector('.err');
    card.querySelector('.b-ok').onclick = async (e) => {
      e.target.disabled = true; errEl.textContent = '正在写入列表并重建…';
      try {
        const r = await api('/admin/api/action', { id: s.id, action: 'approve' });
        if (r.ok) { load(); } else { errEl.textContent = r.error || '失败'; e.target.disabled = false; }
      } catch (err) { if (err.message !== 'unauthorized') { errEl.textContent = String(err); e.target.disabled = false; } }
    };
    card.querySelector('.b-no').onclick = async (e) => {
      e.target.disabled = true;
      await api('/admin/api/action', { id: s.id, action: 'reject' });
      load();
    };
    app.appendChild(card);
  }

  const done = data.submissions.filter((s) => s.status !== 'pending').slice(-20).reverse();
  if (done.length) {
    app.appendChild($(<h2>最近处理</h2>\`'));
    for (const s of done) {
      const okm = s.status === 'approved';
      app.appendChild($(<div class="done"><span>' + (okm ? '✅' : '❌') + ' ' + esc(s.name) + '</span><span>' + esc(new Date(s.reviewedAt || s.ts).toLocaleString('zh-CN')) + '</span></div>\`'));
    }
  }
}

async function load() {
  try {
    const data = await api('/admin/api/list');
    renderList(data);
  } catch {}
}

// 入口：先探一下是否已登录
fetch('/admin/api/list').then((r) => { if (r.status === 401) renderLogin(); else load(); }).catch(renderLogin);
</script>
</body></html>`;

// ---------- 路由 ----------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    if (p === '/api/health') return json(res, 200, { ok: true, service: 'cib-submit-api' });

    if (p === '/api/config') {
      return json(res, 200, { ok: true, turnstileSiteKey: TURNSTILE_SITE_KEY || null });
    }

    if (p === '/api/submit' && req.method === 'POST') {
      return await handleSubmit(req, res);
    }

    if (p === '/admin/login' && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      if (ADMIN_PASSWORD && timingSafeEq(body.password, ADMIN_PASSWORD)) {
        return json(res, 200, { ok: true }, {
          'Set-Cookie': `cib_admin=${signSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`,
        });
      }
      return json(res, 401, { ok: false, error: '密码错误' });
    }

    if (p === '/admin/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'cib_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) {
        if (p === '/admin/api/list' || p === '/admin/api/action') {
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
        return await handleAction(req, res, u);
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
