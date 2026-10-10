import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { TransactionListService } from '../apps/api/dist/sales/transaction-list.service.js';
import { CommissionService } from '../apps/api/dist/commissions/commission.service.js';
import { CommissionContextService } from '../apps/api/dist/commissions/commission-context.service.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const TENANT_ID = 'aaaaaaaa-6565-4656-8656-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-6565-4656-8656-bbbbbbbbbbbb';
const BROKER_A = 'caaaaaaa-6565-4656-8656-caaaaaaaaaaa';
const BROKER_B = 'cbbbbbbb-6565-4656-8656-cbbbbbbbbbbb';
const MANAGER_ID = '11111111-6565-4656-8656-111111111111';
const FINANCE_ID = '22222222-6565-4656-8656-222222222222';
const AGENT_A_ID = '33333333-6565-4656-8656-333333333333';
const AGENT_B_ID = '44444444-6565-4656-8656-444444444444';
const FOREIGN_AGENT_ID = '55555555-6565-4656-8656-555555555555';

const db = createDatabase(connectionString);

const cases = [
  sampleCase('aaaaaaaa-0001-4000-8000-000000000001', 'aaaaaaaa-1001-4000-8000-000000000001', BROKER_A, AGENT_A_ID, 'ELIGIBLE'),
  sampleCase('aaaaaaaa-0002-4000-8000-000000000002', 'aaaaaaaa-1002-4000-8000-000000000002', BROKER_A, AGENT_B_ID, 'DUE'),
];

const transactionRepository = {
  calls: [],
  async projectExists(tenantId, projectId) {
    return tenantId === TENANT_ID && projectId === PROJECT_ID;
  },
  async list(input) {
    this.calls.push(input);
    return [];
  },
};

const commissionRepository = {
  calls: [],
  async syncBrokerCases() {},
  async listCases(input) {
    this.calls.push(input);
    return cases.filter((item) =>
      item.brokerCompanyId === input.brokerCompanyId &&
      (!input.brokerAgentUserId || item.brokerAgentUserId === input.brokerAgentUserId),
    );
  },
};

const commissionContextRepository = {
  calls: [],
  async listProjectBrokers(input) {
    this.calls.push(input);
    const all = [
      { brokerCompanyId: BROKER_A, code: 'BROKER-A', name: 'Broker A' },
      { brokerCompanyId: BROKER_B, code: 'BROKER-B', name: 'Broker B' },
    ];
    return input.brokerCompanyIds ? all.filter((item) => input.brokerCompanyIds.includes(item.brokerCompanyId)) : all;
  },
};

try {
  await seedIdentityScope();

  const access = new AccessService(new PostgresAccessRepository(db));
  const transactions = new TransactionListService(transactionRepository, access);
  const commissions = new CommissionService(commissionRepository, access);
  const contexts = new CommissionContextService(commissionContextRepository, access);

  await assertRoleMatrix(access);
  await assertTransactionScoping(transactions);
  await assertCommissionScopingAndRedaction(commissions);
  await assertBrokerContextIsolation(contexts);

  console.log('Gate 5 Broker role certification passed.');
} finally {
  await db.destroy();
}

async function seedIdentityScope() {
  await db.insertInto('tenants').values({
    id: TENANT_ID,
    code: 'G5-BROKER-TENANT',
    name: 'Gate 5 Broker Tenant',
    status: 'ACTIVE',
    default_currency: 'EGP',
    default_timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('projects').values({
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    code: 'G5-BROKER-PROJECT',
    name: 'Gate 5 Broker Project',
    status: 'ACTIVE',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('broker_companies').values([
    { id: BROKER_A, tenant_id: TENANT_ID, code: 'BROKER-A', name: 'Broker A', status: 'ACTIVE' },
    { id: BROKER_B, tenant_id: TENANT_ID, code: 'BROKER-B', name: 'Broker B', status: 'ACTIVE' },
  ]).execute();

  const users = [
    [MANAGER_ID, 'Broker Manager'],
    [FINANCE_ID, 'Broker Finance'],
    [AGENT_A_ID, 'Broker Agent A'],
    [AGENT_B_ID, 'Broker Agent B'],
    [FOREIGN_AGENT_ID, 'Foreign Broker Agent'],
  ];
  await db.insertInto('users').values(users.map(([id, displayName]) => ({
    id,
    display_name: displayName,
    status: 'ACTIVE',
  }))).execute();

  await db.insertInto('tenant_memberships').values(users.map(([id]) => ({
    tenant_id: TENANT_ID,
    user_id: id,
    status: 'ACTIVE',
  }))).execute();

  const effectiveFrom = new Date(Date.now() - 86_400_000);
  await db.insertInto('broker_project_access').values([
    { broker_company_id: BROKER_A, tenant_id: TENANT_ID, project_id: PROJECT_ID, status: 'ACTIVE', effective_from: effectiveFrom, effective_to: null },
    { broker_company_id: BROKER_B, tenant_id: TENANT_ID, project_id: PROJECT_ID, status: 'ACTIVE', effective_from: effectiveFrom, effective_to: null },
  ]).execute();

  await db.insertInto('access_role_assignments').values([
    assignment(MANAGER_ID, 'BROKER_MANAGER', BROKER_A),
    assignment(FINANCE_ID, 'BROKER_FINANCE', BROKER_A),
    assignment(AGENT_A_ID, 'BROKER_AGENT', BROKER_A),
    assignment(AGENT_B_ID, 'BROKER_AGENT', BROKER_A),
    assignment(FOREIGN_AGENT_ID, 'BROKER_AGENT', BROKER_B),
  ]).execute();
}

function assignment(userId, roleCode, brokerCompanyId) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'BROKER_COMPANY',
    tenant_id: TENANT_ID,
    project_id: null,
    broker_company_id: brokerCompanyId,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}

async function assertRoleMatrix(access) {
  const contextA = { tenantId: TENANT_ID, projectId: PROJECT_ID, brokerCompanyId: BROKER_A };

  for (const permission of ['broker.users.manage', 'broker.performance.read', 'commission.status.read', 'commission.amount.read', 'commission.rate.read', 'commission.invoice.manage']) {
    assert.equal((await access.can({ userId: MANAGER_ID, permission, context: contextA })).allowed, true, `Broker Manager must have ${permission}.`);
  }
  assert.equal((await access.can({ userId: MANAGER_ID, permission: 'commission.payout.manage', context: contextA })).allowed, false, 'Broker Manager must not settle developer-side payouts.');

  for (const permission of ['broker.performance.read', 'commission.status.read', 'commission.amount.read', 'commission.rate.read', 'commission.invoice.manage']) {
    assert.equal((await access.can({ userId: FINANCE_ID, permission, context: contextA })).allowed, true, `Broker Finance must have ${permission}.`);
  }
  assert.equal((await access.can({ userId: FINANCE_ID, permission: 'broker.users.manage', context: contextA })).allowed, false, 'Broker Finance must not administer broker users.');
  assert.equal((await access.can({ userId: FINANCE_ID, permission: 'commission.payout.manage', context: contextA })).allowed, false, 'Broker Finance must not mark developer-side payouts.');

  assert.equal((await access.can({ userId: AGENT_A_ID, permission: 'commission.status.read', context: contextA })).allowed, true);
  for (const permission of ['commission.amount.read', 'commission.rate.read', 'commission.invoice.manage', 'broker.users.manage']) {
    assert.equal((await access.can({ userId: AGENT_A_ID, permission, context: contextA })).allowed, false, `Broker Agent must not have ${permission}.`);
  }

  const contextB = { tenantId: TENANT_ID, projectId: PROJECT_ID, brokerCompanyId: BROKER_B };
  assert.equal((await access.can({ userId: AGENT_A_ID, permission: 'commission.status.read', context: contextB })).allowed, false, 'Broker Agent must not cross broker-company scope.');
}

async function assertTransactionScoping(transactions) {
  transactionRepository.calls.length = 0;
  await transactions.list({ actorUserId: AGENT_A_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(transactionRepository.calls.at(-1)?.brokerCompanyIds, [BROKER_A]);
  assert.equal(transactionRepository.calls.at(-1)?.brokerAgentUserId, AGENT_A_ID, 'Broker Agent transaction list must be exact-agent scoped.');

  await transactions.list({ actorUserId: MANAGER_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(transactionRepository.calls.at(-1)?.brokerCompanyIds, [BROKER_A]);
  assert.equal(transactionRepository.calls.at(-1)?.brokerAgentUserId, null, 'Broker Manager must see the company portfolio, not only self-attribution.');

  await transactions.list({ actorUserId: FINANCE_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(transactionRepository.calls.at(-1)?.brokerCompanyIds, [BROKER_A]);
  assert.equal(transactionRepository.calls.at(-1)?.brokerAgentUserId, null, 'Broker Finance must see the company portfolio.');
}

async function assertCommissionScopingAndRedaction(commissions) {
  commissionRepository.calls.length = 0;
  const agentRows = await commissions.listCases({
    actorUserId: AGENT_A_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    brokerCompanyId: BROKER_A,
  });
  assert.equal(agentRows.length, 1, 'Broker Agent must receive only own commission cases.');
  assert.equal(agentRows[0]?.brokerAgentUserId, AGENT_A_ID);
  for (const key of ['basisAmount', 'commissionAmount', 'ratePercent']) {
    assert.equal(Object.hasOwn(agentRows[0] ?? {}, key), false, `Broker Agent response leaked ${key}.`);
  }
  assert.equal(commissionRepository.calls.at(-1)?.brokerAgentUserId, AGENT_A_ID);

  const managerRows = await commissions.listCases({
    actorUserId: MANAGER_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    brokerCompanyId: BROKER_A,
  });
  assert.equal(managerRows.length, 2);
  assert.equal(managerRows.every((item) => item.commissionAmount === '25000.00' && item.ratePercent === '2.5000'), true, 'Broker Manager must receive company financial fields.');

  const financeRows = await commissions.listCases({
    actorUserId: FINANCE_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    brokerCompanyId: BROKER_A,
  });
  assert.equal(financeRows.length, 2);
  assert.equal(financeRows.every((item) => item.basisAmount === '1000000.00' && item.commissionAmount === '25000.00' && item.ratePercent === '2.5000'), true, 'Broker Finance must receive company financial fields.');

  await assert.rejects(
    () => commissions.listCases({ actorUserId: AGENT_A_ID, tenantId: TENANT_ID, projectId: PROJECT_ID, brokerCompanyId: BROKER_B }),
    /permission/i,
    'Broker Agent must not read another broker company commission cases.',
  );
}

async function assertBrokerContextIsolation(contexts) {
  commissionContextRepository.calls.length = 0;
  const agentContexts = await contexts.list({ actorUserId: AGENT_A_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(agentContexts.map((item) => item.brokerCompanyId), [BROKER_A]);
  assert.deepEqual(commissionContextRepository.calls.at(-1)?.brokerCompanyIds, [BROKER_A]);

  const managerContexts = await contexts.list({ actorUserId: MANAGER_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(managerContexts.map((item) => item.brokerCompanyId), [BROKER_A]);

  const foreignContexts = await contexts.list({ actorUserId: FOREIGN_AGENT_ID, tenantId: TENANT_ID, projectId: PROJECT_ID });
  assert.deepEqual(foreignContexts.map((item) => item.brokerCompanyId), [BROKER_B]);
}

function sampleCase(commissionCaseId, transactionId, brokerCompanyId, brokerAgentUserId, status) {
  return {
    commissionCaseId,
    transactionId,
    brokerCompanyId,
    brokerAgentUserId,
    buyerProfileId: 'aaaaaaaa-2001-4000-8000-000000000001',
    status,
    completionPercent: '100.00',
    prerequisitesComplete: true,
    eligibleAt: '2026-10-01T00:00:00.000Z',
    dueAt: '2026-10-31T00:00:00.000Z',
    dueInSeconds: 1_000,
    overdueSeconds: null,
    invoicedAt: null,
    paidAt: null,
    basisAmount: '1000000.00',
    commissionAmount: '25000.00',
    ratePercent: '2.5000',
  };
}
