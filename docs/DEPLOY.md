# 部署说明

**当前状态：本项目已通过 GitHub App 绑定 Cloudflare Pages（项目 `chinese-independent-blogs`，生产分支 `main`，输出目录 `public`）。push 到 `main` 自动部署，无需手动操作；PR 自动生成预览部署。**

以下内容仅在需要重建绑定或调整配置时有用。

## 绑定信息

| 项 | 值 |
| --- | --- |
| Pages 项目名 | `chinese-independent-blogs` |
| Git 仓库 | `lovexw/chinese-independent-blogs` |
| 生产分支 | `main` |
| 构建命令 | （留空，`public/` 已预构建提交进仓库） |
| 构建输出目录 | `public` |
| 预览部署 | 所有分支 |

## 自定义域名

Pages 项目 → **Custom domains** 添加你的域名，按提示加 CNAME 记录即可。

## 若需重建绑定

1. 确认 GitHub App 授权：<https://github.com/apps/cloudflare-pages> → Configure → Repository access
2. 注意：**直传（Direct Upload）创建的 Pages 项目无法转为 Git 绑定**，需要删除后以 Git 方式重建（同名重建可保留 `*.pages.dev` 域名）
3. push 任意提交触发首次部署；详见 `MAINTENANCE.md` §7

