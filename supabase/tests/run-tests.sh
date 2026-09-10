#!/usr/bin/env bash
#
# run-tests.sh — boots a throwaway Postgres schema and validates the entire
# supabase/migrations chain plus the #86 RLS lockdown against a fresh DB.
#
# Requirements:
#   * a reachable Postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD; defaults to
#     localhost:5432 as the current OS user)
#   * psql in PATH
#
# Usage: ./run-tests.sh [database_name]
#   database_name defaults to `jointsave_test_<PID>`, created and dropped here.
#
# This intentionally runs on a session-default database (postgres) and creates
# its own scratch database so nothing outside the test needs changing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
FIXTURES="$HERE/fixtures"

PGROOT_DB="${PGROOT_DB:-postgres}"
SCRATCH="${1:-jointsave_test_$$}"

print_status() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }

# The pg_cron/pg_net scheduling migration requires extensions that only exist
# in the Supabase image. Skip it when unavailable, and say so explicitly.
pg_ext_missing() {
  if psql -d "$PGROOT_DB" -v ON_ERROR_STOP=1 -qtAc \
      "SELECT 1 FROM pg_available_extensions WHERE name='pg_cron'" | grep -q 1; then
    return 1
  fi
}

cleanup() {
  if dropdb --if-exists "$SCRATCH" >/dev/null 2>&1; then
    print_status "dropped scratch database '$SCRATCH'"
  fi
}
trap cleanup EXIT

print_status "creating scratch database '$SCRATCH'"
createdb "$SCRATCH"

run_file() {
  psql -d "$SCRATCH" -v ON_ERROR_STOP=1 --quiet -f "$1" >/dev/null
  print_status "applied $(basename "$1")"
}

print_status "loading base schema fixture"
run_file "$FIXTURES/base_schema.sql"

print_status "applying migrations in order"
SKIP_CRON=0
if pg_ext_missing; then
  SKIP_CRON=1
  print_status "pg_cron/pg_net unavailable in this Postgres — skipping" \
    "$(basename "$MIGRATIONS"/20260722120100_*.sql) (scheduling-only migration)"
fi

for mig in "$MIGRATIONS"/*.sql; do
  name="$(basename "$mig")"
  if [ "$SKIP_CRON" = 1 ] && [ "$name" = "20260722120100_schedule_auto_trigger_payouts.sql" ]; then
    continue
  fi
  run_file "$mig"
done

print_status "running migration smoke assertions"
psql -d "$SCRATCH" -v ON_ERROR_STOP=1 --quiet -f "$HERE/migration_smoke.sql"
print_status "migration smoke passed"

print_status "running RLS enforcement assertions"
psql -d "$SCRATCH" -v ON_ERROR_STOP=1 --quiet -f "$HERE/rls_enforcement.sql"
print_status "RLS enforcement passed"

print_status "ALL SUPABASE SQL TESTS PASSED"