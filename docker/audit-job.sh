#!/bin/sh
# 单轮巡检任务：sync → check → fix → rss → suspicious → stale → audit-update → build → (可选 push)
# 可通过 AUDIT_TASKS 环境变量裁剪步骤（逗号分隔，默认全部）
set -u
cd /app
export GIT_ASKPASS=/app/docker/askpass.sh
export GIT_TERMINAL_PROMPT=0

log() { echo "[audit-job] $(date '+%F %T') $*"; }

WANT="${AUDIT_TASKS:-sync check fix rss suspicious stale audit-update build}"
has() { echo ",$WANT," | grep -q ",$1,"; }

# 断点续传：rss/check/fix 都支持重跑继续；这里不清理 partial，让中断后的下一轮自动续
if has sync;     then log "step: sync-upstream";     node scripts/sync-upstream.mjs     || log "sync failed (continue)"; fi
if has check;    then log "step: check-links";       node scripts/check-links.mjs       || log "check failed (continue)"; fi
if has fix;      then log "step: fix-dead";          node scripts/fix-dead.mjs          || log "fix failed (continue)"; fi
if has rss;      then log "step: rss-refresh";       node scripts/rss-refresh.mjs       || log "rss failed (continue)"; fi
if has suspicious; then log "step: flag-suspicious"; node scripts/flag-suspicious.mjs   || log "suspicious failed (continue)"; fi
if has stale;    then log "step: stale-report";      node scripts/stale-report.mjs      || log "stale failed (continue)"; fi
if has audit-update; then log "step: update-audit";  node scripts/update-audit.mjs --apply && node scripts/update-audit-report.mjs || log "update-audit failed (continue)"; fi
if has build;    then log "step: build";             node scripts/build.mjs             || log "build failed (abort push)"; fi

log "audit round finished"

# ---------- 可选：把巡检产物提交并推送 ----------
if [ "${AUTO_PUSH:-0}" != "1" ]; then
  log "AUTO_PUSH disabled, skip push"
  exit 0
fi

if [ ! -d .git ]; then
  log "no .git in /app, skip push (read-only deploy mode)"
  exit 0
fi

git add -A
if git diff --cached --quiet; then
  log "no changes to push"
  exit 0
fi
git commit -m "chore: automated audit $(date '+%F')" || { log "commit failed"; exit 1; }
if git push origin "${GIT_BRANCH:-main}"; then
  log "pushed to ${GIT_BRANCH:-main} (Cloudflare Pages will deploy)"
else
  # 网络抖动/远端前进：rebase 后重试一次，仍失败就留到下一轮
  log "push failed, retry after 60s"
  sleep 60
  git pull --rebase origin "${GIT_BRANCH:-main}" || log "pull failed"
  git push origin "${GIT_BRANCH:-main}" && log "pushed (retry ok)" || log "push failed again, will retry next round"
fi
