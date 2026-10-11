# 中文独立博客列表 · 自托管容器版
# 站点服务 + 定时巡检（check/fix/rss/audit/build）在同一容器内完成
FROM node:22-alpine

# git 用于可选的巡检后自动提交推送；tzdata 让 AUDIT_CRON 按 TZ 生效
RUN apk add --no-cache git tzdata curl

WORKDIR /app
ENV PORT=8347 \
    TZ=Asia/Shanghai \
    AUDIT_CRON="17 2 * * 1" \
    AUDIT_TASKS="sync check fix rss suspicious stale audit-update build" \
    AUTO_PUSH=1

# 全量拷贝仓库（.dockerignore 排除 .git/.env/垃圾）：保证镜像工作区与 git HEAD 完全一致，
# 审核上架的 git pull --rebase 才不会因“未暂存变更”被拒；data/public 运行时被 volume 覆盖
COPY . .

# 容器内运行时的可变产物目录（配合 volume 持久化）
RUN mkdir -p /app/data /app/public/data

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /app/docker/audit-job.sh /app/docker/askpass.sh \
    && git config --global --add safe.directory /app

EXPOSE 8347 8348

HEALTHCHECK --interval=5m --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "scripts/serve.mjs"]
