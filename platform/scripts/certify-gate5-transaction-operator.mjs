import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { TransactionOperationsService } from '../apps/api/dist/sales/transaction-operations.service.js';
import { classifyTransactionOperation } from '../apps/api/dist/sales/transaction-operations-classifier.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const TENANT_ID = '66000000-0000-4000-8000-000000000001';
const PROJECT_ID = '66000000-0000-4000-8000-000000000002';
const OPERATOR_ID = '66000000-0000-4000-8000-000000000011';
const MANAGER_ID = '66000000-0000-4000-8000-000000000012';
const DIRECTOR_ID = '66000000-0000-4000-8000-000000000013';
const SALES_ID = '66000000-0000-4000-8000-000000000014';
const BUYER_ID = '66000000-0000-4000-8000-000000000015';

const db = createDatabase(connectionString);

const emptyQueue = {
  generatedAt: '2026-10-10T10:00:00.000Z',
  counts: {
    NEEDS_DOCUMENTS: 0,
    NEEDS_PAYMENT: 0,
    NEEDS_CHEQUES: 0,
    NEEDS_CONTRACT: 0,
    NEEDS_BUYER_SIGNATURE: 0,
    NEEDS_COMPANY_EXECUTION: 0,
    READY_TO_COMPLETE: 0,
  },
  items: [],
};

const fakeRepository = {
  calls: [],
  async projectExists(tenantId, projectId) {
    return tenantId === TENANT_ID && projectId === PROJECT_ID;
  },
  async queue(input) {
    this.calls.push(input);
    return emptyQueue;
  },
};

try {
  await seedAccess();

  const access = new AccessService(new PostgresAccessRepository(db));
  const service = new TransactionOperationsService(fakeRepository, access);

  await assertAuthorization(access, service);
  assertClassificationMatrix();

  console.log('Gate 5 Transaction Operator certification passed.');
} finally {
  await db.destroy();
}

async function seedAccess() {
  await db.insertInto('users').values([
    { id: OPERATOR_ID, display_name: 'Transaction Operator', status: 'ACTIVE' },
    { id: MANAGER_ID, display_name: 'Project Manager', status: 'ACTIVE' },
    { id: DIRECTOR_ID, display_name: 'Operations Director', status: 'ACTIVE' },
    { id: SALES_ID, display_name: 'Sales User', status: 'ACTIVE' },
    { id: BUYER_ID, display_name: 'Buyer User', status: 'ACTIVE' },
  ]).execute();

  await db.insertInto('tenants').values({
    id: TENANT_ID,
    code: 'G5-TXN-OPS',
    name: 'Gate 5 Transaction Operations Tenant',
    status: 'ACTIVE',
    default_currency: 'EGP',
    default_timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('projects').values({
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    code: 'G5-TXN-PROJECT',
    name: 'Gate 5 Transaction Operations Project',
    status: 'ACTIVE',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('tenant_memberships').values([
    OPERATOR_ID,
    MANAGER_ID,
    DIRECTOR_ID,
    SALES_ID,
    BUYER_ID,
  ].map((userId) => ({ tenant_id: TENANT_ID, user_id: userId, status: 'ACTIVE' }))).execute();

  await db.insertInto('access_role_assignments').values([
    projectAssignment(OPERATOR_ID, 'TRANSACTION_OPERATOR'),
    projectAssignment(MANAGER_ID, 'MANAGER'),
    tenantAssignment(DIRECTOR_ID, 'OPERATIONS_DIRECTOR'),
    projectAssignment(SALES_ID, 'SALES'),
    projectAssignment(BUYER_ID, 'BUYER'),
  ]).execute();
}

function projectAssignment(userId, roleCode) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'PROJECT',
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    broker_company_id: null,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}

function tenantAssignment(userId, roleCode) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'TENANT',
    tenant_id: TENANT_ID,
    project_id: null,
    broker_company_id: null,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}

async function assertAuthorization(access, service) {
  const context = { tenantId: TENANT_ID, projectId: PROJECT_ID };
  for (const userId of [OPERATOR_ID, MANAGER_ID, DIRECTOR_ID]) {
    assert.equal(
      (await access.can({ userId, permission: 'transaction.manage', context })).allowed,
      true,
      `${userId} must have transaction.manage.`,
    );
    const result = await service.queue({ actorUserId: userId, ...context });
    assert.equal(result, emptyQueue);
  }

  for (const userId of [SALES_ID, BUYER_ID]) {
    assert.equal(
      (await access.can({ userId, permission: 'transaction.manage', context })).allowed,
      false,
      `${userId} must not have transaction.manage.`,
    );
    await assert.rejects(
      () => service.queue({ actorUserId: userId, ...context }),
      /permission/i,
      'Non-transaction roles must be denied the completion queue.',
    );
  }

  assert.equal(fakeRepository.calls.length, 3, 'Denied roles must not reach the queue repository.');
}

function assertClassificationMatrix() {
  const pending = (code, label = code) => ({ code, label, status: 'PENDING' });
  const done = (code, label = code) => ({ code, label, status: 'COMPLETED' });
  const waived = (code, label = code) => ({ code, label, status: 'WAIVED' });
  const base = [
    done('BUYER_DOCUMENTS_COMPLETE'),
    done('DOWN_PAYMENT_RECEIVED'),
    done('CHEQUES_RECEIVED'),
    done('CONTRACT_GENERATED'),
    done('CONTRACT_SIGNED'),
    done('CONTRACT_STAMPED'),
  ];
  const replace = (code, milestone) => base.map((item) => item.code === code ? milestone : item);

  assertBucket([pending('BUYER_DOCUMENTS_COMPLETE'), ...base.slice(1)], null, [], 'NEEDS_DOCUMENTS');
  assertBucket(replace('DOWN_PAYMENT_RECEIVED', pending('DOWN_PAYMENT_RECEIVED')), null, [], 'NEEDS_PAYMENT');
  assertBucket(replace('CHEQUES_RECEIVED', pending('CHEQUES_RECEIVED')), null, [], 'NEEDS_CHEQUES');
  assertBucket(replace('CONTRACT_GENERATED', pending('CONTRACT_GENERATED')), null, [], 'NEEDS_CONTRACT');
  assertBucket(base, null, [], 'NEEDS_CONTRACT', 'A generated milestone without an actual current contract must not pass.');
  assertBucket(replace('CONTRACT_SIGNED', pending('CONTRACT_SIGNED')), 'contract-1', ['BUYER', 'COMPANY'], 'NEEDS_BUYER_SIGNATURE');
  assertBucket(replace('CONTRACT_SIGNED', pending('CONTRACT_SIGNED')), 'contract-1', ['COMPANY'], 'NEEDS_COMPANY_EXECUTION');
  assertBucket(replace('CONTRACT_STAMPED', pending('CONTRACT_STAMPED')), 'contract-1', [], 'NEEDS_COMPANY_EXECUTION');
  assertBucket(replace('BUYER_DOCUMENTS_COMPLETE', waived('BUYER_DOCUMENTS_COMPLETE')), 'contract-1', [], 'READY_TO_COMPLETE', 'Waived milestones must count as satisfied.');
  assertBucket(base, 'contract-1', [], 'READY_TO_COMPLETE');
}

function assertBucket(milestones, contractDocumentId, missingSignerRoles, expected, message) {
  const result = classifyTransactionOperation({ milestones, contractDocumentId, missingSignerRoles });
  assert.equal(result.bucket, expected, message ?? `Expected ${expected}, got ${result.bucket}.`);
  assert.ok(result.nextAction.length > 0, 'Every queue bucket must have an actionable next-step message.');
}
