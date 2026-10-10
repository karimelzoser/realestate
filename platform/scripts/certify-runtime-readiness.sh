#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT_SCHEMA_VERSION="$(sed -nE 's/^export const RUNTIME_SCHEMA_VERSION = ([0-9]+);$/\1/p' packages/database/src/runtime-readiness.ts)"
CURRENT_MIGRATION_MARKER="$(sed -nE "s/^export const RUNTIME_MIGRATION_MARKER = '([^']+)';$/\1/p" packages/database/src/runtime-readiness.ts)"
if [[ -z "$CURRENT_SCHEMA_VERSION" || -z "$CURRENT_MIGRATION_MARKER" ]]; then
  echo 'Could not derive runtime schema contract from runtime-readiness.ts.' >&2
  exit 1
fi
FUTURE_SCHEMA_VERSION=$((CURRENT_SCHEMA_VERSION + 1))
CURRENT_MIGRATION_FILE="${CURRENT_MIGRATION_MARKER}.sql"

create_db() {
  local db="$1"
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db" >/dev/null 2>&1 || true
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
}

apply_all() {
  local db="$1" migration
  for migration in packages/database/migrations/*.sql; do
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done
}

apply_stale() {
  local db="$1" migration filename
  for migration in packages/database/migrations/*.sql; do
    filename="$(basename "$migration")"
    [[ "$filename" == "$CURRENT_MIGRATION_FILE" ]] && break
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done
}

for db in preneura_current preneura_stale preneura_future_compatible preneura_future_incompatible; do
  create_db "$db"
done
apply_stale preneura_stale
apply_all preneura_current
apply_all preneura_future_compatible
apply_all preneura_future_incompatible

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_future_compatible -v ON_ERROR_STOP=1 \
  -v future="$FUTURE_SCHEMA_VERSION" -v current="$CURRENT_SCHEMA_VERSION" <<'SQL' >/dev/null
UPDATE platform_runtime_contract
SET schema_version = :'future'::integer,
    minimum_runtime_version = :'current'::integer,
    migration_marker = 'future_additive_certification',
    updated_at = now()
WHERE singleton_key = 'production';
SQL

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_future_incompatible -v ON_ERROR_STOP=1 \
  -v future="$FUTURE_SCHEMA_VERSION" <<'SQL' >/dev/null
UPDATE platform_runtime_contract
SET schema_version = :'future'::integer,
    minimum_runtime_version = :'future'::integer,
    migration_marker = 'future_breaking_certification',
    updated_at = now()
WHERE singleton_key = 'production';
SQL

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d preneura_current -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$
BEGIN
  BEGIN
    UPDATE platform_runtime_contract SET schema_version = 1 WHERE singleton_key = 'production';
    RAISE EXCEPTION 'schema downgrade unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'schema downgrade unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE platform_runtime_contract SET minimum_runtime_version = 1 WHERE singleton_key = 'production';
    RAISE EXCEPTION 'runtime compatibility downgrade unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'runtime compatibility downgrade unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE platform_runtime_contract SET migration_marker = 'same_version_mutation' WHERE singleton_key = 'production';
    RAISE EXCEPTION 'same-version marker mutation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'same-version marker mutation unexpectedly succeeded' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM platform_runtime_contract WHERE singleton_key = 'production';
    RAISE EXCEPTION 'runtime contract deletion unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'runtime contract deletion unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;
SQL

TEMP_FILE="apps/api/.runtime-readiness-certification.mts"
trap 'rm -f "$TEMP_FILE"' EXIT
cat > "$TEMP_FILE" <<'TS'
import { createDatabase } from '@preneura/database';
import { assertRuntimeReadiness, RuntimeReadinessError } from '@preneura/database/runtime-readiness';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const expectedCode = process.env.EXPECT_CODE;
const expectedVersion = process.env.EXPECT_DATABASE_SCHEMA_VERSION;
const db = createDatabase(databaseUrl);
try {
  const snapshot = await assertRuntimeReadiness(db);
  if (expectedCode) throw new Error(`Expected ${expectedCode}, but readiness passed.`);
  if (expectedVersion && snapshot.databaseSchemaVersion !== Number(expectedVersion)) {
    throw new Error(`Expected schema ${expectedVersion}, got ${snapshot.databaseSchemaVersion}.`);
  }
  console.log(JSON.stringify({ result: 'ready', ...snapshot }));
} catch (error) {
  if (!expectedCode) throw error;
  if (!(error instanceof RuntimeReadinessError) || error.code !== expectedCode) throw error;
  console.log(JSON.stringify({ result: 'not_ready', code: error.code }));
} finally {
  await db.destroy();
}
TS

DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_current" \
  EXPECT_DATABASE_SCHEMA_VERSION="$CURRENT_SCHEMA_VERSION" \
  pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_stale" \
  EXPECT_CODE=SCHEMA_TOO_OLD \
  pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_future_compatible" \
  EXPECT_DATABASE_SCHEMA_VERSION="$FUTURE_SCHEMA_VERSION" \
  pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_future_incompatible" \
  EXPECT_CODE=RUNTIME_VERSION_TOO_OLD \
  pnpm --filter @preneura/api exec tsx .runtime-readiness-certification.mts

set +e
NODE_ENV=test DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_stale" \
  timeout --signal=TERM --kill-after=2s 8s pnpm --filter @preneura/worker start >/tmp/worker-stale.log 2>&1
STALE_RC=$?
set -e
if [[ "$STALE_RC" -eq 0 || "$STALE_RC" -eq 124 || "$STALE_RC" -eq 137 ]]; then
  cat /tmp/worker-stale.log
  echo 'Worker did not fail closed on stale schema.' >&2
  exit 1
fi
grep -q 'worker.fatal' /tmp/worker-stale.log
grep -q 'older than runtime schema' /tmp/worker-stale.log

set +e
NODE_ENV=test DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/preneura_current" \
  timeout --signal=TERM --kill-after=2s 5s pnpm --filter @preneura/worker start >/tmp/worker-current.log 2>&1
CURRENT_RC=$?
set -e
if [[ "$CURRENT_RC" -ne 124 && "$CURRENT_RC" -ne 137 ]]; then
  cat /tmp/worker-current.log
  echo 'Current-schema worker exited unexpectedly.' >&2
  exit 1
fi
grep -q 'worker.ready' /tmp/worker-current.log
grep -q "\"databaseSchemaVersion\":$CURRENT_SCHEMA_VERSION" /tmp/worker-current.log

echo "Runtime readiness certification: PASS (schema $CURRENT_SCHEMA_VERSION / $CURRENT_MIGRATION_MARKER)"
