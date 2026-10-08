#!/bin/bash
KEY=$(cat /tmp/appkey.txt)
echo "=== direct POST /v1/workflows/run to api:5001 ==="
curl -s -N --max-time 45 -X POST http://localhost:5001/v1/workflows/run \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"inputs":{"user_text":"探活测试：45岁女性，周跑量25公里。","goal":"none","race_date":"","history":"[]","images":[]},"response_mode":"streaming","user":"paowu-test"}' | head -c 2000
echo ""
echo "=== done ==="
