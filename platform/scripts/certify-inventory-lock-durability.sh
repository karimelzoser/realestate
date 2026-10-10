#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_NAME="preneura_lock_cert_${GITHUB_RUN_ID:-local}_$$"
DB_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB_NAME"
cleanup() {
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
for migration in packages/database/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/database/tests/gate2_inventory_lock_durability_certification.sql

# Concurrency: 200 overdue locks, two sweepers at once, one transition/event per lock.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO inventory_slots (id, tenant_id, project_id, unit_type_id, state, internal_reference)
SELECT
  gen_random_uuid(),
  '34000000-0000-0000-0000-000000000010'::uuid,
  '34000000-0000-0000-0000-000000000020'::uuid,
  '34000000-0000-0000-0000-000000000030'::uuid,
  'AVAILABLE',
  'CONCURRENT-' || gs
FROM generate_series(1, 200) gs;

INSERT INTO inventory_locks (
  tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
  locked_by_user_id, status, expires_at, created_at, updated_at
)
SELECT
  s.tenant_id, s.project_id, s.unit_type_id, s.id,
  '34000000-0000-0000-0000-000000000002'::uuid,
  '34000000-0000-0000-0000-000000000001'::uuid,
  'ACTIVE', now() - interval '1 minute', now() - interval '5 minutes', now() - interval '5 minutes'
FROM inventory_slots s
WHERE s.internal_reference LIKE 'CONCURRENT-%';
SQL

psql "$DB_URL" -Atqc 'SELECT preneura_expire_inventory_locks(200, now())' >/tmp/lock-sweep-a.out &
A_PID=$!
psql "$DB_URL" -Atqc 'SELECT preneura_expire_inventory_locks(200, now())' >/tmp/lock-sweep-b.out &
B_PID=$!
wait "$A_PID"
wait "$B_PID"

CONCURRENT_EXPIRED="$(psql "$DB_URL" -Atqc "SELECT count(*) FROM inventory_locks l JOIN inventory_slots s ON s.id=l.inventory_slot_id WHERE s.internal_reference LIKE 'CONCURRENT-%' AND l.status='EXPIRED'")"
CONCURRENT_EVENTS="$(psql "$DB_URL" -Atqc "SELECT count(*) FROM domain_outbox_events e JOIN inventory_locks l ON l.id=e.aggregate_id JOIN inventory_slots s ON s.id=l.inventory_slot_id WHERE s.internal_reference LIKE 'CONCURRENT-%' AND e.event_type='inventory.lock.expired'")"
test "$CONCURRENT_EXPIRED" = "200"
test "$CONCURRENT_EVENTS" = "200"
TOTAL_SWEEPED=$(( $(cat /tmp/lock-sweep-a.out) + $(cat /tmp/lock-sweep-b.out) ))
test "$TOTAL_SWEEPED" = "200"

seed_restart_lock() {
  local ref="$1"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -v ref="$ref" <<'SQL' >/dev/null
WITH slot AS (
  INSERT INTO inventory_slots (tenant_id, project_id, unit_type_id, state, internal_reference)
  VALUES (
    '34000000-0000-0000-0000-000000000010',
    '34000000-0000-0000-0000-000000000020',
    '34000000-0000-0000-0000-000000000030',
    'AVAILABLE',
    :'ref'
  )
  RETURNING id, tenant_id, project_id, unit_type_id
)
INSERT INTO inventory_locks (
  tenant_id, project_id, unit_type_id, inventory_slot_id, buyer_user_id,
  locked_by_user_id, status, expires_at, created_at, updated_at
)
SELECT
  tenant_id, project_id, unit_type_id, id,
  '34000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000001',
  'ACTIVE', now() - interval '5 seconds', now() - interval '1 minute', now() - interval '1 minute'
FROM slot;
SQL
}

start_worker() {
  local log_file="$1"
  NODE_ENV=production \
  DATABASE_URL="$DB_URL" \
  NOTIFICATION_GATEWAY_URL=http://127.0.0.1:9/deliver \
  NOTIFICATION_GATEWAY_TOKEN=0123456789abcdef0123456789abcdef \
  INVENTORY_LOCK_EXPIRY_SCAN_MS=100 \
  INVENTORY_LOCK_EXPIRY_BATCH_SIZE=25 \
  OUTBOX_POLL_MS=1000 \
  NOTIFICATION_POLL_MS=1000 \
  SLA_SCAN_MS=60000 \
  INSTALLMENT_REMINDER_SCAN_MS=60000 \
  COMMISSION_DUE_SCAN_MS=60000 \
    pnpm --filter @preneura/worker start >"$log_file" 2>&1 &
  WORKER_PID=$!
}

wait_expired() {
  local ref="$1" log_file="$2"
  for _ in $(seq 1 50); do
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then
      cat "$log_file"
      echo 'Worker exited before expiring the lock.' >&2
      exit 1
    fi
    status="$(psql "$DB_URL" -Atqc "SELECT l.status FROM inventory_locks l JOIN inventory_slots s ON s.id=l.inventory_slot_id WHERE s.internal_reference='$ref'")"
    if [[ "$status" = "EXPIRED" ]]; then return 0; fi
    sleep 0.1
  done
  cat "$log_file"
  echo "Worker did not expire $ref within the certification window." >&2
  exit 1
}

# Restart durability: no request traffic is required before or after worker restart.
seed_restart_lock RESTART-1
start_worker /tmp/lock-worker-first.log
wait_expired RESTART-1 /tmp/lock-worker-first.log
kill "$WORKER_PID"
wait "$WORKER_PID" || true
unset WORKER_PID

seed_restart_lock RESTART-2
start_worker /tmp/lock-worker-second.log
wait_expired RESTART-2 /tmp/lock-worker-second.log
kill "$WORKER_PID"
wait "$WORKER_PID" || true
unset WORKER_PID

grep -q '"event":"worker.ready"' /tmp/lock-worker-first.log
grep -q '"event":"inventory_lock_expiry.processed"' /tmp/lock-worker-first.log
grep -q '"event":"worker.ready"' /tmp/lock-worker-second.log
grep -q '"event":"inventory_lock_expiry.processed"' /tmp/lock-worker-second.log

RESTART_EVENTS="$(psql "$DB_URL" -Atqc "SELECT count(*) FROM domain_outbox_events e JOIN inventory_locks l ON l.id=e.aggregate_id JOIN inventory_slots s ON s.id=l.inventory_slot_id WHERE s.internal_reference IN ('RESTART-1','RESTART-2') AND e.event_type='inventory.lock.expired'")"
test "$RESTART_EVENTS" = "2"

echo 'Gate 2 inventory lock durability certification: PASS'
