#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=./backups}"
: "${BACKUP_LABEL:=preneura}"
: "${RELEASE_SHA:=unknown}"

for command in pg_dump pg_restore psql sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

if [[ ! "$BACKUP_LABEL" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo 'BACKUP_LABEL may contain only letters, numbers, dot, underscore and hyphen.' >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/${BACKUP_LABEL}-${timestamp}.dump"
checksum_file="${backup_file}.sha256"
metadata_file="${backup_file}.meta"
temporary_file="${backup_file}.partial"
trap 'rm -f "$temporary_file"' EXIT

readiness_row="$(psql "$DATABASE_URL" -Atv ON_ERROR_STOP=1 -c "
SELECT
  c.schema_version || '|' ||
  c.minimum_runtime_version || '|' ||
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

IFS='|' read -r schema_version minimum_runtime_version migration_marker ledger_version ledger_filename <<<"$readiness_row"
if [[ -z "${schema_version:-}" || -z "${ledger_version:-}" ]]; then
  echo 'Runtime contract or migration ledger is missing; refusing backup.' >&2
  exit 1
fi
if [[ "$schema_version" != "$ledger_version" || "$ledger_filename" != "${migration_marker}.sql" ]]; then
  echo 'Runtime contract and migration ledger do not agree; refusing backup.' >&2
  exit 1
fi

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$temporary_file"

# Ensure the custom-format archive can at least be read by pg_restore before it
# is promoted to a backup artifact.
pg_restore --list "$temporary_file" >/dev/null
mv "$temporary_file" "$backup_file"
backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
printf '%s  %s\n' "$backup_sha256" "$(basename "$backup_file")" > "$checksum_file"

cat > "$metadata_file" <<EOF
format=pg_dump-custom-v1
created_at=$timestamp
release_sha=$RELEASE_SHA
schema_version=$schema_version
minimum_runtime_version=$minimum_runtime_version
migration_marker=$migration_marker
migration_ledger_version=$ledger_version
migration_ledger_filename=$ledger_filename
backup_sha256=$backup_sha256
EOF

chmod 600 "$backup_file" "$checksum_file" "$metadata_file"
trap - EXIT

printf 'BACKUP_FILE=%s\n' "$backup_file"
printf 'BACKUP_SHA256=%s\n' "$backup_sha256"
printf 'BACKUP_METADATA=%s\n' "$metadata_file"
