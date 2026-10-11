import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { SalesRepository } from '../dist/sales/sales.repository.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString || process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) {
  throw new Error('EOI certification requires NODE_ENV=test and a disposable loopback PostgreSQL database.');
}
const pool = new pg.Pool({ connectionString, max: 8 });
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
const repo = new SalesRepository(db);
const tenantId = randomUUID(), projectId = randomUUID(), secondProjectId = randomUUID();
const actorUserId = randomUUID(), buyerProfileId = randomUUID(), unitTypeId = randomUUID(), otherTypeId = randomUUID();
const refundPolicyId = randomUUID(), nextPolicyId = randomUUID();
const query = (text, values = []) => pool.query(text, values);
const input = { actorUserId, tenantId, projectId, buyerProfileId, unitTypeId, refundPolicyId, now: new Date() };
try {
  await query(`INSERT INTO users(id,display_name,status) VALUES($1,'Synthetic EOI Buyer','ACTIVE')`, [actorUserId]);
  await query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,'EOI certification','ACTIVE')`, [tenantId, `EOI-${tenantId}`]);
  await query(`INSERT INTO projects(id,tenant_id,code,name,status,currency,timezone) VALUES
    ($1,$3,'P1','EOI project','ACTIVE','EGP','Africa/Cairo'),($2,$3,'P2','Other project','ACTIVE','EGP','Africa/Cairo')`, [projectId, secondProjectId, tenantId]);
  await query(`INSERT INTO buyer_profiles(id,tenant_id,user_id,status,source,created_by) VALUES($1,$2,$3,'ACTIVE','DIRECT',$3)`, [buyerProfileId, tenantId, actorUserId]);
  await query(`INSERT INTO catalog_unit_types(id,tenant_id,project_id,code,name,indoor_area_sqm,status) VALUES
    ($1,$3,$4,'A','Selected Type A',100,'ACTIVE'),($2,$3,$5,'B','Other Project Type',100,'ACTIVE')`, [unitTypeId, otherTypeId, tenantId, projectId, secondProjectId]);
  await query(`INSERT INTO eoi_refund_policies(id,tenant_id,project_id,version_number,name,status,eoi_amount,currency,effective_at,published_at)
    VALUES($1,$2,$3,1,'Accepted policy','ACTIVE',25000,'EGP',now()-interval '1 day',now()-interval '1 day')`, [refundPolicyId, tenantId, projectId]);

  await assert.rejects(repo.createEoi({ ...input, unitTypeId: otherTypeId }), /Active apartment type not found/);
  await query(`UPDATE catalog_unit_types SET status='HIDDEN' WHERE id=$1`, [unitTypeId]);
  await assert.rejects(repo.createEoi(input), /Active apartment type not found/);
  await query(`UPDATE catalog_unit_types SET status='ACTIVE' WHERE id=$1`, [unitTypeId]);
  const policy = await repo.activeEoiPolicy(input);
  assert.equal(policy.refundPolicyId, refundPolicyId);
  assert.equal(policy.amount, '25000.00');

  const [first, retry] = await Promise.all([repo.createEoi(input), repo.createEoi(input)]);
  assert.equal(first.eoiId, retry.eoiId, 'concurrent retry must return the same live EOI');
  const evidence = (await query(`SELECT selected_unit_type_id,selected_unit_type_snapshot,policy_accepted_by,policy_accepted_at,
    accepted_policy_snapshot FROM buyer_eois WHERE id=$1`, [first.eoiId])).rows[0];
  assert.equal(evidence.selected_unit_type_id, unitTypeId);
  assert.equal(evidence.selected_unit_type_snapshot.name, 'Selected Type A');
  assert.equal(evidence.policy_accepted_by, actorUserId);
  assert.ok(evidence.policy_accepted_at);
  assert.equal(evidence.accepted_policy_snapshot.versionNumber, 1);
  assert.equal((await query(`SELECT count(*)::int AS n FROM domain_outbox_events WHERE aggregate_id=$1 AND event_type='eoi.created'`, [first.eoiId])).rows[0].n, 1);
  assert.equal((await query(`SELECT count(*)::int AS n FROM inventory_locks WHERE project_id=$1`, [projectId])).rows[0].n, 0, 'EOI must not acquire physical inventory');

  await assert.rejects(query(`UPDATE buyer_eois SET selected_unit_type_id=NULL WHERE id=$1`, [first.eoiId]), /immutable/);
  await assert.rejects(query(`UPDATE buyer_eois SET accepted_policy_snapshot='{}'::jsonb WHERE id=$1`, [first.eoiId]), /immutable/);
  await assert.rejects(query(`UPDATE eoi_refund_policies SET processing_fee=100 WHERE id=$1`, [refundPolicyId]), /immutable/);
  await query(`UPDATE catalog_unit_types SET name='Later renamed type' WHERE id=$1`, [unitTypeId]);
  assert.equal((await query(`SELECT selected_unit_type_snapshot->>'name' AS name FROM buyer_eois WHERE id=$1`, [first.eoiId])).rows[0].name, 'Selected Type A');

  await query(`UPDATE eoi_refund_policies SET status='RETIRED' WHERE id=$1`, [refundPolicyId]);
  await query(`INSERT INTO eoi_refund_policies(id,tenant_id,project_id,version_number,name,status,eoi_amount,currency,effective_at,published_at)
    VALUES($1,$2,$3,2,'New policy','ACTIVE',30000,'EGP',now()-interval '1 hour',now())`, [nextPolicyId, tenantId, projectId]);
  await assert.rejects(repo.createEoi({ ...input, now: new Date() }), /policy changed/);
  await assert.rejects(repo.createEoi({ ...input, refundPolicyId: nextPolicyId, now: new Date() }), /different selection or policy/);
  await query(`UPDATE projects SET status='PAUSED' WHERE id=$1`, [projectId]);
  await assert.rejects(repo.createEoi(input), /not open for EOI/);
  await query(`UPDATE projects SET status='ACTIVE' WHERE id=$1`, [projectId]);
  await assert.rejects(query(`INSERT INTO buyer_eois(tenant_id,project_id,buyer_profile_id,refund_policy_id,amount,currency,created_by)
    VALUES($1,$2,$3,$4,30000,'EGP',$5)`, [tenantId, projectId, buyerProfileId, nextPolicyId, actorUserId]), /requires selected apartment type/);
  console.log(JSON.stringify({ result: 'E05_EOI_CHOICE_CERTIFICATION_OK', concurrentRetry: true,
    scopedType: true, acceptedPolicyImmutable: true, stalePolicyRejected: true, noInventoryHold: true }));
} finally {
  await db.destroy();
}
