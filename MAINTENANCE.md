# 维护手册（MAINTENANCE）

> 本文档面向后续维护者 / AI 助手。目标是：任何人在任何时间接手，都能在 10 分钟内理解本仓库的结构、数据流、运维方式与历史决策，并且所有长任务断电/中断后都能安全续跑。
> 最后更新：2026-10-11

## 1. 这个仓库是什么

中文独立博客列表的**展示站点 + 数据维护管线**，源自 [timqian/chinese-independent-blogs](https://github.com/timqian/chinese-independent-blogs)。

- 线上站点：<https://chinese-independent-blogs.pages.dev>（Cloudflare Pages，项目名 `chinese-independent-blogs`，生产分支 `main`）
- GitHub 仓库：<https://github.com/lovexw/chinese-independent-blogs>
- 与上游关系：**只增量同步上游新增**，不回删我们的修复；死链不回加（见 §5 屏蔽机制）

## 2. 数据流（核心，务必先读）

```
blogs-original.csv ──► scripts/build.mjs ──► README.md + feed.opml + public/data/blogs.json + public/blogs.csv + public/feed.opml
       ▲                                        ▲
       │ apply fixes / remove dead / pin        │ read data/lastupdate.json (RSS 更新时间)
       │                                        │
scripts/check-links.mjs ──► data/check-results.json
scripts/fix-dead.mjs    ──► data/fixes.json        （urlFixes / rssFixes / dead / kept）
scripts/rss-refresh.mjs ──► data/lastupdate.json   （rss / lastUpdate / checkedAt）
scripts/flag-suspicious.mjs ──► data/suspicious.json + docs/manual-review.md
scripts/sync-upstream.mjs   ──► 追加新行到 blogs-original.csv
```

**`blogs-original.csv` 是唯一人工编辑的源头**（列：`Introduction, Address, RSS feed, tags`，逗号分隔，可带引号）。其余文件都是它的派生物 + 检测缓存。

## 3. 常用命令

```bash
node scripts/check-links.mjs        # 全量链接体检（约 3 分钟，可断点续跑）
node scripts/fix-dead.mjs           # 失效站点变体修复（约 2-4 分钟，可断点续跑）
node scripts/rss-refresh.mjs        # 刷新 RSS 最后更新时间（约 3 分钟，可断点续跑）
node scripts/rss-refresh.mjs --fix-missing   # 同上 + 对失效 RSS 做自动发现（较慢）
node scripts/flag-suspicious.mjs    # 内容级可疑检测 → docs/manual-review.md
node scripts/sync-upstream.mjs      # 上游增量同步（只增不删）
node scripts/build.mjs              # 重建 CSV/README/OPML/站点数据
node scripts/lint.mjs               # CSV 格式校验
node scripts/serve.mjs              # 本地预览 http://127.0.0.1:8347
npm run audit                       # = check + fix + rss + build（一条龙）
```

环境注意：本机（macOS）**没有 npm/npx**，只有 `node`（/usr/local/bin/node，v22）。wrangler 用全局安装：
`node /usr/local/lib/node_modules/wrangler/bin/wrangler.js`（4.81.1，已登录 0471666@gmail.com）。

## 4. 断点续传（断电记录）

三个长任务都有 checkpoint，**随时可 kill，重新运行同一条命令即从断点继续**：

| 脚本 | 断点文件 | 行为 |
| --- | --- | --- |
| check-links.mjs | `data/check-results.partial.json` | 每 50 条落盘；重跑自动跳过已查条目 |
| fix-dead.mjs | `data/fixes.partial.json` | 每 25 条落盘；重跑自动跳过已查条目 |
| rss-refresh.mjs | `data/lastupdate.partial.json` | 每 50 条落盘；重跑自动跳过已查条目 |

- 正常跑完会自动写最终文件并**删除**断点文件，所以 `data/*.partial.json` 存在 = 上次运行被中断。
- 加 `--fresh` 可无视/清除断点从头跑。
- `rss-refresh` 失败的 feed 会**保留**上次的时间和 RSS（避免网络抖动抹掉好数据）。

## 5. 关键机制与历史决策（不要随意改动）

1. **置顶**：`build.mjs` 里 `PIN_URL/PIN_KEY/PIN_RSS`（xiaowuleyi.com）。构建时该博客被强制移到列表第一行，站点端 `app.js` 里 `PIN_HOST` 再置顶渲染（即使搜索/筛选也显示在第一页顶部）。换域名需同时改这两处。
2. **fixes.json 是"记忆"**：`fix-dead` 每轮把新旧 fixes **合并**（旧修复不会丢），`sync-upstream` 用它屏蔽旧地址，防止上游把已迁移的旧 URL 当"新增"加回来。
3. **offline.json 是"墓园"**：死链从 CSV 移除后归档在此（含原因/日期），`sync-upstream` 据此**永不回加**；若站点复活（sync 的探测发现），会自动移出墓园并回到列表。
4. ** kept 类站点**：HTTP 401/402/403/406/407/416/429/456 视为"反爬但活着"（保留在列表）；TLS 证书异常的用 `curl -k` 复核后保留。它们同时会出现在 `docs/manual-review.md` 供人工核验。
5. **hostKey / rootOf**（lib.mjs）：hostKey = 去掉 `www.` 的主机名（去重键）；rootOf = 近似可注册域（`blog.a.com` 与 `www.a.com` 同根）。同步用"hostKey + root + 墓园 + 旧修复"四重屏蔽。
6. **人工核验清单**：`docs/manual-review.md` 由 `flag-suspicious.mjs` 生成（跳转/人机验证/停放/空页/证书异常）。人工确认失效后，直接在 CSV 删除该行并提交即可，下次巡检不会复活。
7. **更新时间判定 v2（2026-10-11，勿回退）**：只信"内容级日期"，不信"生成时间戳"——
   - **feed 信号只取 `<entry>/<item>` 内部的日期**（`lib.mjs#newestFeedItemDate`）；频道级 `<updated>`/`<lastBuildDate>` 一概不看。动态站点（如 Flask/Werkzeug 渲染的 feed，dongwm.com 即此类）每次请求都把频道级日期盖成"现在"，旧逻辑曾让陈年博客永远显示"刚刚更新"。
   - **sitemap 信号只取真实页面 URL 的 lastmod**（`lib.mjs#sitemapArticleDate`）：排除站点根路径、应用路由（/auth/*、/tags、/search 等约 30 类前缀）、全体 lastmod 同值的生成器盖戳；`<loc>` 含 HTML 转义的生成器 bug 输出直接丢弃。
   - **兜底守卫（仅对 sitemap）**：sitemap lastmod 比首页文章日期新 1 年以上、又恰好落在最近 60 天内 → 判定为动态盖戳，丢弃（证据留在 `update-audit.json` 的 `dropped` 字段供人工复核）。**feed 条目级日期不设守卫**：feed 的最新条目 = 最后发布（内容级证据），首页解析可能漏日期（JS 渲染等），拿首页否决真实新文章会错杀活跃博客（zhangxinxu 实测误杀，已修正）。
   - **未来日期钳制（2026-10-11 补充）**：feed/sitemap 里比当前时间晚 2 天以上的日期一律作废（`lib.mjs#clampDate`）——jyzhu.top、youkaichao.github.io 曾用 2199 年日期、iloli.moe 用 +70 天未来文章长期霸榜"最近更新优先"。**维护者政策：伪造/超前更新日期 = 移除 + 永久拉黑（offline.json 墓园，上游同步永不回加）**，2026-10-11 已拉黑 7 个（含 voidking.com、ccgxk.com、jack-liu.com、wiki.eryajf.net 四个 +4~22 天未来日期站）。**同日拉黑 ranjl.cn**：每日 cron 定时机器生成《学习问答》系列（批量 pubDate 秒级相同）刷活跃度，同属"机器活跃度 ≠ 博主活跃度"，一并移除拉黑。
   - 三信号仍取最大值，但先经过上面过滤。
7. **README.md 与 feed.opml 是生成物**：不要手改，改 `build.mjs` 的模板或改 CSV。

## 6. CI（GitHub Actions）

- `audit.yml`（每周一 UTC 02:17 ≈ 北京 10:17，可手动 workflow_dispatch 触发）：
  同步上游 → 体检 → 修复 → 刷新 RSS 时间 → 可疑检测 → 重建 → 自动 commit → **push 后 Cloudflare Pages 自动部署**（Git 集成，无需 secrets）。
- `pr_lint.yml`：PR 触发 `node scripts/lint.mjs`。

## 7. 部署（2026-10-11 起自托管于甲骨文 146，CF Pages 转为热备回滚）

**当前状态：站点 + 提交收录 API + 每周巡检全部跑在甲骨文 146（us-sanjose-1，x86 Micro 1G，`ubuntu@146.235.227.201`，key 在本机 `~/Documents/SSH/JGW-146-235-227-201.key`）。**

```
浏览器 → Cloudflare 橙云代理 → Caddy(146 宿主, 80/443, DNS-01 证书)
   list.bloghao.com
   ├─ /            → 127.0.0.1:8347  静态站点（cib-site 容器, serve.mjs）
   ├─ /api /admin  → 127.0.0.1:8348  提交收录 API + 审核后台（同容器 submit-api.mjs）
   └─ 容器内 crond 每周一 10:17 跑 docker/audit-job.sh（巡检→build→git push）
```

- **部署目录**：服务器 `~/apps/cib`（git clone + `.env` 放 GH_PAT / ADMIN_PASSWORD，600 权限）；改代码后 `git pull && docker compose up -d --build`。
- **管理后台（已集成进 ops 面板）**：<https://ops.bloghao.com/blog-admin/>（Caddy 把 `/blog-admin/*` 反代到 cib 容器 8348；用户名 `list_admin`，密码在服务器 `~/apps/cib/.env`）。三标签页：待审提交（A/B/C 预判+一键通过/拒绝）、博客管理（全站搜索+编辑+删除可选拉黑入墓园）、访问统计（匿名 PV+外链点击，信标上报，不存 IP）。旧入口 `list.bloghao.com/admin` 301 到新地址。
- **用户提交**：<https://list.bloghao.com/submit.html>，防垃圾四层见 `docs/docker.md`；提交队列在服务器数据卷 `data/submissions.json`（含 IP，已 gitignore，永不入库）。
- **每周巡检**：容器内 crond 触发，接管原 GitHub Actions `audit.yml`（其 schedule 已停用，仅保留 workflow_dispatch 手动备份）。巡检与审核上架用 `data/.cib-git.lock` 目录锁互斥。
- **坑（务必记住）**：bloghao.com zone 的 SSL 模式是 **Flexible（CF 回源走 80 明文）**。Caddy 里每个新站点的 `http://` 块必须**直接反代**、不能 301 跳 https，否则边缘会陷入自重定向死循环（hub/plaza 的注释就是这个坑，list.bloghao.com 已照做）。
- **hub.bloghao.com / plaza.bloghao.com 均已退役（2026-10-11，维护者决定）**：Caddy 站点块与 DNS A 记录均已删除。**广场数据面新位置 = 官网 `bloghao.com/plaza/api/*`**（Caddy strip_prefix 后反代 8790 plaza-hub 容器），以官网为准。
- **安全基线（2026-10-11 体检）**：
  - 所有应用端口只绑 127.0.0.1（8347/8348/8787/8790），对外仅宿主 Caddy 的 80/443；`.env` 600 权限；仓库无明文密钥（`deploy/Caddyfile.prod` 为配置快照，token 走 systemd env）。
  - 后台登录：用户名+密码（timingSafeEqual）+ HMAC 会话 cookie（HttpOnly/SameSite=Strict/12h/https 下带 Secure）+ **防爆破**（单 IP 失败 5 次锁 15 分钟 + 全站 1 小时 30 次熔断——XFF 可被直连源站伪造，单 IP 锁可被绕，全站熔断兜底）。
  - 提交接口：蜜罐 + 每 IP 8 次/天 + 全站 60 次/天 + 双重查重 + 人工审核；未来/伪造日期在解析层直接作废。
  - 已知取舍：`/api/hit` 统计信标无鉴权（可被刷高计数，仅影响统计观感不影响数据正确性，接受）；直连源站可伪造 XFF 刷提交限频（有蜜罐+人工审核兜底，接受）。
  - 建议（未执行，属 CF 账号层）：CF API Token 与控制台密码如怀疑泄露可在 CF 后台轮换。
- **备份**：`deploy/backup.sh` 已装入服务器宿主 crontab（每周日 03:17）——cib 数据/产物卷 + xwblog 数据 + Caddyfile 快照到 `~/backups`，保留 6 份。恢复：tar 解包后拷回对应卷。
- **ops 面板入口补丁**：面板源码在镜像内，导航「博客列表」按钮靠 `~/apps/xwblog/ops-patch/server.js` + compose volume 挂载实现；面板镜像升级后按 `deploy/ops-patch.py` 注释重新打一次。
- **长期运行**：cib 容器 mem_limit 768m + docker 日志轮转（10m×3）；巡检脚本全部断点续传；数据源是 git 仓库本身（每周审计自动提交 = 异地备份）；swap 2G；磁盘余量 37G+。甲骨文免费实例注意保持一定活跃度（本机跑着 4 个服务 + 每周审计，远高于回收线）。

**Cloudflare Pages（保留作回滚通道，未删除）**：项目 `chinese-independent-blogs` 仍绑定 Git，push 到 `main` 仍会自动部署 Pages；`chinese-independent-blogs.pages.dev` 与 `bloghao.xiaowuleyi.com` 仍指向 Pages。

### 回滚（如需退回 CF Pages）

1. 把 `list.bloghao.com` 的 DNS 记录（zone `bloghao.com`，记录 id `9a42bb69-8742…` 完整 id 在 CF Dashboard）从 A `146.235.227.201` 改回 CNAME `chinese-independent-blogs.pages.dev`（保持橙云）
2. 若边缘不生效，到 Pages 项目 → Custom domains 重新 add `list.bloghao.com`
3. Pages 内容 = 仓库 `public/`（每次 push 都在自动部署），回滚即恢复

### 如果要在 Pages 时代恢复"纯静态"运维（历史参考）

- Git 绑定的项目**拒绝 wrangler 直传**，请直接 push 或在 Dashboard 手动重试部署
- 构建配置：无构建命令、输出目录 `public`（public/ 已预构建提交进仓库）
- 换了站点域名要同步更新 `data/site-url.txt`（README 顶部链接用它）

## 8. 站点前端（public/）

- 零依赖、零外部请求，`index.html + assets/style.css + assets/app.js + data/blogs.json`。
- 分页：每页 100 条，页码 + 手动跳页；筛选状态写入 URL hash（`#q=…&tags=…&sort=…&page=…`），可分享/刷新保持。
- 置顶卡、深色模式（localStorage `cib-theme`）、`/` 聚焦搜索、复制 RSS。
- 数据字段（public/data/blogs.json）：`{generatedAt, total, blogs:[{name,url,rss,desc,tags,lastUpdate}]}`；`lastUpdate` 为 null = 未抓到 RSS 时间。

## 9. 已知问题 / 待办（给下一个维护者）

- [ ] `docs/manual-review.md` 中 287 个可疑博客等待人工核验（2026-10-02 生成），确认失效的从 CSV 删除。
- [ ] 博主博客（emlog）的 `rss.php` 服务端 SQL 报错（`gid!=` 语法错误），修好后列表可显示其更新时间。
- [ ] `lastupdate.json` 覆盖率约 77%；可考虑：feed 超时加大、Wayback Machine 兜底、按域名聚合重试。
- [ ] 可选增强：站点加 sitemap.txt / RSS 输出聚合（列出所有博客最新文章）、卡片截图预览、按更新时间自动排序的"本周活跃"榜。
- [ ] 上游若改 CSV 列结构，需同步改 `lib.mjs#loadBlogs` 和 `sync-upstream.mjs`。

## 10. 变更日志摘要

| 日期 | 事项 |
| --- | --- |
| 2026-10-02 | 首次全量体检（1493→1309，归档 182 死链，修复 49 地址）；站点上线；CI 建立 |
| 2026-10-02 | 分页改造（100/页）、标签完整显示、可疑内容检测（287 个待人工核验）、断点续传 |
| 2026-10-02 | **Cloudflare Pages 绑定 GitHub 仓库**（直传项目删除后同名重建，域名不变），push 即自动部署 |
| 2026-10-02 | **287 个可疑博客深度复核**：删除 11 个确认死站（7 个被抢注跳博彩/SEO 站、2 个停放、2 个失联）、修正 41 个迁移地址（DIYGod→diygod.cc 等）；修复两处误判引擎（Wayback 限流误判、'sedo' 子串误伤），69 个误删恢复保留；现收录 1297，manual-review.md 剩 241 待人工复核 |
| 2026-10-03 | **沉睡博客降级机制**：默认排序按 活跃→沉睡(2年+)→未知 三层沉底，沉睡卡片带 💤 标注，统计栏新增沉睡数；新增 `scripts/stale-report.mjs` 每周生成 `docs/stale-blogs.md`（当前 148 个确认 2 年+未更新，供维护者酌情剔除，不自动删） |
| 2026-10-03 | **自定义域名上线**：维护者将 bloghao.com zone 迁入本账号并挂载 `list.bloghao.com` 与 `bloghao.xiaowuleyi.com`（均 active）；站点线上地址定为 `https://list.bloghao.com`（pages.dev 在大陆被 DNS 污染，国内访问务必用自定义域名） |
| 2026-10-03 | **多信号更新时间审计**（`scripts/update-audit.mjs`，已接入每周 CI）：RSS 地址错位是主要误判源——feed 重推导 + 首页文章日期 + sitemap lastmod 三信号取最大值；评论 feed 与相对日期刻意排除（防假新鲜）。首次全量审计：133 个"复活"（含可能吧 kenengba.com 2024-01→2026-10）、10 个新沉睡、613 个日期修正、115 个 RSS 错位修正；未知数 293→160。审计前 148 沉睡 → 审计后 155（方法与全量证据链见 `docs/update-audit.md` 与 `data/update-audit.json`） |
| 2026-10-03 | 程序猿DD 博客迁移 blog.didispace.com→didispace.com（新站暂无 RSS，RSS 置空）；移除 2 博客：bang's blog（主机账户被暂停）、哲●科●文Jerkwin（维护者决定移除，站点仍在线）；`sync-upstream` 复活探测增加 cPanel 暂停页识别（suspendedpage.cgi 200 ≠ 复活）；现收录 1295 |
| 2026-10-11 | 上游周同步（本机手动跑）：新增 69、复活 16、归档 8、去重 1，现收录 1371；`lint` 通过 |
| 2026-10-11 | **更新时间判定升级 v2**：修复"陈年博客显示刚刚更新"——动态站点（Flask 等）的 feed 频道级 `<updated>` 和 sitemap 应用路由 lastmod 每次抓取都被盖成当前时间，旧逻辑取最大值时被假日期赢过真实文章日期（dongwm.com 即实例：真实 2023-05-16 被显示为"刚刚更新"）。新标准：feed 只取条目级日期、sitemap 过滤根路径/应用路由/同值盖戳、另有"比首页新 1 年+落在近 60 天"兜底守卫；上次审计受影响博客约 12+，全量重跑已纠正（见 §5 第 7 条） |
| 2026-10-11 | **版本固化 v2.1.0 + 安全体检 + 长期稳定措施**：登录接口加防爆破（单 IP 5 次锁 15 分钟 + 全站熔断，防 XFF 伪造绕过）；会话 cookie https 下带 Secure；容器加 docker 日志轮转（10m×3）防磁盘膨胀；`deploy/backup.sh` 装入宿主 crontab（每周日备份 cib 数据卷/xwblog 数据/Caddyfile 到 ~/backups 保留 6 份）；`deploy/` 存档生产 Caddyfile 快照与 ops 面板入口补丁再应用脚本；git tag `v2.1.0` |
| 2026-10-11 | **未来日期作弊清零**：发现 7 个博客用 2199 年或未来 4~70 天的日期霸榜"最近更新优先"（jyzhu.top、youkaichao.github.io、iloli.moe、voidking.com、ccgxk.com、jack-liu.com、wiki.eryajf.net）；判定链补上"未来 2 天以上日期作废"钳制，7 站全部移除并写入墓园永久拉黑（维护者决定）；同日 ranjl.cn 因 cron 机器日更《学习问答》刷活跃度一并移除拉黑 |
| 2026-10-11 | **机器更新批量扫描**：新增 `scripts/machine-scan.mjs`（cron 秒级指纹 + 标题模板化双指纹，已纳入每周巡检**仅收集证据不自动杀站**）。扫最近 3 天有更新的 165 站：双指纹命中 8 站经内容验尸**全部为人类博客**（定时发布+系列标题会命中双指纹，如体验碎周报/近思录——自动判定不可作杀站依据）；42 待复核中揪出 1 对重复收录（lulalap.com 301 迁移至 philoli.com，RSS 同指一处），已去重，现收录 **1358**。经验：`00:00:00` 整点时间戳=只写日期的约定；杀站必须看正文 |
| 2026-10-11 | **全面自托管上线（甲骨文 146）**：Docker 单容器三进程（静态站 8347 + 提交收录 API 8348 + 每周巡检 crond）；Caddy 挂 `list.bloghao.com`（http/https 双块直反代，绕开 Flexible SSL 回源 80 的坑）；DNS 从 Pages CNAME 切为 A 记录（保持橙云），Pages 解绑自定义域、保留为回滚热备；`audit.yml` 的每周 schedule 停用（巡检迁至服务器）；上线用户提交收录（`submit.html` + 四层防垃圾 + `/admin` 人工审核，审核通过自动写 CSV→build→push）；全链路（提交→审核→上架→push→回滚清理）已验收，现收录 1367 |
