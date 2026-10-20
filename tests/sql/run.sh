#!/usr/bin/env bash
# Replays every repo migration on a scratch Postgres database, then runs the
# SQL tests (licensing, and the quiz-attempt answer-key leak check). Needs a throwaway Postgres you can create
# databases in (never point it at a real project).
#
#   PSQL="psql -h localhost -p 5432 -U postgres" tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-psql}"
DB=school_license_test

$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/prelude.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  echo "migrate $(basename "$f")"
  $PSQL -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null
done

# license.test.sql builds its own minimal schema and drops public, so it
# runs in its own database.
$PSQL -q -d postgres -c "drop database if exists ${DB}_unit" -c "create database ${DB}_unit"
$PSQL -q -v ON_ERROR_STOP=1 -d ${DB}_unit -f tests/sql/license.test.sql | grep -E "PASSED|ERROR" || true

$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/license-features.test.sql | grep -E "PASSED|ERROR" || true

$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/quiz-attempt-leak.test.sql | grep -E "PASSED|ERROR" || true
