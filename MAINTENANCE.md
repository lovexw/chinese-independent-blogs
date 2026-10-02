# 维护手册（MAINTENANCE）

> 本文档面向后续维护者 / AI 助手。目标是：任何人在任何时间接手，都能在 10 分钟内理解本仓库的结构、数据流、运维方式与历史决策，并且所有长任务断电/中断后都能安全续跑。
> 最后更新：2026-10-02

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
7. **README.md 与 feed.opml 是生成物**：不要手改，改 `build.mjs` 的模板或改 CSV。

## 6. CI（GitHub Actions）

- `audit.yml`（每周一 UTC 02:17 ≈ 北京 10:17，可手动 workflow_dispatch 触发）：
  同步上游 → 体检 → 修复 → 刷新 RSS 时间 → 可疑检测 → 重建 → 自动 commit → **push 后 Cloudflare Pages 自动部署**（Git 集成，无需 secrets）。
- `pr_lint.yml`：PR 触发 `node scripts/lint.mjs`。

## 7. 部署（已绑定 Git，全自动）

**当前状态：Cloudflare Pages 项目 `chinese-independent-blogs` 已通过 GitHub App 绑定 `lovexw/chinese-independent-blogs`（生产分支 `main`，输出目录 `public`，无构建命令）。push 到 main 即自动部署，无需任何手动操作。**

- 绑定方式：GitHub App（Cloudflare Pages）已有该仓库授权；项目经由 API 以 `source: github` 方式创建（直传项目无法转 Git 绑定，是删除后同名重建的，`chinese-independent-blogs.pages.dev` 域名不变）。
- PR 会生成预览部署（preview deployments 开启，对所有分支生效）。
- 若需本地临时部署：Git 绑定的项目**拒绝 wrangler 直传**，请直接 push 或在 Dashboard 手动重试部署。
- 若要改构建配置：Dashboard → Pages → 项目 → Settings → Builds & deployments（构建命令留空、输出目录 `public` 即可，public/ 已预构建提交进仓库）。
- 绑定自定义域名：Dashboard → Pages → 项目 → Custom domains。
- 换了站点域名要同步更新 `data/site-url.txt`（README 顶部链接用它）。

### 如果绑定失效（例如仓库改名/转移）怎么恢复

1. 确认 GitHub App（Cloudflare Pages）仍授权该仓库：<https://github.com/apps/cloudflare-pages> → Configure → Repository access
2. Dashboard 删除 Pages 项目，重新 Connect to Git，或用 API 以 `source: github` 重建同名项目（构建配置：无构建命令、输出目录 `public`）
3. push 任意提交触发首次部署

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
