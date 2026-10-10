import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { ManagementRepository } from '../apps/api/dist/management/management.repository.js';
import { ManagementTenantRepository } from '../apps/api/dist/management/management-tenant.repository.js';
import { ManagementService } from '../apps/api/dist/management/management.service.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const TENANT_ID = '67000000-0000-4000-8000-000000000001';
const PROJECT_A = '67000000-0000-4000-8000-000000000002';
const PROJECT_B = '67000000-0000-4000-8000-000000000003';
const DIRECTOR_ID = '67000000-0000-4000-8000-000000000011';
const MANAGER_ID = '67000000-0000-4000-8000-000000000012';
const SALES_ID = '67000000-0000-4000-8000-000000000013';
const UNIT_TYPE_A = '67000000-0000-4000-8000-000000000021';
const UNIT_TYPE_B = '67000000-0000-4000-8000-000000000022';

const db = createDatabase(connectionString);

const queueCounts = {
  [PROJECT_A]: counts({ NEEDS_DOCUMENTS: 1, READY_TO_COMPLETE: 2 }),
  [PROJECT_B]: counts({ NEEDS_PAYMENT: 3, NEEDS_COMPANY_EXECUTION: 1 }),
};

const fakeTransactionOperations = {
  calls: [],
  async queue(input) {
    this.calls.push(input);
    return {
      generatedAt: '2026-10-10T10:00:00.000Z',
      counts: queueCounts[input.projectId] ?? counts({}),
      items: [],
    };
  },
};

try {
  await seed();

  const access = new AccessService(new PostgresAccessRepository(db));
  const service = new ManagementService(
    new ManagementRepository(db),
    new ManagementTenantRepository(db),
    access,
    fakeTransactionOperations,
  );

  await assertRoleBoundary(access, service);
  await assertDirectorPortfolio(service);

  console.log('Gate 5 Manager / Operations Director certification passed.');
} finally {
  await db.destroy();
}

async function seed() {
  await db.insertInto('users').values([
    { id: DIRECTOR_ID, display_name: 'Operations Director', status: 'ACTIVE' },
    { id: MANAGER_ID, display_name: 'Project Manager', status: 'ACTIVE' },
    { id: SALES_ID, display_name: 'Sales User', status: 'ACTIVE' },
  ]).execute();

  await db.insertInto('tenants').values({
    id: TENANT_ID,
    code: 'G5-MGMT',
    name: 'Gate 5 Management Tenant',
    status: 'ACTIVE',
    default_currency: 'EGP',
    default_timezone: 'Africa/Cairo',
  }).execute();

  await db.insertInto('projects').values([
    {
      id: PROJECT_A,
      tenant_id: TENANT_ID,
      code: 'CAIRO',
      name: 'Cairo Project',
      status: 'ACTIVE',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
    },
    {
      id: PROJECT_B,
      tenant_id: TENANT_ID,
      code: 'GULF',
      name: 'Gulf Project',
      status: 'ACTIVE',
      currency: 'USD',
      timezone: 'Asia/Dubai',
    },
  ]).execute();

  await db.insertInto('tenant_memberships').values([
    DIRECTOR_ID,
    MANAGER_ID,
    SALES_ID,
  ].map((userId) => ({ tenant_id: TENANT_ID, user_id: userId, status: 'ACTIVE' }))).execute();

  await db.insertInto('access_role_assignments').values([
    tenantAssignment(DIRECTOR_ID, 'OPERATIONS_DIRECTOR'),
    projectAssignment(MANAGER_ID, 'MANAGER', PROJECT_A),
    projectAssignment(SALES_ID, 'SALES', PROJECT_A),
  ]).execute();

  await db.insertInto('catalog_unit_types').values([
    {
      id: UNIT_TYPE_A,
      tenant_id: TENANT_ID,
      project_id: PROJECT_A,
      code: 'TYPE-A',
      name: 'Type A',
      description: null,
      bedroom_count: 2,
      indoor_area_sqm: '120',
      roof_area_sqm: '0',
      garden_area_sqm: '20',
      status: 'ACTIVE',
      sort_order: 1,
    },
    {
      id: UNIT_TYPE_B,
      tenant_id: TENANT_ID,
      project_id: PROJECT_B,
      code: 'TYPE-B',
      name: 'Type B',
      description: null,
      bedroom_count: 3,
      indoor_area_sqm: '160',
      roof_area_sqm: '30',
      garden_area_sqm: '0',
      status: 'ACTIVE',
      sort_order: 1,
    },
  ]).execute();

  await db.insertInto('inventory_slots').values([
    slot(PROJECT_A, UNIT_TYPE_A, 'A-1'),
    slot(PROJECT_A, UNIT_TYPE_A, 'A-2'),
    slot(PROJECT_B, UNIT_TYPE_B, 'B-1'),
    slot(PROJECT_B, UNIT_TYPE_B, 'B-2'),
    slot(PROJECT_B, UNIT_TYPE_B, 'B-3'),
  ]).execute();
}

async function assertRoleBoundary(access, service) {
  assert.equal((await access.can({
    userId: DIRECTOR_ID,
    permission: 'tenant.projects.manage',
    context: { tenantId: TENANT_ID },
  })).allowed, true, 'Operations Director must have tenant project governance.');

  assert.equal((await access.can({
    userId: MANAGER_ID,
    permission: 'tenant.projects.manage',
    context: { tenantId: TENANT_ID },
  })).allowed, false, 'Manager must not receive tenant-wide project governance.');

  assert.equal((await access.can({
    userId: DIRECTOR_ID,
    permission: 'project.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_B },
  })).allowed, true, 'Operations Director tenant scope must cover project B.');

  assert.equal((await access.can({
    userId: MANAGER_ID,
    permission: 'project.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_A },
  })).allowed, true, 'Manager must manage assigned project A.');

  assert.equal((await access.can({
    userId: MANAGER_ID,
    permission: 'project.manage',
    context: { tenantId: TENANT_ID, projectId: PROJECT_B },
  })).allowed, false, 'Manager must not cross into project B.');

  await service.overview({ actorUserId: MANAGER_ID, tenantId: TENANT_ID, projectId: PROJECT_A });
  await assert.rejects(
    () => service.overview({ actorUserId: MANAGER_ID, tenantId: TENANT_ID, projectId: PROJECT_B }),
    /permission/i,
  );
  await assert.rejects(
    () => service.tenantOverview({ actorUserId: MANAGER_ID, tenantId: TENANT_ID }),
    /permission/i,
  );
  await assert.rejects(
    () => service.tenantOverview({ actorUserId: SALES_ID, tenantId: TENANT_ID }),
    /permission/i,
  );
}

async function assertDirectorPortfolio(service) {
  const portfolio = await service.tenantOverview({
    actorUserId: DIRECTOR_ID,
    tenantId: TENANT_ID,
  });

  assert.equal(portfolio.tenantId, TENANT_ID);
  assert.equal(portfolio.projects.length, 2, 'Director must see both tenant projects.');
  assert.equal(portfolio.totals.projectCount, 2);
  assert.equal(portfolio.totals.activeProjects, 2);
  assert.equal(portfolio.totals.availableCapacity, 5, 'Available capacity must sum safely across projects.');
  assert.equal(portfolio.totals.openTransactions, 0);
  assert.equal(portfolio.totals.overdueItems, 0);
  assert.equal(portfolio.totals.commissionOverdueCases, 0);
  assert.equal(portfolio.totals.failedNotifications, 0);
  assert.equal('overdueOutstandingAmount' in portfolio.totals, false, 'Cross-currency money must not be summed into tenant totals.');
  assert.equal('outstandingAmount' in portfolio.totals, false, 'Commission money must stay project/currency scoped.');

  const cairo = portfolio.projects.find((project) => project.projectId === PROJECT_A);
  const gulf = portfolio.projects.find((project) => project.projectId === PROJECT_B);
  assert.ok(cairo && gulf);
  assert.equal(cairo.overview.currency, 'EGP');
  assert.equal(gulf.overview.currency, 'USD');
  assert.equal(cairo.overview.inventory.available, 2);
  assert.equal(gulf.overview.inventory.available, 3);
  assert.equal(cairo.overview.completionBacklog.NEEDS_DOCUMENTS, 1);
  assert.equal(gulf.overview.completionBacklog.NEEDS_PAYMENT, 3);

  const directorCalls = fakeTransactionOperations.calls.filter((call) => call.actorUserId === DIRECTOR_ID);
  assert.equal(directorCalls.length, 2, 'Director portfolio must derive each project backlog from authoritative transaction operations.');
}

function counts(overrides) {
  return {
    NEEDS_DOCUMENTS: 0,
    NEEDS_PAYMENT: 0,
    NEEDS_CHEQUES: 0,
    NEEDS_CONTRACT: 0,
    NEEDS_BUYER_SIGNATURE: 0,
    NEEDS_COMPANY_EXECUTION: 0,
    READY_TO_COMPLETE: 0,
    ...overrides,
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

function projectAssignment(userId, roleCode, projectId) {
  return {
    user_id: userId,
    role_code: roleCode,
    scope_type: 'PROJECT',
    tenant_id: TENANT_ID,
    project_id: projectId,
    broker_company_id: null,
    status: 'ACTIVE',
    granted_by: null,
    revoked_at: null,
  };
}

function slot(projectId, unitTypeId, internalReference) {
  return {
    tenant_id: TENANT_ID,
    project_id: projectId,
    unit_type_id: unitTypeId,
    state: 'AVAILABLE',
    internal_reference: internalReference,
  };
}
