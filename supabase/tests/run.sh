#!/usr/bin/env sh
# Runs every migration on a throwaway local Postgres database, then the Phase 14 checks.
# Needs a local Postgres you can reach with psql (PGHOST/PGPORT/PGUSER as usual). Not run against Supabase.
set -e
cd "$(dirname "$0")/../.."
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists dh_test" -c "create database dh_test"
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d dh_test -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/phase14_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/critters_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR|SCHEDULE|MULTI"
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/r1_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/r3_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
psql -v ON_ERROR_STOP=1 -q -d dh_test -f supabase/tests/games_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
