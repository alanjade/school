#!/usr/bin/env bash
# Replays every repo migration on a scratch Postgres database, then runs the
# quiz-attempt answer-key leak test. Needs a throwaway Postgres you can create
# databases in (never point it at a real project).
#
#   PSQL="psql -h localhost -p 5432 -U postgres" tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL="${PSQL:-psql}"
DB=school_test

$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/prelude.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  echo "migrate $(basename "$f")"
  $PSQL -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null
done

$PSQL -q -v ON_ERROR_STOP=1 -d $DB -f tests/sql/quiz-attempt-leak.test.sql | grep -E "PASSED|ERROR" || true
