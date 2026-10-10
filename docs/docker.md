# Docker 自托管部署指南

把整个列表站点 + 巡检管线跑在你自己的服务器上，容器内定时巡检并可选把结果推送回 GitHub（push 后 Cloudflare Pages 照常自动部署线上站）。

## 快速开始

```bash
# 1. 准备 token（AUTO_PUSH=1 时必填）
#    GitHub → Settings → Developer settings → Fine-grained personal access tokens
#    只授权 chinese-independent-blogs 仓库的 Contents: Read and write
echo 'GH_PAT=github_pat_xxxx' > .env

# 2. 构建并启动
docker compose up -d --build

# 3. 访问
curl http://127.0.0.1:8347/
```

## 它在容器里做什么

| 进程 | 说明 |
| --- | --- |
| `node scripts/serve.mjs` | 静态站点服务（前台主进程，端口 `PORT`，默认 8347） |
| `crond` | 按 `AUDIT_CRON` 触发 `docker/audit-job.sh` 巡检 |
| `audit-job.sh` | 顺序执行：sync → check → fix → rss → suspicious → stale → audit-update → build → 可选 push |

巡检脚本全部支持断点续传（`data/*.partial.json`），容器重启后下一轮自动接着跑。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8347` | 站点监听端口 |
| `TZ` | `Asia/Shanghai` | cron 时区 |
| `AUDIT_CRON` | `17 2 * * 1` | 巡检计划（标准 5 段 crontab） |
| `AUDIT_TASKS` | 全部 | 裁剪巡检步骤，逗号分隔 |
| `AUDIT_ON_START` | `0` | 容器启动时立即跑一轮 |
| `AUTO_PUSH` | `1` | 巡检有变更时自动 commit+push |
| `GIT_REPO` | `lovexw/chinese-independent-blogs` | 推送目标仓库 |
| `GIT_BRANCH` | `main` | 推送目标分支 |
| `GH_PAT` | 必填（AUTO_PUSH=1） | GitHub PAT |

## 定制建议（你后续要改的地方）

- **反向代理**：容器只暴露 HTTP，建议前面挂 Caddy/Nginx 做 TLS 与域名。
- **只要站点不要巡检**：`AUDIT_TASKS: "build"` 或 `AUDIT_CRON: "0 0 31 2 *"`（不会触发的日期）。
- **纯展示（无 GitHub 推送）**：`AUTO_PUSH: "0"`，`GH_PAT` 可省略。
- **数据持久化**：`cib-data` / `cib-public` 两个 volume 已挂好；想直接用宿主机目录就改成 bind mount。

## 与 Cloudflare Pages 的关系

容器内的巡检推送 = 仓库 CI（audit.yml）的人工触发替代品，两者幂等可并存：

- push 到 main → Cloudflare Pages 自动部署线上站（Git 集成，无需配置）。
- 若同时开着 GitHub Actions 的每周巡检，两边都是"先比对再写"，通常无冲突；嫌重复可在 GitHub 仓库 Settings → Actions 里 disable `audit.yml`。

## 常见问题

- **巡检中途容器被杀**：安全。重跑自动从断点继续，`data/*.partial.json` 存在即表示上次未完成。
- **push 被拒（远端前进）**：audit-job 会 `pull --rebase` 后重试一次，仍失败则留到下一轮。
- **RSS 覆盖率偏低**：按 MAINTENANCE.md 的待办，可加 `--fix-missing`（在 `AUDIT_TASKS` 里把 rss 步骤换成手动执行 `node scripts/rss-refresh.mjs --fix-missing`，或后续在容器环境变量里支持）。
