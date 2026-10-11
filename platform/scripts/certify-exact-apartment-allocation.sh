#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT_DIR/platform/packages/database/tests/exact_apartment_allocation_fixture.sql"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$FIXTURE"

TENANT='a1000000-0000-4000-8000-000000000001'
PROJECT='a2000000-0000-4000-8000-000000000001'
OPERATOR='a0000000-0000-4000-8000-000000000001'
QUEUE1='ad000000-0000-4000-8000-000000000001'
QUEUE2='ad000000-0000-4000-8000-000000000002'
UNIT_A1='a8000000-0000-4000-8000-000000000001'
UNIT_B1='a8000000-0000-4000-8000-000000000003'

# An EOI for TYPE-A must never lock a TYPE-B physical apartment.
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT lock_id FROM preneura_lock_exact_physical_unit(
    '$TENANT'::uuid, '$PROJECT'::uuid, '$QUEUE1'::uuid, '$UNIT_B1'::uuid,
    '$OPERATOR'::uuid, 180, now()
  );
" >/tmp/preneura-allocation-mismatch.out 2>&1
mismatch_status=$?
set -e
if [[ $mismatch_status -eq 0 ]]; then
  echo 'ERROR: type-mismatched physical unit lock was accepted.' >&2
  cat /tmp/preneura-allocation-mismatch.out >&2
  exit 1
fi

# EOI unit type is a snapshot and cannot be changed after selection.
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  UPDATE buyer_eois
  SET unit_type_id = 'a3000000-0000-4000-8000-000000000002'::uuid
  WHERE id = 'ac000000-0000-4000-8000-000000000001'::uuid;
" >/tmp/preneura-eoi-mutation.out 2>&1
mutation_status=$?
set -e
if [[ $mutation_status -eq 0 ]]; then
  echo 'ERROR: EOI unit type mutation was accepted.' >&2
  exit 1
fi

# Anonymous locks are no longer valid in runtime schema 34.
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  INSERT INTO inventory_locks (
    tenant_id, project_id, unit_type_id, inventory_slot_id,
    buyer_user_id, locked_by_user_id, status, expires_at
  ) VALUES (
    '$TENANT'::uuid, '$PROJECT'::uuid,
    'a3000000-0000-4000-8000-000000000001'::uuid,
    'a9000000-0000-4000-8000-000000000002'::uuid,
    'a0000000-0000-4000-8000-000000000002'::uuid,
    '$OPERATOR'::uuid, 'ACTIVE', now() + interval '3 minutes'
  );
" >/tmp/preneura-anonymous-lock.out 2>&1
anonymous_status=$?
set -e
if [[ $anonymous_status -eq 0 ]]; then
  echo 'ERROR: anonymous inventory lock was accepted.' >&2
  exit 1
fi

# Two independent PostgreSQL sessions race for the same physical apartment.
# Exactly one must commit successfully.
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT lock_id FROM preneura_lock_exact_physical_unit(
    '$TENANT'::uuid, '$PROJECT'::uuid, '$QUEUE1'::uuid, '$UNIT_A1'::uuid,
    '$OPERATOR'::uuid, 180, now()
  );
" >/tmp/preneura-lock-1.out 2>&1 &
pid1=$!
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  SELECT lock_id FROM preneura_lock_exact_physical_unit(
    '$TENANT'::uuid, '$PROJECT'::uuid, '$QUEUE2'::uuid, '$UNIT_A1'::uuid,
    '$OPERATOR'::uuid, 180, now()
  );
" >/tmp/preneura-lock-2.out 2>&1 &
pid2=$!
wait "$pid1"; status1=$?
wait "$pid2"; status2=$?
set -e

successes=0
[[ $status1 -eq 0 ]] && successes=$((successes + 1))
[[ $status2 -eq 0 ]] && successes=$((successes + 1))
if [[ $successes -ne 1 ]]; then
  echo "ERROR: expected exactly one successful exact-unit lock, got $successes." >&2
  echo '--- session 1 ---' >&2; cat /tmp/preneura-lock-1.out >&2 || true
  echo '--- session 2 ---' >&2; cat /tmp/preneura-lock-2.out >&2 || true
  exit 1
fi

active_count="$(psql "$DATABASE_URL" -Atc "
  SELECT count(*)
  FROM inventory_locks
  WHERE physical_unit_id = '$UNIT_A1'::uuid AND status = 'ACTIVE';
")"
if [[ "$active_count" != '1' ]]; then
  echo "ERROR: physical apartment has $active_count active locks; expected 1." >&2
  exit 1
fi

# Convert the winning exact lock into a reservation and prove the exact unit and
# canonical price are snapshotted. The losing buyer remains uncommitted.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  v_lock inventory_locks%ROWTYPE;
  v_queue queue_entries%ROWTYPE;
  v_buyer buyer_profiles%ROWTYPE;
  v_reservation uuid;
  v_component_count integer;
  v_snapshot_total numeric(18,2);
BEGIN
  SELECT * INTO STRICT v_lock
  FROM inventory_locks
  WHERE physical_unit_id = 'a8000000-0000-4000-8000-000000000001'::uuid
    AND status = 'ACTIVE'
  FOR UPDATE;

  SELECT q.* INTO STRICT v_queue
  FROM queue_entries q
  JOIN buyer_profiles b ON b.id = q.buyer_profile_id
  WHERE q.project_id = 'a2000000-0000-4000-8000-000000000001'::uuid
    AND b.user_id = v_lock.buyer_user_id
    AND q.status = 'LOCKED'
  FOR UPDATE OF q;

  SELECT * INTO STRICT v_buyer FROM buyer_profiles WHERE id = v_queue.buyer_profile_id;

  UPDATE inventory_locks
  SET status = 'CONVERTED', converted_at = now(), updated_at = now()
  WHERE id = v_lock.id;

  UPDATE inventory_slots
  SET state = 'RESERVED', updated_at = now()
  WHERE id = v_lock.inventory_slot_id AND state = 'AVAILABLE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'winning exact slot was not available for conversion';
  END IF;

  INSERT INTO reservations (
    tenant_id, project_id, buyer_profile_id, queue_entry_id,
    inventory_lock_id, inventory_slot_id, unit_type_id, physical_unit_id,
    pricing_version_id, quoted_total, currency, status, reserved_by, reserved_at
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a2000000-0000-4000-8000-000000000001'::uuid,
    v_buyer.id,
    v_queue.id,
    v_lock.id,
    v_lock.inventory_slot_id,
    v_lock.unit_type_id,
    v_lock.physical_unit_id,
    'a4000000-0000-4000-8000-000000000001'::uuid,
    5000000.00,
    'EGP',
    'ACTIVE',
    'a0000000-0000-4000-8000-000000000001'::uuid,
    now()
  ) RETURNING id INTO v_reservation;

  IF (SELECT physical_unit_id FROM reservations WHERE id = v_reservation)
       IS DISTINCT FROM 'a8000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'reservation did not snapshot the winning exact physical unit';
  END IF;

  SELECT count(*), round(sum(amount), 2)
  INTO v_component_count, v_snapshot_total
  FROM reservation_price_components
  WHERE reservation_id = v_reservation;

  IF v_component_count <> 3 OR v_snapshot_total IS DISTINCT FROM 5000000.00::numeric THEN
    RAISE EXCEPTION 'reservation price snapshot is incomplete or incorrect: count %, total %',
      v_component_count, v_snapshot_total;
  END IF;
END $$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO inventory_locks (
      tenant_id, project_id, unit_type_id, inventory_slot_id, physical_unit_id,
      buyer_user_id, locked_by_user_id, status, expires_at
    ) VALUES (
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'a2000000-0000-4000-8000-000000000001'::uuid,
      'a3000000-0000-4000-8000-000000000001'::uuid,
      'a9000000-0000-4000-8000-000000000003'::uuid,
      'a8000000-0000-4000-8000-000000000003'::uuid,
      'a0000000-0000-4000-8000-000000000003'::uuid,
      'a0000000-0000-4000-8000-000000000001'::uuid,
      'ACTIVE', now() + interval '3 minutes'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'cross-type lock identity mismatch was not rejected';
  END IF;
END $$;

SELECT 'exact apartment allocation certification passed' AS result;
SQL
