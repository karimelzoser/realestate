import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { roleHasPermission } from '../packages/contracts/dist/access.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { PlatformAdminRepository } from '../apps/api/dist/platform-admin/platform-admin.repository.js';
import { PlatformAdminService } from '../apps/api/dist/platform-admin/platform-admin.service.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const TENANT_ID = '68000000-0000-4000-8000-000000000001';
const PROJECT_A = '68000000-0000-4000-8000-000000000002';
const PROJECT_B = '68000000-0000-4000-8000-000000000003';
const BROKER_ID = '68000000-0000-4000-8000-000000000004';

const ids = {
  superAdmin: '68000000-0000-4000-8000-000000000010',
  director: '68000000-0000-4000-8000-000000000011',
  manager: '68000000-0000-4000-8000-000000000012',
  sales: '68000000-0000-4000-8000-000000000013',
  receptionist: '68000000-0000-4000-8000-000000000014',
  allocator: '68000000-0000-4000-8000-000000000015',
  transactionOperator: '68000000-0000-4000-8000-000000000016',
  brokerManager: '68000000-0000-4000-8000-000000000017',
  brokerFinance: '68000000-0000-4000-8000-000000000018',
  brokerAgent: '68000000-0000-4000-8000-000000000019',
  buyer: '68000000-0000-4000-8000-000000000020',
};

const db = createDatabase(connectionString);

try {
  await seed();
  const repository = new PostgresAccessRepository(db);
  const access = new AccessService(repository);
  const platformAdmin = new PlatformAdminService(access, new PlatformAdminRepository(db));

  assertCanonicalCapabilityMatrix();
  await assertScopedAuthority(access);
  await assertPlatformAdminBreakGlass(access, platformAdmin);
  assertOptionalAiSemantics();

  console.log('Gate 5 full role/product parity certification passed.');
} finally {
  await db.destroy();
}

async function seed() {
  const users = [
    ['superAdmin', 'PRENEURA Super Admin'],
    ['director', 'Operations Director'],
    ['manager', 'Manager'],
    ['sales', 'Sales'],
    ['receptionist', 'Receptionist'],
    ['allocator', 'Allocator'],
    ['transactionOperator', 'Transaction Operator'],
    ['brokerManager', 'Broker Manager'],
    ['brokerFinance', 'Broker Finance'],
    ['brokerAgent', 'Broker Agent'],
    ['buyer', 'Buyer'],
  ];

  await db.insertInto('users').values(users.map(([key, name]) => ({
    id: ids[key],
    display_name: name,
    status: 'ACTIVE',
  }))).execute();

  await db.insertInto('tenants').values({
    id: TENANT_ID,
    code: 'G5-FULL',
    name: 'Gate 5 Full Role Tenant',
    status: 'ACTIVE',
    default_currency: 'EGP',
    default_timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('projects').values([
    { id: PROJECT_A, tenant_id: TENANT_ID, code: 'A', name: 'Project A', status: 'ACTIVE', currency: 'EGP', timezone: 'Africa/Cairo' },
    { id: PROJECT_B, tenant_id: TENANT_ID, code: 'B', name: 'Project B', status: 'ACTIVE', currency: 'EGP', timezone: 'Africa/Cairo' },
  ]).execute();

  await db.insertInto('broker_companies').values({
    id: BROKER_ID,
    tenant_id: TENANT_ID,
    code: 'BROKER',
    name: 'Certified Broker',
    status: 'ACTIVE',
  }).execute();

  await db.insertInto('broker_project_access').values({
    broker_company_id: BROKER_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_A,
    status: 'ACTIVE',
    effective_to: null,
  }).execute();

  await db.insertInto('tenant_memberships').values(Object.values(ids)
    .filter((userId) => userId !== ids.superAdmin)
    .map((userId) => ({ tenant_id: TENANT_ID, user_id: userId, status: 'ACTIVE' }))).execute();

  await db.insertInto('access_role_assignments').values([
    platformAssignment(ids.superAdmin, 'PRENEURA_SUPER_ADMIN'),
    tenantAssignment(ids.director, 'OPERATIONS_DIRECTOR'),
    projectAssignment(ids.manager, 'MANAGER'),
    projectAssignment(ids.sales, 'SALES'),
    projectAssignment(ids.receptionist, 'QUEUE_RECEPTIONIST'),
    projectAssignment(ids.allocator, 'ALLOCATOR'),
    projectAssignment(ids.transactionOperator, 'TRANSACTION_OPERATOR'),
    brokerAssignment(ids.brokerManager, 'BROKER_MANAGER'),
    brokerAssignment(ids.brokerFinance, 'BROKER_FINANCE'),
    brokerAssignment(ids.brokerAgent, 'BROKER_AGENT'),
    projectAssignment(ids.buyer, 'BUYER'),
  ]).execute();
}

function assertCanonicalCapabilityMatrix() {
  const allow = (role, permissions) => permissions.forEach((permission) =>
    assert.equal(roleHasPermission(role, permission), true, `${role} must allow ${permission}.`));
  const deny = (role, permissions) => permissions.forEach((permission) =>
    assert.equal(roleHasPermission(role, permission), false, `${role} must deny ${permission}.`));

  allow('BUYER', ['buyers.read.self','transaction.read.self','documents.read.self','contract.sign.self','property.read.self','installment.read.self','ai.buyer.use']);
  deny('BUYER', ['buyers.read','transaction.manage','payment.verify','commission.amount.read','ai.manager.use']);

  allow('SALES', ['buyers.read','buyers.manage','eoi.read','eoi.manage','transaction.read']);
  deny('SALES', ['eoi.verify','payment.verify','transaction.manage','commission.rate.read']);

  allow('QUEUE_RECEPTIONIST', ['queue.read','queue.checkin','queue.manage']);
  deny('QUEUE_RECEPTIONIST', ['unit.lock','payment.verify','transaction.manage']);

  allow('ALLOCATOR', ['allocation.assist','unit.lock','inventory.read','transaction.read']);
  deny('ALLOCATOR', ['queue.checkin','payment.verify','pricing.publish']);

  allow('TRANSACTION_OPERATOR', ['transaction.manage','payment.verify','payment.schedule.manage','documents.verify','contract.execute','refund.payout.manage']);
  deny('TRANSACTION_OPERATOR', ['pricing.publish','commission.rate.read','commission.payout.manage']);

  allow('MANAGER', ['project.manage','pricing.publish','transaction.manage','commission.amount.read','commission.rate.read','refund.approve','audit.read','ai.manager.use']);
  deny('MANAGER', ['tenant.projects.manage','commission.payout.manage','refund.payout.manage','ai.buyer.use']);

  allow('OPERATIONS_DIRECTOR', ['tenant.projects.manage','project.manage','pricing.publish','commission.payout.manage','refund.payout.manage','audit.read','ai.manager.use']);

  allow('BROKER_MANAGER', ['broker.users.manage','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read','commission.invoice.manage']);
  deny('BROKER_MANAGER', ['commission.payout.manage','payment.verify','tenant.users.manage']);

  allow('BROKER_FINANCE', ['broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read','commission.invoice.manage']);
  deny('BROKER_FINANCE', ['broker.users.manage','commission.payout.manage','payment.verify']);

  allow('BROKER_AGENT', ['broker.buyers.read','broker.buyers.manage','commission.status.read','transaction.read']);
  deny('BROKER_AGENT', ['commission.amount.read','commission.rate.read','commission.invoice.manage','broker.users.manage']);

  allow('PRENEURA_SUPER_ADMIN', ['platform.tenants.read','platform.tenants.manage','platform.support.access']);
  deny('PRENEURA_SUPER_ADMIN', ['project.manage','payment.verify','transaction.manage','commission.payout.manage']);
}

async function assertScopedAuthority(access) {
  const projectA = { tenantId: TENANT_ID, projectId: PROJECT_A };
  const projectB = { tenantId: TENANT_ID, projectId: PROJECT_B };

  assert.equal((await access.can({ userId: ids.director, permission: 'project.manage', context: projectA })).allowed, true);
  assert.equal((await access.can({ userId: ids.director, permission: 'project.manage', context: projectB })).allowed, true);
  assert.equal((await access.can({ userId: ids.manager, permission: 'project.manage', context: projectA })).allowed, true);
  assert.equal((await access.can({ userId: ids.manager, permission: 'project.manage', context: projectB })).allowed, false);

  assert.equal((await access.can({ userId: ids.brokerAgent, permission: 'transaction.read', context: projectA })).allowed, true);
  assert.equal((await access.can({ userId: ids.brokerAgent, permission: 'transaction.read', context: projectB })).allowed, false, 'Broker access must remain project-bound.');
  assert.equal((await access.can({ userId: ids.brokerAgent, permission: 'commission.amount.read', context: projectA })).allowed, false, 'Agent financial redaction must be server-authoritative.');

  assert.equal((await access.can({
    userId: ids.buyer,
    permission: 'transaction.read.self',
    context: { ...projectA, resourceOwnerUserId: ids.buyer },
  })).allowed, true);
  assert.equal((await access.can({
    userId: ids.buyer,
    permission: 'transaction.read.self',
    context: { ...projectA, resourceOwnerUserId: ids.sales },
  })).allowed, false, 'Buyer self permission must not cross resource ownership.');

  const workspace = await access.workspaceContext(ids.director);
  assert.equal(workspace.projects.length, 2, 'Tenant-scoped Operations Director must discover both projects.');
  const managerWorkspace = await access.workspaceContext(ids.manager);
  assert.deepEqual(managerWorkspace.projects.map((project) => project.projectId), [PROJECT_A]);
}

async function assertPlatformAdminBreakGlass(access, platformAdmin) {
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.read',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false, 'Platform admin must not silently read tenant operations.');
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false);

  const session = await platformAdmin.startSupportSession(ids.superAdmin, {
    tenantId: TENANT_ID,
    projectId: PROJECT_A,
    reason: 'Gate 5 read-only support certification',
    durationMinutes: 15,
  });
  assert.equal(session.status, 'ACTIVE');

  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.read',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, true, 'Active support access must unlock allowlisted read authority.');
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'payment.read',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, true);
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.read',
    context: { tenantId: TENANT_ID, projectId: PROJECT_B },
  })).allowed, false, 'Project-scoped support access must not leak into another project.');
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false, 'Support mode must remain read-only.');
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'payment.verify',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false);
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'commission.payout.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false);

  await platformAdmin.endSupportSession(ids.superAdmin, session.sessionId);
  assert.equal((await access.can({
    userId: ids.superAdmin,
    permission: 'transaction.read',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, false, 'Ended support access must revoke tenant reads immediately.');
}

function assertOptionalAiSemantics() {
  assert.equal(roleHasPermission('BUYER', 'ai.buyer.use'), true);
  assert.equal(roleHasPermission('BUYER', 'inventory.read'), true, 'Manual catalog must remain available independently of AI.');
  assert.equal(roleHasPermission('MANAGER', 'ai.manager.use'), true);
  assert.equal(roleHasPermission('MANAGER', 'project.read'), true, 'Manager workflow must not depend on AI.');
  assert.equal(roleHasPermission('OPERATIONS_DIRECTOR', 'ai.manager.use'), true);
  assert.equal(roleHasPermission('SALES', 'ai.manager.use'), false);
  assert.equal(roleHasPermission('TRANSACTION_OPERATOR', 'ai.manager.use'), false);
  assert.equal(roleHasPermission('PRENEURA_SUPER_ADMIN', 'ai.manager.use'), false, 'Platform administration must not imply tenant AI authority.');
}

function platformAssignment(userId, roleCode) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'PLATFORM',
    tenant_id: null,
    project_id: null,
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

function projectAssignment(userId, roleCode) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'PROJECT',
    tenant_id: TENANT_ID,
    project_id: PROJECT_A,
    broker_company_id: null,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}

function brokerAssignment(userId, roleCode) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'BROKER_COMPANY',
    tenant_id: TENANT_ID,
    project_id: null,
    broker_company_id: BROKER_ID,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}
