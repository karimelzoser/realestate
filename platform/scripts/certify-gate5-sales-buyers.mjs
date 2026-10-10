import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { AccountVerificationDelivery } from '../apps/api/dist/accounts/account-verification-delivery.js';
import { SalesBuyerOnboardingRepository } from '../apps/api/dist/sales/sales-buyer-onboarding.repository.js';
import { SalesBuyerOnboardingService } from '../apps/api/dist/sales/sales-buyer-onboarding.service.js';
import { SalesBuyerListRepository } from '../apps/api/dist/sales/sales-buyer-list.repository.js';
import { SalesBuyerListService } from '../apps/api/dist/sales/sales-buyer-list.service.js';
import { SalesRepository } from '../apps/api/dist/sales/sales.repository.js';
import { SalesService } from '../apps/api/dist/sales/sales.service.js';
import { MilestoneEvidenceService } from '../apps/api/dist/sales/milestone-evidence.service.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const SALES_USER_ID = '51515151-5151-4515-8515-515151515151';
const TENANT_ID = 'aaaaaaaa-5151-4515-8515-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-5151-4515-8515-bbbbbbbbbbbb';
const PLAINTEXT_PHONE = '+201000000123';

const db = createDatabase(connectionString);
try {
  const accessRepository = new PostgresAccessRepository(db);
  const access = new AccessService(accessRepository);
  const onboardingRepository = new SalesBuyerOnboardingRepository(db);
  const delivery = new AccountVerificationDelivery();
  const onboarding = new SalesBuyerOnboardingService(onboardingRepository, access, delivery);
  const buyerList = new SalesBuyerListService(new SalesBuyerListRepository(db), access);
  const sales = new SalesService(
    new SalesRepository(db),
    access,
    new MilestoneEvidenceService(db),
  );

  for (const permission of ['buyers.read', 'buyers.manage', 'eoi.manage']) {
    const decision = await access.can({
      userId: SALES_USER_ID,
      permission,
      context: { tenantId: TENANT_ID, projectId: PROJECT_ID },
    });
    assert.equal(decision.allowed, true, `SALES must have ${permission}.`);
  }

  for (const permission of ['eoi.verify', 'payment.verify']) {
    const decision = await access.can({
      userId: SALES_USER_ID,
      permission,
      context: { tenantId: TENANT_ID, projectId: PROJECT_ID },
    });
    assert.equal(decision.allowed, false, `SALES must not have ${permission}.`);
  }

  const invited = await onboarding.invite({
    actorUserId: SALES_USER_ID,
    data: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      displayName: 'Gate 5 Invited Buyer',
      phone: PLAINTEXT_PHONE,
      verificationChannel: 'WHATSAPP',
      source: 'INTERNAL',
    },
  });

  assert.equal(invited.accountStatus, 'PENDING');
  assert.equal(invited.verificationRequired, true);
  assert.equal(invited.verificationDispatched, true);
  assert.notEqual(invited.contactDisplayHint, PLAINTEXT_PHONE);
  assert.ok(invited.contactDisplayHint.endsWith('0123'));

  const user = await db
    .selectFrom('users')
    .select(['id', 'status'])
    .where('id', '=', invited.userId)
    .executeTakeFirstOrThrow();
  assert.equal(user.status, 'PENDING');

  const membership = await db
    .selectFrom('tenant_memberships')
    .select('status')
    .where('tenant_id', '=', TENANT_ID)
    .where('user_id', '=', invited.userId)
    .executeTakeFirstOrThrow();
  assert.equal(membership.status, 'INVITED');

  const buyerRole = await db
    .selectFrom('access_role_assignments')
    .select(['role_code', 'scope_type', 'project_id'])
    .where('user_id', '=', invited.userId)
    .where('role_code', '=', 'BUYER')
    .executeTakeFirstOrThrow();
  assert.equal(buyerRole.scope_type, 'PROJECT');
  assert.equal(buyerRole.project_id, PROJECT_ID);

  const contact = await db
    .selectFrom('auth_delivery_contacts')
    .select(['value_ciphertext', 'display_hint', 'verified_at'])
    .where('user_id', '=', invited.userId)
    .where('kind', '=', 'PHONE')
    .where('is_primary', '=', true)
    .executeTakeFirstOrThrow();
  assert.equal(contact.display_hint, invited.contactDisplayHint);
  assert.equal(contact.verified_at, null);
  assert.equal(Buffer.from(contact.value_ciphertext).toString('utf8').includes(PLAINTEXT_PHONE), false);

  const alias = await db
    .selectFrom('auth_login_aliases')
    .select(['kind', 'verified_at'])
    .where('user_id', '=', invited.userId)
    .where('kind', '=', 'PHONE')
    .executeTakeFirstOrThrow();
  assert.equal(alias.verified_at, null);

  const challenge = await db
    .selectFrom('auth_contact_verification_challenges')
    .select(['sent_at', 'consumed_at'])
    .where('user_id', '=', invited.userId)
    .executeTakeFirstOrThrow();
  assert.ok(challenge.sent_at instanceof Date);
  assert.equal(challenge.consumed_at, null);

  const beforeEoi = await buyerList.list({
    actorUserId: SALES_USER_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
  });
  assert.equal(beforeEoi.length, 1);
  assert.equal(beforeEoi[0]?.buyerProfileId, invited.buyerProfileId);
  assert.equal(beforeEoi[0]?.displayName, 'Gate 5 Invited Buyer');
  assert.equal(beforeEoi[0]?.contactDisplayHint, invited.contactDisplayHint);
  assert.equal(beforeEoi[0]?.contactVerified, false);
  assert.equal(beforeEoi[0]?.latestEoi, null);
  assert.equal(JSON.stringify(beforeEoi).includes(PLAINTEXT_PHONE), false, 'Buyer list leaked plaintext phone.');

  const eoi = await sales.createEoi({
    actorUserId: SALES_USER_ID,
    data: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      buyerProfileId: invited.buyerProfileId,
    },
  });
  assert.equal(eoi.amount, '25000.00');
  assert.equal(eoi.currency, 'EGP');

  const afterEoi = await buyerList.list({
    actorUserId: SALES_USER_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
  });
  assert.equal(afterEoi[0]?.latestEoi?.eoiId, eoi.eoiId);
  assert.equal(afterEoi[0]?.latestEoi?.status, 'PAYMENT_PENDING');
  assert.equal(afterEoi[0]?.latestEoi?.paidAt, null);

  const storedEoi = await db
    .selectFrom('buyer_eois')
    .select(['status', 'payment_reference', 'paid_at'])
    .where('id', '=', eoi.eoiId)
    .executeTakeFirstOrThrow();
  assert.equal(storedEoi.status, 'PAYMENT_PENDING');
  assert.equal(storedEoi.payment_reference, null);
  assert.equal(storedEoi.paid_at, null);

  console.log('Gate 5 Sales buyer certification passed.');
} finally {
  await db.destroy();
}
