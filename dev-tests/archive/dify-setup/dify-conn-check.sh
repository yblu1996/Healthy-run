#!/bin/bash
echo "=== api -> plugin_daemon connections (port 5002) ==="
docker exec docker-api-1 cat /proc/net/tcp | awk 'NR>1 {split($3,a,":"); ip=a[1]; port=strtonum("0x" a[2]); if (port==5002 && $4=="01") print $2, $3, "ESTABLISHED"}' | head -5
echo "=== plugin_daemon established connections ==="
docker exec docker-plugin_daemon-1 cat /proc/net/tcp | awk 'NR>1 {split($3,a,":"); port=strtonum("0x" a[2]); if ($4=="01") print port}' | sort | uniq -c | sort -rn | head -8
echo "=== plugin_daemon recent logs (non-middleware) ==="
docker logs docker-plugin_daemon-1 --since 6m 2>&1 | grep -viE 'middleware|install/tasks|installation' | tail -8
