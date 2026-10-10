#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

create_test_databases() {
  local db
  for db in preneura_current preneura_stale preneura_future_compatible preneura_future_incompatible; do
    dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
    createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
  done

  local migration filename
  for migration in packages/database/migrations/*.sql; do
    filename="$(basename "$migration")"
    if [[ "$filename" == "0033_runtime_readiness_contract.sql" ]]; then
      break
    fi
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_stale -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done

  for db in preneura_current preneura_future_compatible preneura_future_incompatible; do
    for migration in packages/database/migrations/*.sql; do
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
    done
  done

  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_future_compatible -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 33,
    migration_marker = '0034_additive_future',
    updated_at = now()
WHERE singleton_key = 'production';
SQL

  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_future_incompatible -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
UPDATE platform_runtime_contract
SET schema_version = 34,
    minimum_runtime_version = 34,
    migration_marker = '0034_breaking_future',
    updated_at = now()
WHERE singleton_key = 'production';
SQL
}

prove_contract_monotonicity() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_current -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  BEGIN
    UPDATE platform_runtime_contract
    SET schema_version = 32
    WHERE singleton_key = 'production';
    RAISE EXCEPTION 'schema downgrade unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'schema downgrade unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE platform_runtime_contract
    SET minimum_runtime_version = 32
    WHERE singleton_key = 'production';
    RAISE EXCEPTION 'runtime compatibility downgrade unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'runtime compatibility downgrade unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM platform_runtime_contract WHERE singleton_key = 'production';
    RAISE EXCEPTION 'runtime contract deletion unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'runtime contract deletion unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;
SQL
}

certify_library_matrix() {
  local temp_file="apps/api/.runtime-readiness-certification.mts"
  trap 'rm -f "$temp_file"' RETURN

  cat > "$temp_file" <<'TS'
import { createDatabase } from '@preneura/database';
import {
  assertRuntimeReadiness,
  RuntimeReadinessError,
} from '@preneura/database/runtime-readiness';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const expectedCode = process.env.EXPECT_CODE;
const expectedDatabaseSchemaVersion = process.env.EXPECT_DATABASE_SCHEMA_VERSION;
const db = createDatabase(databaseUrl);

try {
  const snapshot = await assertRuntimeReadiness(db);
  if (expectedCode) {
    throw new Error(`Expected readiness failure ${expectedCode}, but readiness passed.`);
  }
  if (
    expectedDatabaseSchemaVersion &&
    snapshot.databaseSchemaVersion !== Number(expectedDatabaseSchemaVersion)
  ) {
    throw new Error(
      `Expected database schema ${expectedDatabaseSchemaVersion}, got ${snapshot.databaseSchemaVersion}.`,
    );
  }
  console.log(JSON.stringify({ result: 'ready', ...snapshot }));
} catch (error) {
  if (!expectedCode) throw error;
  if (!(error instanceof RuntimeReadinessError) || error.code !== expectedCode) {
    throw error;
  }
  console.log(JSON.stringify({ result: 'not_ready', code: error.code }));
} finally {
  await db.destroy();
}
TS

  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_current" \
    EXPECT_DATABASE_SCHEMA_VERSION=33 \
    pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts

  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_stale" \
    EXPECT_CODE=SCHEMA_CONTRACT_MISSING \
    pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts

  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_future_compatible" \
    EXPECT_DATABASE_SCHEMA_VERSION=34 \
    pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts

  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_future_incompatible" \
    EXPECT_CODE=RUNTIME_VERSION_TOO_OLD \
    pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts

  rm -f "$temp_file"
  trap - RETURN
}

wait_for_live() {
  local pid="$1" port="$2" log_file="$3"
  local attempt
  for attempt in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      cat "$log_file"
      echo "API exited before liveness became available on port $port." >&2
      return 1
    fi
    if curl --fail --silent "http://127.0.0.1:$port/v1/health/live" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  cat "$log_file"
  echo "API did not become live on port $port within the startup window." >&2
  return 1
}

certify_api_current() {
  local log_file=/tmp/preneura-api-current.log
  NODE_ENV=test \
  PORT=4100 \
  WEB_ORIGIN=http://localhost:3000 \
  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_current" \
  OBJECT_STORAGE_BUCKET=readiness-test \
    pnpm --filter @preneura/api start >"$log_file" 2>&1 &
  local pid=$!
  trap 'kill '"$pid"' 2>/dev/null || true' RETURN

  wait_for_live "$pid" 4100 "$log_file"
  curl --fail --silent http://127.0.0.1:4100/v1/health/live | grep -q '"status":"ok"'
  curl --fail --silent http://127.0.0.1:4100/v1/health/ready >/tmp/ready.json
  grep -q '"status":"ready"' /tmp/ready.json
  grep -q '"databaseSchemaVersion":33' /tmp/ready.json

  kill "$pid"
  wait "$pid" || true
  trap - RETURN
}

certify_api_stale() {
  local log_file=/tmp/preneura-api-stale.log
  NODE_ENV=test \
  PORT=4101 \
  WEB_ORIGIN=http://localhost:3000 \
  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_stale" \
  OBJECT_STORAGE_BUCKET=readiness-test \
    pnpm --filter @preneura/api start >"$log_file" 2>&1 &
  local pid=$!
  trap 'kill '"$pid"' 2>/dev/null || true' RETURN

  wait_for_live "$pid" 4101 "$log_file"
  curl --fail --silent http://127.0.0.1:4101/v1/health/live | grep -q '"status":"ok"'

  local status
  status="$(curl --silent --output /tmp/stale-ready.json --write-out '%{http_code}' http://127.0.0.1:4101/v1/health/ready)"
  test "$status" = '503'
  grep -q '"status":"not_ready"' /tmp/stale-ready.json
  grep -q 'SCHEMA_CONTRACT_MISSING' /tmp/stale-ready.json

  kill "$pid"
  wait "$pid" || true
  trap - RETURN
}

certify_worker() {
  set +e
  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_stale" \
    timeout --signal=TERM --kill-after=2s 8s pnpm --filter @preneura/worker start >/tmp/worker-stale.log 2>&1
  local stale_rc=$?
  set -e
  if [[ "$stale_rc" -eq 0 || "$stale_rc" -eq 124 || "$stale_rc" -eq 137 ]]; then
    cat /tmp/worker-stale.log
    echo 'Worker did not fail closed on the stale schema.' >&2
    return 1
  fi
  grep -q 'worker.fatal' /tmp/worker-stale.log
  grep -q 'Runtime schema contract is not available' /tmp/worker-stale.log

  set +e
  DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_current" \
    timeout --signal=TERM --kill-after=2s 5s pnpm --filter @preneura/worker start >/tmp/worker-current.log 2>&1
  local current_rc=$?
  set -e
  if [[ "$current_rc" -ne 124 && "$current_rc" -ne 137 ]]; then
    cat /tmp/worker-current.log
    echo 'Current-schema worker exited unexpectedly.' >&2
    return 1
  fi
  grep -q 'worker.ready' /tmp/worker-current.log
  grep -q '"databaseSchemaVersion":33' /tmp/worker-current.log
}

create_test_databases
prove_contract_monotonicity
certify_library_matrix
certify_api_current
certify_api_stale
certify_worker

echo 'Runtime readiness certification: PASS'
