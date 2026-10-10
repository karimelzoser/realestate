#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./pg-client.sh
source "$SCRIPT_DIR/pg-client.sh"

: "${DATABASE_URL:?DATABASE_URL is required}"
CONTENDERS="${CONTENDERS:-200}"
PARALLELISM="${PARALLELISM:-32}"

TENANT_ID='60000000-0000-0000-0000-000000000001'
PROJECT_ID='60000000-0000-0000-0000-000000000002'
USER_ID='60000000-0000-0000-0000-000000000003'
TYPE_ID='60000000-0000-0000-0000-000000000004'
SLOT_ID='60000000-0000-0000-0000-000000000005'

run_pg_tool psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO users(id, display_name, status) VALUES ('$USER_ID','Gate 6 Allocator','ACTIVE') ON CONFLICT (id) DO NOTHING;
INSERT INTO tenants(id, code, name, status) VALUES ('$TENANT_ID','GATE6-TENANT','Gate 6 Tenant','ACTIVE') ON CONFLICT (id) DO NOTHING;
INSERT INTO projects(id, tenant_id, code, name, status) VALUES ('$PROJECT_ID','$TENANT_ID','GATE6-PROJECT','Gate 6 Project','ACTIVE') ON CONFLICT (id) DO NOTHING;
INSERT INTO catalog_unit_types(id, tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm, garden_area_sqm)
VALUES ('$TYPE_ID','$TENANT_ID','$PROJECT_ID','G6-TYPE','Gate 6 Type',100,0,0) ON CONFLICT (id) DO NOTHING;
INSERT INTO inventory_slots(id, tenant_id, project_id, unit_type_id, state, internal_reference)
VALUES ('$SLOT_ID','$TENANT_ID','$PROJECT_ID','$TYPE_ID','AVAILABLE','G6-SLOT') ON CONFLICT (id) DO NOTHING;
DELETE FROM inventory_locks WHERE inventory_slot_id='$SLOT_ID';
SQL

attempt_lock() {
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -v tenant="$TENANT_ID" \
    -v project="$PROJECT_ID" \
    -v unit_type="$TYPE_ID" \
    -v slot="$SLOT_ID" \
    -v actor="$USER_ID" \
    -c "INSERT INTO inventory_locks(tenant_id,project_id,unit_type_id,inventory_slot_id,locked_by_user_id,status,expires_at) VALUES (:'tenant',:'project',:'unit_type',:'slot',:'actor','ACTIVE',now()+interval '15 minutes');" \
    >/dev/null 2>&1
}
export -f attempt_lock
export DATABASE_URL TENANT_ID PROJECT_ID USER_ID TYPE_ID SLOT_ID

run_round() {
  set +e
  seq 1 "$CONTENDERS" | xargs -P "$PARALLELISM" -I{} bash -c 'attempt_lock'
  set -e
}

run_round

active_count="$(run_pg_tool psql "$DATABASE_URL" -X -A -t -c "SELECT count(*) FROM inventory_locks WHERE inventory_slot_id='$SLOT_ID' AND status='ACTIVE';" | tr -d '[:space:]')"
total_count="$(run_pg_tool psql "$DATABASE_URL" -X -A -t -c "SELECT count(*) FROM inventory_locks WHERE inventory_slot_id='$SLOT_ID';" | tr -d '[:space:]')"

if [[ "$active_count" != "1" || "$total_count" != "1" ]]; then
  echo "Atomic lock certification failed: active=$active_count total=$total_count contenders=$CONTENDERS" >&2
  exit 1
fi

run_pg_tool psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "UPDATE inventory_locks SET status='RELEASED', released_at=now(), release_reason='GATE6_TEST' WHERE inventory_slot_id='$SLOT_ID' AND status='ACTIVE';" >/dev/null

run_round

active_count="$(run_pg_tool psql "$DATABASE_URL" -X -A -t -c "SELECT count(*) FROM inventory_locks WHERE inventory_slot_id='$SLOT_ID' AND status='ACTIVE';" | tr -d '[:space:]')"
total_count="$(run_pg_tool psql "$DATABASE_URL" -X -A -t -c "SELECT count(*) FROM inventory_locks WHERE inventory_slot_id='$SLOT_ID';" | tr -d '[:space:]')"

if [[ "$active_count" != "1" || "$total_count" != "2" ]]; then
  echo "Re-lock certification failed: active=$active_count total=$total_count" >&2
  exit 1
fi

echo "Atomic lock concurrency certification passed with $CONTENDERS contenders per round."
