import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { createBuyerEoiSchema } from '@preneura/contracts/sales';
import { SalesService } from '../src/sales/sales.service.js';

const scope = {
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  buyerProfileId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', unitTypeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  refundPolicyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', acceptedPolicy: true as const,
};

test('EOI contract requires apartment type and an explicitly accepted policy version', () => {
  assert.equal(createBuyerEoiSchema.safeParse(scope).success, true);
  assert.equal(createBuyerEoiSchema.safeParse({ ...scope, unitTypeId: undefined }).success, false);
  assert.equal(createBuyerEoiSchema.safeParse({ ...scope, refundPolicyId: undefined }).success, false);
  assert.equal(createBuyerEoiSchema.safeParse({ ...scope, acceptedPolicy: false }).success, false);
});

function harness(owner: string, denied = false) {
  const checks: unknown[] = [];
  const writes: unknown[] = [];
  const repository = {
    projectExists: async () => true,
    getBuyerProfile: async () => ({ id: scope.buyerProfileId, tenantId: scope.tenantId, userId: owner, source: 'DIRECT', brokerCompanyId: null, brokerAgentUserId: null }),
    createEoi: async (value: unknown) => { writes.push(value); return { eoiId: scope.buyerProfileId, amount: '25000.00', currency: 'EGP' }; },
    activeEoiPolicy: async () => null,
  };
  const access = { assert: async (value: unknown) => { checks.push(value); if (denied) throw new ForbiddenException('Denied'); return {}; } };
  const service = new SalesService(repository as never, access as never, {} as never);
  return { service, checks, writes };
}

test('buyer EOI creation checks ownership permission and forwards the chosen type/policy', async () => {
  const { service, checks, writes } = harness('buyer');
  await service.createEoi({ actorUserId: 'buyer', data: scope });
  assert.deepEqual(checks, [{ userId: 'buyer', permission: 'eoi.manage.self',
    context: { tenantId: scope.tenantId, projectId: scope.projectId, resourceOwnerUserId: 'buyer' } }]);
  assert.equal((writes[0] as { unitTypeId: string }).unitTypeId, scope.unitTypeId);
  assert.equal((writes[0] as { refundPolicyId: string }).refundPolicyId, scope.refundPolicyId);
});

test('a different buyer cannot create another owner EOI when staff permission is denied', async () => {
  const { service, checks, writes } = harness('owner', true);
  await assert.rejects(service.createEoi({ actorUserId: 'other-buyer', data: scope }), ForbiddenException);
  assert.equal((checks[0] as { permission: string }).permission, 'eoi.manage');
  assert.equal(writes.length, 0);
});

test('EOI policy reads cannot bypass project inventory permission', async () => {
  const { service, checks } = harness('buyer', true);
  await assert.rejects(service.eoiPolicy({ actorUserId: 'buyer', tenantId: scope.tenantId, projectId: scope.projectId }), ForbiddenException);
  assert.equal((checks[0] as { permission: string }).permission, 'inventory.read');
});
