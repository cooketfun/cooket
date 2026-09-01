#!/bin/sh
set -eu

compose_file=${1:-compose.yaml}

grep -q '^name: cooket$' "$compose_file"
grep -q '127.0.0.1:3200:3000' "$compose_file"
grep -q '127.0.0.1:4200:4000' "$compose_file"
grep -q '127.0.0.1:15436:5432' "$compose_file"
grep -q 'name: cooket_postgres_data' "$compose_file"
grep -q 'name: cooket_redis_data' "$compose_file"
grep -q 'name: cooket_object_data' "$compose_file"
grep -q 'name: cooket_network' "$compose_file"

if grep -q 'container_name:' "$compose_file"; then
  echo 'explicit container_name entries are forbidden' >&2
  exit 1
fi

echo 'Compose isolation checks passed.'
