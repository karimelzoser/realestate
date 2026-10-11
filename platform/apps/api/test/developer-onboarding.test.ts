import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountBootstrapService } from '../src/accounts/account-bootstrap.service.js';
import { OnboardingService } from '../src/onboarding/onboarding.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';

function configureSecrets(): void {
  process.env.AUTH_IDENTIFIER_HMAC_KEY = 'a'.repeat(32);
  process.env.CONTACT_HMAC_KEY = 'b'.repeat(32);
  process.env.CONTACT_VERIFICATION_PEPPER = 'c'.repeat(32);
  process.env.CONTACT_ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  process.env.CONTACT_VERIFICATION_TTL_SECONDS = '600';
}

test('platform bootstrap provisions only a tenant-scoped Operations Director through the secure account path', async () => {
  configureSecrets();
  let permission = '';
  let provisionInput: Record<string, unknown> | null = null;
  let delivered = false;
  let markedSent = false;

  const access = {
    assert: async (input: { permission: string }) => { permission = input.permission; return { allowed: true }; },
  };
  const repository = {
    provision: async (input: Record<string, unknown>) => {
      provisionInput = input;
      return { userId: '33333333-3333-4333-8333-333333333333', contactId: '44444444-4444-4444-8444-444444444444' };
    },
    markChallengeSent: async () => { markedSent = true; },
  };
  const delivery = {
    send: async () => { delivered = true; },
  };

  const service = new AccountBootstrapService(repository as never, access as never, delivery as never);
  const result = await service.provisionOperationsDirector({
    actorUserId,
    tenantId,
    data: { displayName: 'Initial Director', phone: '+201001234567', verificationChannel: 'SMS' },
  });

  assert.equal(permission, 'platform.tenants.manage');
  assert.equal(provisionInput?.role, 'OPERATIONS_DIRECTOR');
  assert.equal(provisionInput?.scopeType, 'TENANT');
  assert.equal(provisionInput?.tenantId, tenantId);
  assert.equal(provisionInput?.projectId, null);
  assert.equal(provisionInput?.brokerCompanyId, null);
  assert.equal(delivered, true);
  assert.equal(markedSent, true);
  assert.equal(result.status, 'PENDING');
  assert.equal(result.verificationRequired, true);
});

test('platform bootstrap fails before account creation when platform tenant authority is absent', async () => {
  configureSecrets();
  let provisionCalled = false;
  const access = { assert: async () => { throw new Error('DENIED'); } };
  const repository = {
    provision: async () => { provisionCalled = true; throw new Error('SHOULD_NOT_RUN'); },
  };
  const delivery = { send: async () => undefined };
  const service = new AccountBootstrapService(repository as never, access as never, delivery as never);

  await assert.rejects(
    service.provisionOperationsDirector({
      actorUserId,
      tenantId,
      data: { displayName: 'Director', phone: '+201001234567', verificationChannel: 'WHATSAPP' },
    }),
    /DENIED/,
  );
  assert.equal(provisionCalled, false);
});

function onboardingSnapshot(overrides: Partial<Record<'operationsDirectors' | 'ready', number | boolean>> = {}) {
  const operationsDirectors = typeof overrides.operationsDirectors === 'number' ? overrides.operationsDirectors : 0;
  const ready = typeof overrides.ready === 'boolean' ? overrides.ready : false;
  return {
    tenantId,
    tenantCode: 'DEV1',
    tenantName: 'Developer One',
    tenantStatus: 'ACTIVE' as const,
    status: 'SETUP' as const,
    completedAt: null,
    completedBy: null,
    branding: null,
    projects: [],
    staff: { operationsDirectors, pendingOperationsDirectors: 0, activeStaff: 0, invitedStaff: 0 },
    readiness: {
      brandingConfigured: ready,
      operationsDirectorAssigned: ready,
      projectCreated: ready,
      projectBrandingConfigured: ready,
      ready,
    },
  };
}

test('first-director bootstrap closes after any Operations Director assignment exists', async () => {
  let bootstrapCalled = false;
  const repository = {
    snapshot: async () => onboardingSnapshot({ operationsDirectors: 1 }),
  };
  const projects = {};
  const access = { assert: async () => ({ allowed: true }), can: async () => ({ allowed: true }) };
  const bootstrap = {
    provisionOperationsDirector: async () => { bootstrapCalled = true; throw new Error('SHOULD_NOT_RUN'); },
  };
  const service = new OnboardingService(
    repository as never,
    projects as never,
    access as never,
    bootstrap as never,
  );

  await assert.rejects(
    service.bootstrapOperationsDirector(actorUserId, tenantId, {
      displayName: 'Second Director', phone: '+201001234567', verificationChannel: 'SMS',
    }),
    /already has an Operations Director/,
  );
  assert.equal(bootstrapCalled, false);
});

test('onboarding completion is rejected until derived prerequisites are ready', async () => {
  let completeCalled = false;
  const repository = {
    snapshot: async () => onboardingSnapshot(),
    complete: async () => { completeCalled = true; return true; },
  };
  const projects = {};
  const access = { can: async () => ({ allowed: true }), assert: async () => ({ allowed: true }) };
  const service = new OnboardingService(
    repository as never,
    projects as never,
    access as never,
    {} as never,
  );

  await assert.rejects(service.complete(actorUserId, tenantId), /prerequisites are incomplete/);
  assert.equal(completeCalled, false);
});
