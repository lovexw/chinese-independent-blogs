#!/bin/sh
# 服务器周备份（宿主 crontab 每周日 03:17 调用）：数据卷 + xwblog 数据 + Caddyfile
# 保留最近 6 份，超出自动清理。恢复：tar xzf <file> -C /tmp && 按需拷回卷。
set -e
TS=$(date +%F)
DIR=/home/ubuntu/backups
mkdir -p "$DIR"
docker run --rm -v cib_cib-data:/data:ro -v "$DIR":/backup alpine tar czf "/backup/cib-data-$TS.tar.gz" -C /data .
docker run --rm -v cib_cib-public:/data:ro -v "$DIR":/backup alpine tar czf "/backup/cib-public-$TS.tar.gz" -C /data .
tar czf "$DIR/xwblog-data-$TS.tar.gz" -C /home/ubuntu/apps/xwblog data tenants.json docker-compose.yml ops-patch 2>/dev/null || true
sudo cp /etc/caddy/Caddyfile "$DIR/Caddyfile-$TS"
find "$DIR" -type f -name "*$TS*" >/dev/null
ls -1t "$DIR"/cib-data-*.tar.gz 2>/dev/null | tail -n +7 | xargs -r rm -f
ls -1t "$DIR"/cib-public-*.tar.gz 2>/dev/null | tail -n +7 | xargs -r rm -f
ls -1t "$DIR"/xwblog-data-*.tar.gz 2>/dev/null | tail -n +7 | xargs -r rm -f
echo "backup done: $TS"
