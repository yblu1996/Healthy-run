#!/bin/bash
# 抓 api 容器内所有 gunicorn worker 的 Python 堆栈
echo "=== worker PIDs ==="
docker exec docker-api-1 sh -c 'for d in /proc/[0-9]*; do cmd=$(tr "\0" " " < $d/cmdline 2>/dev/null); case "$cmd" in *gunicorn*w*) echo ${d#/proc/};; esac; done'
echo "=== stacks ==="
PIDS=$(docker exec docker-api-1 sh -c 'for d in /proc/[0-9]*; do cmd=$(tr "\0" " " < $d/cmdline 2>/dev/null); case "$cmd" in *gunicorn*w*) echo ${d#/proc/};; esac; done')
for p in $PIDS; do
  echo "--- PID $p ---"
  docker exec docker-api-1 /tmp/pspy/py_spy-0.4.2.data/scripts/py-spy dump --pid "$p" 2>&1 | head -25
done
