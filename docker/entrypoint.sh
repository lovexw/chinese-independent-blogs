#!/bin/sh
# 容器入口：启动静态站点服务 + 用内置 crond 做定时巡检
# 凭据：GH_PAT 只经环境变量进入容器，通过 GIT_ASKPASS 应答 git，不写入任何文件/URL
set -eu

log() { echo "[entrypoint] $(date '+%F %T') $*"; }
export GIT_ASKPASS=/app/docker/askpass.sh
export GIT_TERMINAL_PROMPT=0

# ---------- 可选：启动时立刻跑一轮巡检 ----------
if [ "${AUDIT_ON_START:-0}" = "1" ]; then
  log "AUDIT_ON_START=1, running initial audit in background"
  (/app/docker/audit-job.sh || true) &
fi

# ---------- 自动推送回 GitHub（可选）----------
if [ "${AUTO_PUSH:-0}" = "1" ]; then
  if [ -z "${GH_PAT:-}" ]; then
    log "WARN: AUTO_PUSH=1 but GH_PAT is not set; auto-push disabled"
    AUTO_PUSH=0
  else
    git config --global user.name "${GIT_AUTHOR_NAME:-cib-bot}"
    git config --global user.email "${GIT_AUTHOR_EMAIL:-cib-bot@users.noreply.github.com}"
    git config --global --add safe.directory /app
    if [ ! -d /app/.git ]; then
      log "seeding .git from remote (shallow clone)"
      if git clone --depth 1 --branch "${GIT_BRANCH:-main}" \
           "https://github.com/${GIT_REPO:-lovexw/chinese-independent-blogs}.git" /tmp/seed; then
        mv /tmp/seed/.git /app/.git
        rm -rf /tmp/seed
        cd /app
        git remote set-url origin "https://github.com/${GIT_REPO:-lovexw/chinese-independent-blogs}.git"
        git reset -q
        log ".git seeded; working tree = image content"
      else
        log "WARN: seed clone failed (network/token?); push disabled for this run"
        AUTO_PUSH=0
      fi
    fi
  fi
fi

# ---------- 定时任务 ----------
echo "${AUDIT_CRON:-17 2 * * 1} /bin/sh /app/docker/audit-job.sh >> /proc/1/fd/1 2>&1" | crontab -
log "cron registered: ${AUDIT_CRON:-17 2 * * 1} (tasks: ${AUDIT_TASKS:-default}, push: ${AUTO_PUSH:-0})"

crond -b -l 8

# ---------- 提交收录 API + 审核后台（崩溃自动拉起）----------
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  log "starting submit api on port ${API_PORT:-8348}"
  (
    while true; do
      PORT="${API_PORT:-8348}" node scripts/submit-api.mjs >> /proc/1/fd/1 2>&1
      log "submit api exited, restarting in 5s"
      sleep 5
    done
  ) &
else
  log "ADMIN_PASSWORD not set, submit api disabled"
fi

log "starting site server on port ${PORT:-8347}"
exec "$@"
