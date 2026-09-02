#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

db_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

ready=false
for attempt in $(seq 1 20); do
  if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
    ready=true
    break
  fi
  echo "Waiting for PostgreSQL to accept connections (attempt $attempt/20)..." >&2
  sleep 1
done
if [ "$ready" != true ]; then
  echo "PostgreSQL did not become available after 20 seconds; migrations were not applied." >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )" >/dev/null

expected=1
for migration in "$db_dir"/migrations/[0-9][0-9][0-9]_*.sql; do
  filename=$(basename "$migration")
  version_text=${filename%%_*}
  version=$(expr "$version_text" + 0)
  if [ "$version" -ne "$expected" ]; then
    echo "migration ordering error: expected $(printf '%03d' "$expected"), found $filename" >&2
    exit 1
  fi

  applied=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM schema_migrations WHERE version=$version")
  if [ "$applied" -eq 0 ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
      -f "$migration" \
      -c "INSERT INTO schema_migrations(version,name) VALUES($version,'$filename')" >/dev/null
  fi
  expected=$((expected + 1))
done

if [ "$expected" -ne 12 ]; then
  echo "migration set must contain exactly 001 through 011" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  DO \$\$ BEGIN
    IF (SELECT array_agg(version ORDER BY version) FROM schema_migrations) IS DISTINCT FROM ARRAY[1,2,3,4,5,6,7,8,9,10,11] THEN
      RAISE EXCEPTION 'schema_migrations must contain exactly versions 001 through 011';
    END IF;
  END \$\$" >/dev/null

echo "Database migrations 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 010 -> 011 complete."
