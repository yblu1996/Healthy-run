#!/bin/bash
for i in 1 2 3 4 5 6 7 8; do
  sleep 30
  s=$(docker exec docker-db_postgres-1 psql -U postgres -d dify -t -A -c "select status from workflow_runs order by created_at desc limit 1;")
  echo "[$((i*30))s] status: $s"
  if [ "$s" != "running" ]; then break; fi
done
docker exec docker-db_postgres-1 psql -U postgres -d dify -t -c "select status, left(coalesce(error,'-'),200), outputs is not null as has_outputs from workflow_runs order by created_at desc limit 1;"
