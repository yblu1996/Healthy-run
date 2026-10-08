#!/bin/bash
KEY=$(cat /tmp/appkey.txt | tr -d '\r\n')
echo "=== A) no-auth POST (expect instant 401) ==="
curl -s --max-time 10 -o /dev/null -w 'code=%{http_code} time=%{time_total}s\n' -X POST http://localhost:5001/v1/workflows/run -H "Content-Type: application/json" -d '{}'
echo "=== B) bad-body with auth (expect 4xx) ==="
curl -s --max-time 10 -w '\ncode=%{http_code} time=%{time_total}s\n' -X POST http://localhost:5001/v1/workflows/run -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"inputs":{}}'
echo "=== C) blocking mode, empty images (up to 110s) ==="
curl -s --max-time 110 -w '\ncode=%{http_code} time=%{time_total}s\n' -X POST http://localhost:5001/v1/workflows/run -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"inputs":{"user_text":"探活：45岁女性周跑量25公里，配速630，心率148。","goal":"none","race_date":"","history":"[]","images":[]},"response_mode":"blocking","user":"paowu-test"}' | head -c 700
