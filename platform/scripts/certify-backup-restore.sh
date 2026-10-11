#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./pg-client.sh
source "$SCRIPT_DIR/pg-client.sh"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
backup="$workdir/preneura.dump"

source_fingerprint() {
  local url="$1"
  run_pg_tool psql "$url" -X -A -t -v ON_ERROR_STOP=1 -c "
    SELECT jsonb_build_object(
      'runtime', (SELECT jsonb_build_object('schema_version', schema_version, 'migration_marker', migration_marker) FROM platform_runtime_contract WHERE singleton_key='production'),
      'users', (SELECT count(*) FROM users),
      'tenants', (SELECT count(*) FROM tenants),
      'projects', (SELECT count(*) FROM projects),
      'unit_types', (SELECT count(*) FROM catalog_unit_types),
      'inventory_slots', (SELECT count(*) FROM inventory_slots),
      'transactions', (SELECT count(*) FROM transactions),
      'finance_events', (SELECT count(*) FROM finance_payment_events),
      'outbox', (SELECT count(*) FROM domain_outbox_events)
    )::text;
  " | tr -d '\r\n'
}

source_value="$(source_fingerprint "$DATABASE_URL")"

run_pg_tool pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl > "$backup"
if [[ ! -s "$backup" ]]; then
  echo "Backup artifact is empty." >&2
  exit 1
fi

run_pg_tool pg_restore --dbname "$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error < "$backup"
restored_value="$(source_fingerprint "$RESTORE_DATABASE_URL")"

if [[ "$source_value" != "$restored_value" ]]; then
  echo "Backup/restore fingerprint mismatch." >&2
  echo "source:   $source_value" >&2
  echo "restored: $restored_value" >&2
  exit 1
fi

run_pg_tool psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "
  SELECT 1 FROM platform_runtime_contract WHERE singleton_key='production';
  SELECT 1 FROM tenants WHERE code='GATE6-TENANT';
  SELECT 1 FROM projects WHERE code='GATE6-PROJECT';
" >/dev/null

echo "Backup/restore certification passed."
