# Docker 自托管部署指南

把整个列表站点 + 提交收录 API + 每周巡检管线跑在自己的服务器上（单容器，三个进程）。
本部署已接管原 GitHub Actions 的每周审计（`audit.yml` 的 cron 已停用）。

## 架构

```
Caddy (宿主, TLS/DNS-01) ── list.bloghao.com
  ├─ /                    → 127.0.0.1:8347  静态站点 (scripts/serve.mjs)
  ├─ /api/*  /admin*      → 127.0.0.1:8348  提交收录 API + 审核后台 (scripts/submit-api.mjs)
  └─ crond → 每周一 10:17 audit-job.sh（巡检 → 重建 → git push）
```

## 快速开始

```bash
# 1. 准备 .env
cat > .env <<'EOF'
# GitHub PAT（fine-grained，只授 chinese-independent-blogs 的 Contents: Read and write）
# 创建地址: https://github.com/settings/tokens?type=beta
GH_PAT=github_pat_xxxx
# 审核后台密码（/admin 登录用）
ADMIN_PASSWORD=换成强密码
# 可选：Cloudflare Turnstile 人机验证（防机器人加强）
# TURNSTILE_SITE_KEY=0x4AAA...
# TURNSTILE_SECRET=0x4AAA...
EOF

# 2. 构建并启动
docker compose up -d --build

# 3. 验证
curl http://127.0.0.1:8347/          # 站点
curl http://127.0.0.1:8348/api/health  # 提交 API
```

## 容器里跑什么

| 进程 | 说明 |
| --- | --- |
| `node scripts/serve.mjs` | 静态站点（端口 `PORT`=8347） |
| `node scripts/submit-api.mjs` | 用户提交收录 API + `/admin` 审核后台（端口 `API_PORT`=8348，崩溃 5s 自动拉起） |
| `crond` → `docker/audit-job.sh` | 按 `AUDIT_CRON` 巡检：sync → check → fix → rss → suspicious → stale → audit-update → build → push |

三个进程共用一个仓库工作区（`/app`），巡检与审核上架通过 `data/.cib-git.lock` 目录锁互斥。

## 用户提交收录（防垃圾四层）

1. **蜜罐**：表单隐藏字段 `website2`，机器人填写即丢弃（返回假成功，不暴露任何信号）
2. **限频**：所有请求计数（含蜜罐命中），默认每 IP 8 次/天、全站 60 次/天
3. **格式与查重**：URL 合法性校验；与现有列表、墓园（offline.json）、迁移历史（fixes.json）、待审队列做 hostKey + 主域双重去重（与 sync-upstream 同一套逻辑）
4. **实时体检**：提交时探测站点与 RSS，给出 A/B/C 预判（停放页/博彩关键词/cPanel 暂停页识别），**最终由人工在 `/admin` 一键通过/拒绝**

通过后自动：追加 `blogs-original.csv` → `build.mjs` 重建（站点即时生效）→ `lint` 校验 → git commit + push。
任何一步失败自动回滚 CSV。提交数据（含 IP）只存在服务器 `data/submissions.json`，已加入 `.gitignore`，不入库。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` / `API_PORT` | 8347 / 8348 | 站点 / 提交 API 监听端口 |
| `TZ` | Asia/Shanghai | cron 时区 |
| `AUDIT_CRON` | `17 2 * * 1` | 巡检计划（标准 5 段 crontab） |
| `AUDIT_TASKS` | 全部 | 裁剪巡检步骤，逗号分隔 |
| `AUDIT_ON_START` | `0` | 容器启动时立即跑一轮 |
| `AUTO_PUSH` | `1` | 巡检有变更时自动 commit+push |
| `GIT_REPO` / `GIT_BRANCH` | lovexw/chinese-independent-blogs / main | 推送目标 |
| `GH_PAT` | 必填 | GitHub PAT（巡检推送 + 审核上架共用） |
| `ADMIN_PASSWORD` | 必填 | `/admin` 审核后台密码；不设则提交 API 不启动 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | 空 | Turnstile 人机验证，配了即启用 |
| `RATE_IP_DAILY` / `RATE_GLOBAL_DAILY` | 8 / 60 | 提交限频 |

## 审核后台

`https://list.bloghao.com/admin`（或 `http://127.0.0.1:8348/admin`），密码登录，展示待审提交的
A/B/C 预判与证据（可达性/RSS/可疑信号/提交 IP），一键通过或拒绝。通过后站点数秒内更新。

## 数据持久化

- `cib-data` volume：巡检缓存/断点（`data/*.partial.json`）、提交队列（`data/submissions.json`）
- `cib-public` volume：构建产物，站点实时读取
- 容器重建后 `.git` 由 entrypoint 自动从远端重新 seed（shallow clone），工作区以镜像内容为准

## 与 Cloudflare 的关系

- **DNS**：`list.bloghao.com` A 记录指向服务器，保持 CF 橙云代理（CF 终结 TLS，回源 Caddy）
- **回滚**：把 DNS 记录改回 CNAME `chinese-independent-blogs.pages.dev` 即回 CF Pages（Pages 项目保留未删）
- 仓库 push 仍会触发 Pages 部署（无妨，回滚通道保持热备）
