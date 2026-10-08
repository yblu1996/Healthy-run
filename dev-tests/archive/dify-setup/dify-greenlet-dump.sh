#!/bin/bash
PYSPY=/tmp/pspy/py_spy-0.4.2.data/scripts/py-spy
for p in 56 57 58 59; do
  echo "===== PID $p ====="
  docker exec docker-api-1 $PYSPY dump --pid $p --gevent 2>&1 | head -40
done
