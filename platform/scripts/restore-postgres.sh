#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_CHECKSUM_FILE:=${BACKUP_FILE}.sha256}"
: "${BACKUP_METADATA_FILE:=${BACKUP_FILE}.meta}"
: "${RESTORE_ALLOW_NONEMPTY:=false}"

for command in pg_restore psql sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

test -r "$BACKUP_FILE" || { echo "Backup file is not readable: $BACKUP_FILE" >&2; exit 1; }
test -r "$BACKUP_CHECKSUM_FILE" || { echo "Checksum file is not readable: $BACKUP_CHECKSUM_FILE" >&2; exit 1; }
test -r "$BACKUP_METADATA_FILE" || { echo "Metadata file is not readable: $BACKUP_METADATA_FILE" >&2; exit 1; }

backup_dir="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
backup_name="$(basename "$BACKUP_FILE")"
checksum_name="$(basename "$BACKUP_CHECKSUM_FILE")"
(
  cd "$backup_dir"
  sha256sum --check --status "$checksum_name"
) || {
  echo 'Backup checksum verification failed.' >&2
  exit 1
}

archive_count="$(pg_restore --list "$BACKUP_FILE" | grep -c ';' || true)"
if [[ "$archive_count" -lt 1 ]]; then
  echo 'Backup archive does not contain restorable entries.' >&2
  exit 1
fi

existing_objects="$(psql "$RESTORE_DATABASE_URL" -Atv ON_ERROR_STOP=1 -c "
SELECT count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p','v','m','S');
")"
if [[ "$existing_objects" != '0' && "$RESTORE_ALLOW_NONEMPTY" != 'true' ]]; then
  echo "Restore target is not empty (${existing_objects} public objects). Refusing destructive restore." >&2
  exit 1
fi

pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

metadata_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$BACKUP_METADATA_FILE" | tail -n 1
}

expected_schema="$(metadata_value schema_version)"
expected_marker="$(metadata_value migration_marker)"
expected_ledger_version="$(metadata_value migration_ledger_version)"
expected_ledger_filename="$(metadata_value migration_ledger_filename)"
expected_sha="$(metadata_value backup_sha256)"
actual_sha="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"

if [[ -z "$expected_schema" || -z "$expected_marker" || -z "$expected_ledger_version" || -z "$expected_ledger_filename" ]]; then
  echo 'Backup metadata is incomplete.' >&2
  exit 1
fi
if [[ -n "$expected_sha" && "$expected_sha" != "$actual_sha" ]]; then
  echo 'Metadata SHA-256 does not match the restored backup.' >&2
  exit 1
fi

restored_row="$(psql "$RESTORE_DATABASE_URL" -Atv ON_ERROR_STOP=1 -c "
SELECT
  c.schema_version || '|' ||
  c.migration_marker || '|' ||
  m.version || '|' ||
  m.filename
FROM platform_runtime_contract c
CROSS JOIN LATERAL (
  SELECT version, filename
  FROM platform_schema_migrations
  ORDER BY version DESC
  LIMIT 1
) m
WHERE c.singleton_key = 'production';
")"
IFS='|' read -r restored_schema restored_marker restored_ledger_version restored_ledger_filename <<<"$restored_row"

if [[ "$restored_schema" != "$expected_schema" || "$restored_marker" != "$expected_marker" ]]; then
  echo 'Restored runtime contract does not match backup metadata.' >&2
  exit 1
fi
if [[ "$restored_ledger_version" != "$expected_ledger_version" || "$restored_ledger_filename" != "$expected_ledger_filename" ]]; then
  echo 'Restored migration ledger does not match backup metadata.' >&2
  exit 1
fi

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'ANALYZE;' >/dev/null

printf 'RESTORE_STATUS=ok\n'
printf 'RESTORED_SCHEMA_VERSION=%s\n' "$restored_schema"
printf 'RESTORED_MIGRATION=%s\n' "$restored_ledger_filename"
