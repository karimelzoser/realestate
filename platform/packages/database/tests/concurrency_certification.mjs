import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({
  connectionString,
  max: 100,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
});

const TENANT_ID = '00000000-0000-0000-0000-000000001000';
const PROJECT_ID = '00000000-0000-0000-0000-000000002000';
const ACTOR_ID = '00000000-0000-0000-0000-000000000001';
const EOI_POLICY_ID = '00000000-0000-0000-0000-000000007000';
const TRANSACTION_ID = '00000000-0000-0000-0000-000000013000';
const DOWN_PAYMENT_ITEM_ID = '00000000-0000-0000-0000-000000015001';
const INSTALLMENT_ITEM_ID = '00000000-0000-0000-0000-000000015002';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withTimeout(label, promise, ms = 60_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function settleAttempts(count, fn) {
  const startedAt = Date.now();
  const results = await withTimeout(
    `concurrency batch (${count})`,
    Promise.allSettled(Array.from({ length: count }, (_, index) => fn(index))),
  );
  return {
    elapsedMs: Date.now() - startedAt,
    fulfilled: results.filter((result) => result.status === 'fulfilled'),
    rejected: results.filter((result) => result.status === 'rejected'),
  };
}

async function certifyInventoryLockContention() {
  const unitTypeId = randomUUID();
  const slotId = randomUUID();

  await pool.query(
    `INSERT INTO catalog_unit_types (
       id, tenant_id, project_id, code, name, indoor_area_sqm, roof_area_sqm,
       garden_area_sqm, status, sort_order
     ) VALUES ($1,$2,$3,$4,$5,100,0,0,'ACTIVE',900)`,
    [unitTypeId, TENANT_ID, PROJECT_ID, `CONC-${unitTypeId.slice(0, 8)}`, 'Concurrency Lock Type'],
  );
  await pool.query(
    `INSERT INTO inventory_slots (id, tenant_id, project_id, unit_type_id, state, internal_reference)
     VALUES ($1,$2,$3,$4,'AVAILABLE',$5)`,
    [slotId, TENANT_ID, PROJECT_ID, unitTypeId, `CONC-SLOT-${slotId.slice(0, 8)}`],
  );

  const attempts = await settleAttempts(500, async (index) =>
    inTransaction(async (client) => {
      const candidate = await client.query(
        `SELECT s.id
         FROM inventory_slots s
         WHERE s.tenant_id=$1
           AND s.project_id=$2
           AND s.unit_type_id=$3
           AND s.state='AVAILABLE'
           AND NOT EXISTS (
             SELECT 1 FROM inventory_locks l
             WHERE l.inventory_slot_id=s.id AND l.status='ACTIVE'
           )
         ORDER BY s.created_at ASC, s.id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [TENANT_ID, PROJECT_ID, unitTypeId],
      );
      if (candidate.rowCount === 0) return null;
      const lockId = randomUUID();
      await client.query(
        `INSERT INTO inventory_locks (
           id, tenant_id, project_id, unit_type_id, inventory_slot_id,
           buyer_user_id, locked_by_user_id, status, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$6,'ACTIVE',now()+interval '15 minutes')`,
        [lockId, TENANT_ID, PROJECT_ID, unitTypeId, slotId, ACTOR_ID],
      );
      return { index, lockId };
    }),
  );

  const successes = attempts.fulfilled.map((entry) => entry.value).filter(Boolean);
  assert(attempts.rejected.length === 0, `inventory lock batch had ${attempts.rejected.length} unexpected errors`);
  assert(successes.length === 1, `expected exactly one inventory lock success, got ${successes.length}`);

  const state = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status='ACTIVE')::int AS active_count,
       count(DISTINCT inventory_slot_id) FILTER (WHERE status='ACTIVE')::int AS active_slots
     FROM inventory_locks WHERE unit_type_id=$1`,
    [unitTypeId],
  );
  assert(state.rows[0].active_count === 1, `expected one active lock, got ${state.rows[0].active_count}`);
  assert(state.rows[0].active_slots === 1, 'active lock does not map to exactly one slot');

  return { attempts: 500, successes: 1, elapsedMs: attempts.elapsedMs };
}

async function seedQueueEntries(count) {
  const queueIds = [];
  for (let index = 0; index < count; index += 1) {
    const userId = randomUUID();
    const buyerProfileId = randomUUID();
    const eoiId = randomUUID();
    const queueId = randomUUID();
    queueIds.push(queueId);
    await pool.query(`INSERT INTO users (id, display_name, status) VALUES ($1,$2,'ACTIVE')`, [userId, `Concurrency Buyer ${index}`]);
    await pool.query(
      `INSERT INTO buyer_profiles (id, tenant_id, user_id, status, source, created_by)
       VALUES ($1,$2,$3,'ACTIVE','DIRECT',$4)`,
      [buyerProfileId, TENANT_ID, userId, ACTOR_ID],
    );
    await pool.query(
      `INSERT INTO buyer_eois (
         id, tenant_id, project_id, buyer_profile_id, refund_policy_id,
         amount, currency, status, payment_reference, paid_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,1000,'EGP','PAID',$6,now(),$7)`,
      [eoiId, TENANT_ID, PROJECT_ID, buyerProfileId, EOI_POLICY_ID, `CONC-EOI-${index}`, ACTOR_ID],
    );
    await pool.query(
      `INSERT INTO queue_entries (
         id, tenant_id, project_id, buyer_profile_id, eoi_id, channel,
         priority_group, priority_score, status, checked_in_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,'ONLINE',$6,$7,'WAITING',now()+($8 * interval '1 millisecond'),$9)`,
      [
        queueId,
        TENANT_ID,
        PROJECT_ID,
        buyerProfileId,
        eoiId,
        index % 10 === 0 ? 'VIP' : index % 7 === 0 ? 'RECOVERY' : 'STANDARD',
        index % 5,
        index,
        ACTOR_ID,
      ],
    );
  }
  return queueIds;
}

async function certifyQueueDispatchContention() {
  const queueIds = await seedQueueEntries(50);

  const attempts = await settleAttempts(100, async () =>
    inTransaction(async (client) => {
      const candidate = await client.query(
        `SELECT q.id
         FROM queue_entries q
         WHERE q.tenant_id=$1 AND q.project_id=$2 AND q.status='WAITING'
         ORDER BY
           CASE q.priority_group WHEN 'VIP' THEN 3 WHEN 'RECOVERY' THEN 2 ELSE 1 END DESC,
           q.priority_score DESC,
           q.checked_in_at ASC,
           q.id ASC
         FOR UPDATE OF q SKIP LOCKED
         LIMIT 1`,
        [TENANT_ID, PROJECT_ID],
      );
      if (candidate.rowCount === 0) return null;
      const queueId = candidate.rows[0].id;
      const updated = await client.query(
        `UPDATE queue_entries
         SET status='CALLED', called_at=now(), updated_at=now()
         WHERE id=$1 AND status='WAITING'
         RETURNING id`,
        [queueId],
      );
      assert(updated.rowCount === 1, 'claimed queue row was not transitioned exactly once');
      return queueId;
    }),
  );

  assert(attempts.rejected.length === 0, `queue batch had ${attempts.rejected.length} unexpected errors`);
  const called = attempts.fulfilled.map((entry) => entry.value).filter(Boolean);
  assert(called.length === 50, `expected 50 called queue entries, got ${called.length}`);
  assert(new Set(called).size === 50, 'same queue entry was claimed more than once');

  const state = await pool.query(
    `SELECT status, count(*)::int AS count
     FROM queue_entries WHERE id = ANY($1::uuid[]) GROUP BY status`,
    [queueIds],
  );
  const calledCount = state.rows.find((row) => row.status === 'CALLED')?.count ?? 0;
  assert(calledCount === 50, `database has ${calledCount} CALLED rows instead of 50`);

  return { attempts: 100, claimed: 50, elapsedMs: attempts.elapsedMs };
}

async function postFinanceEvent({ amount, externalReference, allocations, relatedEventId = null, eventType = 'PAYMENT_RECEIVED' }) {
  const result = await pool.query(
    `SELECT preneura_post_finance_event(
       $1,$2,$3,$4,$5,'EGP','MANUAL',$6,$7,now(),$8::jsonb,NULL,NULL,$9,$10::jsonb
     ) AS id`,
    [
      TENANT_ID,
      PROJECT_ID,
      TRANSACTION_ID,
      eventType,
      amount,
      externalReference,
      ACTOR_ID,
      JSON.stringify(allocations),
      relatedEventId,
      JSON.stringify({ concurrencyCertification: true }),
    ],
  );
  return result.rows[0].id;
}

async function certifyFinanceAllocationContention() {
  const attempts = await settleAttempts(54, async (index) =>
    postFinanceEvent({
      amount: 2500,
      externalReference: `CONC-ALLOC-${index}`,
      allocations: [{ paymentItemId: INSTALLMENT_ITEM_ID, amount: 2500 }],
    }),
  );

  assert(attempts.fulfilled.length === 53, `expected 53 successful allocations, got ${attempts.fulfilled.length}`);
  assert(attempts.rejected.length === 1, `expected one over-allocation rejection, got ${attempts.rejected.length}`);

  const item = await pool.query(`SELECT amount, paid_amount, status FROM payment_schedule_items WHERE id=$1`, [INSTALLMENT_ITEM_ID]);
  assert(Number(item.rows[0].amount) === 132500, 'installment amount changed');
  assert(Number(item.rows[0].paid_amount) === 132500, `installment paid amount is ${item.rows[0].paid_amount}`);
  assert(item.rows[0].status === 'PAID', `installment projection is ${item.rows[0].status}`);

  const allocation = await pool.query(
    `SELECT coalesce(sum(a.amount),0)::numeric AS total
     FROM finance_payment_allocations a
     JOIN finance_payment_events e ON e.id=a.payment_event_id
     WHERE a.payment_schedule_item_id=$1 AND e.external_reference LIKE 'CONC-ALLOC-%'`,
    [INSTALLMENT_ITEM_ID],
  );
  assert(Number(allocation.rows[0].total) === 132500, `allocation sum is ${allocation.rows[0].total}`);

  const unbalanced = await pool.query(
    `SELECT count(*)::int AS count FROM (
       SELECT e.id
       FROM finance_payment_events e
       JOIN finance_ledger_entries l ON l.payment_event_id=e.id
       WHERE e.external_reference LIKE 'CONC-ALLOC-%'
       GROUP BY e.id
       HAVING count(l.id) <> 2 OR coalesce(sum(l.signed_amount),0) <> 0
     ) x`,
  );
  assert(unbalanced.rows[0].count === 0, 'a concurrent receipt produced an unbalanced ledger event');

  return { attempts: 54, successes: 53, rejected: 1, elapsedMs: attempts.elapsedMs };
}

async function certifyFinanceCompensationContention() {
  const original = await pool.query(
    `SELECT e.id AS event_id, a.id AS allocation_id
     FROM finance_payment_events e
     JOIN finance_payment_allocations a ON a.payment_event_id=e.id
     WHERE e.external_reference='BACKUP-PAYMENT-001'
       AND a.payment_schedule_item_id=$1
     LIMIT 1`,
    [DOWN_PAYMENT_ITEM_ID],
  );
  assert(original.rowCount === 1, 'backup seed original payment/allocation not found');
  const { event_id: eventId, allocation_id: allocationId } = original.rows[0];

  const attempts = await settleAttempts(20, async (index) =>
    postFinanceEvent({
      amount: 10000,
      externalReference: `CONC-REV-${index}`,
      eventType: 'PAYMENT_REVERSED',
      relatedEventId: eventId,
      allocations: [
        {
          paymentItemId: DOWN_PAYMENT_ITEM_ID,
          amount: -10000,
          originalAllocationId: allocationId,
        },
      ],
    }),
  );

  assert(attempts.fulfilled.length === 10, `expected 10 successful compensations, got ${attempts.fulfilled.length}`);
  assert(attempts.rejected.length === 10, `expected 10 compensation rejections, got ${attempts.rejected.length}`);

  const compensated = await pool.query(
    `SELECT coalesce(sum(amount),0)::numeric AS total
     FROM finance_payment_events
     WHERE related_event_id=$1 AND event_type='PAYMENT_REVERSED'`,
    [eventId],
  );
  assert(Number(compensated.rows[0].total) === 100000, `compensated amount is ${compensated.rows[0].total}`);

  const item = await pool.query(`SELECT paid_amount FROM payment_schedule_items WHERE id=$1`, [DOWN_PAYMENT_ITEM_ID]);
  assert(Number(item.rows[0].paid_amount) === 0, `down payment became ${item.rows[0].paid_amount}, expected zero`);

  return { attempts: 20, successes: 10, rejected: 10, elapsedMs: attempts.elapsedMs };
}

async function certifyProviderReplayContention() {
  const provider = 'CONCURRENCY_PROVIDER';
  const providerEventId = 'provider-event-001';
  const occurredAt = '2026-10-07T09:00:00.000Z';
  const payloadHash = 'd'.repeat(64);

  const attempts = await settleAttempts(100, async () => {
    const result = await pool.query(
      `SELECT preneura_ingest_provider_finance_event(
         $1,$2,$3,$4,$5,$6,'PAYMENT_RECEIVED',1000,'EGP','CONC-PROVIDER-001',$7,NULL
       ) AS id`,
      [provider, providerEventId, payloadHash, TENANT_ID, PROJECT_ID, TRANSACTION_ID, occurredAt],
    );
    return result.rows[0].id;
  });

  assert(attempts.rejected.length === 0, `provider replay batch had ${attempts.rejected.length} errors`);
  const eventIds = attempts.fulfilled.map((entry) => entry.value);
  assert(new Set(eventIds).size === 1, `provider replay produced ${new Set(eventIds).size} payment event IDs`);

  const inbox = await pool.query(
    `SELECT count(*)::int AS count, min(status) AS status, min(payment_event_id)::text AS payment_event_id
     FROM finance_provider_webhook_events WHERE provider=$1 AND provider_event_id=$2`,
    [provider, providerEventId],
  );
  assert(inbox.rows[0].count === 1, `provider inbox contains ${inbox.rows[0].count} rows`);
  assert(inbox.rows[0].status === 'PROCESSED', `provider inbox status is ${inbox.rows[0].status}`);
  assert(inbox.rows[0].payment_event_id === eventIds[0], 'provider inbox points to a different payment event');

  const events = await pool.query(
    `SELECT count(*)::int AS count FROM finance_payment_events WHERE provider=$1 AND provider_event_id=$2`,
    [provider, providerEventId],
  );
  assert(events.rows[0].count === 1, `provider replay created ${events.rows[0].count} payment events`);

  return { attempts: 100, uniquePaymentEvents: 1, elapsedMs: attempts.elapsedMs };
}

async function main() {
  try {
    const results = {};
    results.inventory = await certifyInventoryLockContention();
    results.queue = await certifyQueueDispatchContention();
    results.paymentAllocation = await certifyFinanceAllocationContention();
    results.compensation = await certifyFinanceCompensationContention();
    results.providerReplay = await certifyProviderReplayContention();
    console.log(JSON.stringify({ status: 'passed', ...results }, null, 2));
  } finally {
    await pool.end();
  }
}

await main();
