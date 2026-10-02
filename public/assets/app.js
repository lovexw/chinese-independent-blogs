/* 中文独立博客列表 · showcase app */
(() => {
  const PIN_HOST = 'xiaowuleyi.com';
  const CHUNK = 60;

  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const chips = document.getElementById('chips');
  const searchInput = document.getElementById('searchInput');
  const sortSel = document.getElementById('sortSel');
  const resultCount = document.getElementById('resultCount');
  const toTop = document.getElementById('toTop');
  const toastEl = document.getElementById('toast');

  let all = [];
  let meta = {};
  let state = { q: '', tags: new Set(), sort: 'default' };
  let rendered = 0;
  let view = [];
  let pinnedCount = 0;

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const hostOf = (u) => {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  };

  const isPinned = (b) => hostOf(b.url).includes(PIN_HOST);

  function relTime(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const s = (Date.now() - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    const d = Math.floor(s / 86400);
    if (d === 1) return '昨天';
    if (d < 7) return d + ' 天前';
    if (d < 30) return Math.floor(d / 7) + ' 周前';
    if (d < 365) return Math.floor(d / 30) + ' 个月前';
    return Math.floor(d / 365) + ' 年前';
  }

  const dayOf = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

  function cardHTML(b, idx) {
    const upd = relTime(b.lastUpdate);
    const fresh = b.lastUpdate && Date.now() - Date.parse(b.lastUpdate) < 30 * 86400e3;
    const host = hostOf(b.url);
    const updHTML = upd
      ? `<span class="upd ${fresh ? 'fresh' : ''}" title="最近更新：${esc(dayOf(b.lastUpdate))}"><span class="dot"></span>${esc(upd)}更新</span>`
      : `<span class="upd" title="未抓取到 RSS 或 feed 中没有时间"><span class="dot"></span>更新时间未知</span>`;
    const tags = (b.tags || [])
      .slice(0, 4)
      .map((t) => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`)
      .join('');
    return `
      <article class="card" style="--d:${Math.min(idx, 14)}">
        <div class="card-top">
          <a class="title" href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.name)}">${esc(b.name)}</a>
        </div>
        <div class="host">${esc(host)}</div>
        ${b.desc ? `<div class="desc">${esc(b.desc)}</div>` : ''}
        ${b.tags && b.tags.length ? `<div class="tags">${tags}</div>` : ''}
        <div class="card-foot">
          ${updHTML}
          <span class="acts">
            ${b.rss ? `<button class="mini-btn" data-copy="${esc(b.rss)}" title="复制 RSS 地址：${esc(b.rss)}" aria-label="复制 RSS 地址"><svg><use href="#i-copy"/></svg></button>
            <a class="mini-btn" href="${esc(b.rss)}" target="_blank" rel="noopener" title="打开 RSS 订阅" aria-label="打开 RSS 订阅"><svg><use href="#i-rss"/></svg></a>` : ''}
            <a class="mini-btn" href="${esc(b.url)}" target="_blank" rel="noopener" title="访问博客" aria-label="访问博客"><svg><use href="#i-ext"/></svg></a>
          </span>
        </div>
      </article>`;
  }

  function pinnedHTML(b) {
    const upd = relTime(b.lastUpdate);
    const fresh = b.lastUpdate && Date.now() - Date.parse(b.lastUpdate) < 30 * 86400e3;
    return `
      <article class="card pinned">
        <div class="pin-zone">
          <span class="pin-badge"><svg style="width:11px;height:11px"><use href="#i-pin"/></svg>置顶 · 博主自己的博客</span>
          <div class="card-top">
            <a class="title" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)} <svg style="width:12px;height:12px;color:var(--ink-3)"><use href="#i-ext"/></svg></a>
            <span class="host">${esc(hostOf(b.url))}</span>
          </div>
          <div class="desc">${esc(b.desc || '')}</div>
          ${(b.tags || []).length ? `<div class="tags">${(b.tags || []).map((t) => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="card-foot">
          ${upd ? `<span class="upd ${fresh ? 'fresh' : ''}" title="最近更新：${esc(dayOf(b.lastUpdate))}"><span class="dot"></span>${esc(upd)}更新</span>` : ''}
          <span class="acts">
            ${b.rss ? `<button class="mini-btn" data-copy="${esc(b.rss)}" title="复制 RSS 地址" aria-label="复制 RSS 地址"><svg><use href="#i-copy"/></svg></button>
            <a class="mini-btn" href="${esc(b.rss)}" target="_blank" rel="noopener" title="打开 RSS 订阅"><svg><use href="#i-rss"/></svg></a>` : ''}
          </span>
        </div>
      </article>`;
  }

  function applyFilter() {
    const q = state.q.trim().toLowerCase();
    // the owner's blog is pinned before filtering so it always stays on top
    const pinned = all.filter(isPinned);
    const pool = all.filter((b) => !isPinned(b));
    const rest = pool.filter((b) => {
      if (state.tags.size) {
        for (const t of state.tags) if (!(b.tags || []).includes(t)) return false;
      }
      if (q) {
        const hay = (b.name + ' ' + (b.desc || '') + ' ' + hostOf(b.url) + ' ' + (b.tags || []).join(' ')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (state.sort === 'recent') {
      rest.sort((a, b2) => (Date.parse(b2.lastUpdate) || 0) - (Date.parse(a.lastUpdate) || 0));
    } else if (state.sort === 'stale') {
      rest.sort((a, b2) => (Date.parse(a.lastUpdate) || Infinity) - (Date.parse(b2.lastUpdate) || Infinity));
    } else if (state.sort === 'name') {
      rest.sort((a, b2) => a.name.localeCompare(b2.name, 'zh-Hans-CN'));
    }
    view = [...pinned, ...rest];

    resultCount.textContent =
      `共 ${all.length.toLocaleString()} 个博客 · 当前显示 ${view.length} 个` +
      (state.tags.size ? ` · ${state.tags.size} 个标签` : '') +
      (q ? ` · 搜索“${state.q.trim()}”` : '');
  }

  function renderChunk(reset = false) {
    if (reset) {
      grid.innerHTML = '';
      rendered = 0;
    }
    const frag = document.createElement('template');
    let html = '';
    let i = rendered;
    const end = Math.min(rendered + CHUNK, view.length);
    for (; i < end; i++) {
      const b = view[i];
      html += isPinned(b) ? pinnedHTML(b) : cardHTML(b, i - rendered);
    }
    frag.innerHTML = html;
    grid.appendChild(frag.content);
    rendered = end;
    const hasResults = view.length > pinnedCount;
    empty.style.display = hasResults ? 'none' : 'block';
  }

  /* ---------- chips ---------- */
  function buildChips() {
    const counts = new Map();
    for (const b of all) for (const t of b.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 26);
    let html = top
      .map(
        ([t, c]) =>
          `<button class="chip" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}<span class="cnt">${c}</span></button>`
      )
      .join('');
    html = `<button class="chip chip-clear" id="clearChips" style="display:none">清除标签 ✕</button>` + html;
    chips.innerHTML = html;
  }

  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.id === 'clearChips') {
      state.tags.clear();
    } else {
      const t = btn.dataset.tag;
      if (state.tags.has(t)) state.tags.delete(t);
      else state.tags.add(t);
    }
    syncChips();
  });

  function syncChips() {
    for (const btn of chips.querySelectorAll('.chip[data-tag]')) {
      btn.setAttribute('aria-pressed', state.tags.has(btn.dataset.tag) ? 'true' : 'false');
    }
    chips.querySelector('#clearChips').style.display = state.tags.size ? '' : 'none';
    applyFilter();
    renderChunk(true);
  }

  /* ---------- events ---------- */
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchInput.value;
      applyFilter();
      renderChunk(true);
    }, 120);
  });

  sortSel.addEventListener('change', () => {
    state.sort = sortSel.value;
    applyFilter();
    renderChunk(true);
  });

  grid.addEventListener('click', (e) => {
    const tagBtn = e.target.closest('.tag');
    if (tagBtn) {
      state.tags.clear();
      state.tags.add(tagBtn.dataset.tag);
      syncChips();
      chips.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      navigator.clipboard.writeText(copyBtn.dataset.copy).then(
        () => showToast('RSS 地址已复制 📋'),
        () => showToast('复制失败，请手动复制')
      );
    }
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    state.q = '';
    searchInput.value = '';
    state.tags.clear();
    syncChips();
  });

  document.getElementById('randomBtn').addEventListener('click', () => {
    const pool = view.length ? view : all;
    const b = pool[Math.floor(Math.random() * pool.length)];
    window.open(b.url, '_blank', 'noopener');
    showToast('随机带你去：' + b.name);
  });

  const themeBtn = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon');
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    themeIcon.querySelector('use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
    document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#171614' : '#faf9f6';
    try { localStorage.setItem('cib-theme', t); } catch {}
  }
  themeBtn.addEventListener('click', () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
  );
  let saved = null;
  try { saved = localStorage.getItem('cib-theme'); } catch {}
  if (saved) setTheme(saved);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  window.addEventListener('scroll', () => {
    toTop.classList.toggle('show', window.scrollY > 700);
  }, { passive: true });
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  let toastTimer;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ---------- infinite scroll ---------- */
  const sentinel = document.getElementById('sentinel');
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && rendered < view.length) renderChunk();
  }, { rootMargin: '800px 0px' });
  io.observe(sentinel);

  /* ---------- boot ---------- */
  async function boot() {
    try {
      const res = await fetch('data/blogs.json', { cache: 'no-cache' });
      const data = await res.json();
      all = data.blogs;
      meta = data;
    } catch (e) {
      grid.innerHTML = '<div class="empty">数据加载失败，请刷新重试</div>';
      return;
    }

    document.getElementById('stTotal').textContent = all.length.toLocaleString();
    document.getElementById('stRss').textContent = all.filter((b) => b.rss).length.toLocaleString();
    document.getElementById('stActive').textContent = all.filter(
      (b) => b.lastUpdate && Date.now() - Date.parse(b.lastUpdate) < 30 * 86400e3
    ).length.toLocaleString();
    const gen = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
    document.getElementById('stSync').textContent = `${gen.getMonth() + 1}/${gen.getDate()}`;
    document.getElementById('stSync').title = gen.toISOString().slice(0, 10) + ' 自动同步';
    document.getElementById('footSync').textContent = `数据同步于 ${gen.toISOString().slice(0, 10)}`;

    buildChips();
    pinnedCount = all.filter(isPinned).length;
    applyFilter();
    renderChunk(true);
  }

  boot();
})();
