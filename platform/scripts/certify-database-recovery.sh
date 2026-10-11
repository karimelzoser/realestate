#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

SOURCE_DB="preneura_recovery_source_${GITHUB_RUN_ID:-local}"
RESTORE_DB="preneura_recovery_restored_${GITHUB_RUN_ID:-local}"
CORRUPT_DB="preneura_recovery_corrupt_${GITHUB_RUN_ID:-local}"
SOURCE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$SOURCE_DB"
RESTORE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$RESTORE_DB"
CORRUPT_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$CORRUPT_DB"
BACKUP_DIR="$(mktemp -d)"
API_PID=''

cleanup() {
  if [[ -n "$API_PID" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$SOURCE_DB" >/dev/null 2>&1 || true
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$RESTORE_DB" >/dev/null 2>&1 || true
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$CORRUPT_DB" >/dev/null 2>&1 || true
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

for db in "$SOURCE_DB" "$RESTORE_DB" "$CORRUPT_DB"; do
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db" >/dev/null 2>&1 || true
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$db"
done

DATABASE_URL="$SOURCE_URL" MIGRATION_ACTOR=recovery-certification pnpm --filter @preneura/database migrate >/dev/null

psql "$SOURCE_URL" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO users (id, display_name, status)
VALUES ('10000000-0000-0000-0000-000000000001', 'Recovery Operator', 'ACTIVE');

INSERT INTO tenants (id, code, name, status, default_currency, default_timezone)
VALUES ('20000000-0000-0000-0000-000000000001', 'RECOVERY', 'Recovery Certification Developer', 'ACTIVE', 'EGP', 'Africa/Cairo');

INSERT INTO tenant_memberships (tenant_id, user_id, status)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ACTIVE');

INSERT INTO projects (id, tenant_id, code, name, status, currency, timezone)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'RECOVERY-PROJECT',
  'Recovery Certification Project',
  'ACTIVE',
  'EGP',
  'Africa/Cairo'
);

INSERT INTO catalog_unit_types (
  id, tenant_id, project_id, code, name, bedroom_count,
  indoor_area_sqm, roof_area_sqm, garden_area_sqm, status, sort_order
) VALUES (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'TYPE-R', 'Recovery Type', 3, 120.00, 30.00, 45.00, 'ACTIVE', 1
);

INSERT INTO pricing_versions (
  id, tenant_id, project_id, version_number, label, status, effective_at, created_by
) VALUES (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  1, 'Recovery Price', 'DRAFT', '2026-10-01T00:00:00Z',
  '10000000-0000-0000-0000-000000000001'
);

INSERT INTO pricing_rates (
  tenant_id, project_id, pricing_version_id, unit_type_id, component, rate_per_sqm
) VALUES
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','INDOOR',55000.00),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','ROOF',10000.00),
  ('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','GARDEN',15000.00);

INSERT INTO inventory_slots (
  id, tenant_id, project_id, unit_type_id, state, internal_reference
) VALUES
  ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','AVAILABLE','REC-001'),
  ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','AVAILABLE','REC-002');
SQL

fingerprint() {
  local url="$1"
  psql "$url" -Atv ON_ERROR_STOP=1 -c "
SELECT concat_ws('|',
  (SELECT display_name || ':' || status FROM users WHERE id='10000000-0000-0000-0000-000000000001'),
  (SELECT code || ':' || name || ':' || status FROM tenants WHERE id='20000000-0000-0000-0000-000000000001'),
  (SELECT code || ':' || name || ':' || status FROM projects WHERE id='30000000-0000-0000-0000-000000000001'),
  (SELECT code || ':' || indoor_area_sqm || ':' || roof_area_sqm || ':' || garden_area_sqm FROM catalog_unit_types WHERE id='40000000-0000-0000-0000-000000000001'),
  (SELECT string_agg(component || ':' || rate_per_sqm, ',' ORDER BY component) FROM pricing_rates WHERE pricing_version_id='50000000-0000-0000-0000-000000000001'),
  (SELECT string_agg(internal_reference || ':' || state, ',' ORDER BY internal_reference) FROM inventory_slots WHERE project_id='30000000-0000-0000-0000-000000000001'),
  (SELECT count(*)::text FROM platform_schema_migrations),
  (SELECT schema_version || ':' || minimum_runtime_version || ':' || migration_marker FROM platform_runtime_contract WHERE singleton_key='production')
);"
}

SOURCE_FINGERPRINT="$(fingerprint "$SOURCE_URL")"

env DATABASE_URL="$SOURCE_URL" BACKUP_DIR="$BACKUP_DIR" BACKUP_LABEL=gate6-recovery RELEASE_SHA="${GITHUB_SHA:-local}" \
  bash scripts/backup-postgres.sh >/tmp/recovery-backup.out
BACKUP_FILE="$(sed -n 's/^BACKUP_FILE=//p' /tmp/recovery-backup.out)"
test -s "$BACKUP_FILE"
test -s "${BACKUP_FILE}.sha256"
test -s "${BACKUP_FILE}.meta"

env RESTORE_DATABASE_URL="$RESTORE_URL" BACKUP_FILE="$BACKUP_FILE" \
  bash scripts/restore-postgres.sh >/tmp/recovery-restore.out
grep -q '^RESTORE_STATUS=ok$' /tmp/recovery-restore.out

RESTORE_FINGERPRINT="$(fingerprint "$RESTORE_URL")"
test "$SOURCE_FINGERPRINT" = "$RESTORE_FINGERPRINT"

# The restored database must still be acceptable to the actual production
# readiness boundary, not merely contain similar rows.
NODE_ENV=test \
PORT=4190 \
WEB_ORIGIN=http://localhost:3000 \
DATABASE_URL="$RESTORE_URL" \
OBJECT_STORAGE_BUCKET=recovery-certification \
  pnpm --filter @preneura/api start >/tmp/recovery-api.log 2>&1 &
API_PID=$!
for attempt in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:4190/v1/health/ready >/tmp/recovery-ready.json; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then cat /tmp/recovery-api.log; exit 1; fi
  sleep 1
done
grep -q '"status":"ready"' /tmp/recovery-ready.json
kill "$API_PID"
wait "$API_PID" || true
API_PID=''

# A restore is intentionally refused on a non-empty target unless an operator
# explicitly opts into that destructive behavior.
set +e
env RESTORE_DATABASE_URL="$RESTORE_URL" BACKUP_FILE="$BACKUP_FILE" \
  bash scripts/restore-postgres.sh >/tmp/recovery-nonempty.log 2>&1
NONEMPTY_RC=$?
set -e
test "$NONEMPTY_RC" -ne 0
grep -q 'Restore target is not empty' /tmp/recovery-nonempty.log

# Corruption must fail before any archive is restored.
CORRUPT_FILE="$BACKUP_DIR/corrupt.dump"
cp "$BACKUP_FILE" "$CORRUPT_FILE"
cp "${BACKUP_FILE}.sha256" "${CORRUPT_FILE}.sha256"
cp "${BACKUP_FILE}.meta" "${CORRUPT_FILE}.meta"
printf 'corruption' >> "$CORRUPT_FILE"
set +e
env RESTORE_DATABASE_URL="$CORRUPT_URL" BACKUP_FILE="$CORRUPT_FILE" \
  bash scripts/restore-postgres.sh >/tmp/recovery-corrupt.log 2>&1
CORRUPT_RC=$?
set -e
test "$CORRUPT_RC" -ne 0
grep -q 'Backup checksum verification failed' /tmp/recovery-corrupt.log

# Critical append-only release evidence must retain its database protections.
set +e
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM platform_runtime_contract WHERE singleton_key='production';" >/tmp/recovery-contract-delete.log 2>&1
CONTRACT_DELETE_RC=$?
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM platform_schema_migrations WHERE version=(SELECT max(version) FROM platform_schema_migrations);" >/tmp/recovery-ledger-delete.log 2>&1
LEDGER_DELETE_RC=$?
set -e
test "$CONTRACT_DELETE_RC" -ne 0
test "$LEDGER_DELETE_RC" -ne 0

echo 'Gate 6 database recovery certification: PASS'
