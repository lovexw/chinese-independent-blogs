# 部署到 Cloudflare

站点是**纯静态**的（`public/` 目录，零依赖、零外部请求），有两种部署方式，任选其一。

## 方式 A：连接 Git 仓库（推荐，全自动）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选择本仓库（`lovexw/chinese-independent-blogs`），分支 `main`
3. 构建设置：
   - Framework preset: **None**
   - Build command: 留空（`public/` 已是构建产物；如需现场重建可填 `node scripts/build.mjs`）
   - Build output directory: `public`
4. 保存并部署，之后每次 push 到 `main` 会自动重新部署

## 方式 B：GitHub Actions 自动部署（wrangler 直传）

在仓库 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 在 Cloudflare → My Profile → API Tokens 创建，使用 "Edit Cloudflare Workers" 模板并追加 `Cloudflare Pages: Edit` 权限 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右侧栏可见 |
| Variable | `CLOUDFLARE_ENABLED` | 值设为 `true`，作为部署开关 |

配置完成后：

- 每周一的定时巡检（`.github/workflows/audit.yml`）会自动：同步上游新增博客 → 全量链接体检 → 修复失效地址 → 刷新 RSS 更新时间 → 提交 → 部署
- 也可以在 Actions 页面手动触发 "Weekly audit & sync"

## 本地部署（可选）

```bash
npx wrangler pages deploy public --project-name=chinese-independent-blogs
```

## 绑定自定义域名

Pages 项目 → **Custom domains** 添加你的域名，按提示加 CNAME 记录即可。

## 数据刷新节奏

| 内容 | 频率 | 执行者 |
| --- | --- | --- |
| 上游新增博客同步 | 每周 | `scripts/sync-upstream.mjs` |
| 链接可达性体检 | 每周 | `scripts/check-links.mjs` + `fix-dead.mjs` |
| RSS 最后更新时间 | 每周 | `scripts/rss-refresh.mjs` |
| README / OPML / 站点数据重建 | 每周（或 push 时手动 `npm run build`） | `scripts/build.mjs` |
