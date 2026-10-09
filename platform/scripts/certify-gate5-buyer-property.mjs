import assert from 'node:assert/strict';
import { createDatabase } from '../packages/database/dist/index.js';
import { PostgresAccessRepository } from '../apps/api/dist/access/access.repository.js';
import { AccessService } from '../apps/api/dist/access/access.service.js';
import { PropertyRepository } from '../apps/api/dist/property/property.repository.js';
import { PropertyService } from '../apps/api/dist/property/property.service.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUYER_A = '11111111-1111-4111-8111-111111111111';
const BUYER_B = '22222222-2222-4222-8222-222222222222';
const TRANSACTION_A = '10000000-0000-4000-8000-000000000061';
const TRANSACTION_B = '20000000-0000-4000-8000-000000000062';

const db = createDatabase(connectionString);
try {
  const accessRepository = new PostgresAccessRepository(db);
  const accessService = new AccessService(accessRepository);
  const propertyRepository = new PropertyRepository(db);
  const propertyService = new PropertyService(propertyRepository, accessService);

  const buyerA = await propertyService.getBuyerPortfolio({
    actorUserId: BUYER_A,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
  });
  assert.equal(buyerA.buyerUserId, BUYER_A);
  assert.equal(buyerA.properties.length, 1);
  assert.equal(buyerA.properties[0]?.transactionId, TRANSACTION_A);
  assert.equal(buyerA.properties[0]?.unitTypeCode, 'TYPE-A');
  assert.equal(buyerA.properties[0]?.quotedTotal, '300.00');
  assert.equal(buyerA.properties[0]?.finance?.paidTowardContract, '100.00');
  assert.equal(buyerA.properties[0]?.finance?.remainingContractAmount, '200.00');
  assert.equal(buyerA.properties[0]?.finance?.installments[0]?.status, 'PAID');
  assert.equal(buyerA.properties[0]?.finance?.installments[1]?.remainingAmount, '200.00');

  const serializedA = JSON.stringify(buyerA);
  assert.equal(serializedA.includes(BUYER_B), false, 'Buyer A response leaked Buyer B identity.');
  assert.equal(serializedA.includes(TRANSACTION_B), false, 'Buyer A response leaked Buyer B transaction.');
  assert.equal(serializedA.includes('PRIVATE-SLOT'), false, 'Buyer response leaked internal inventory reference.');
  assert.equal(serializedA.toLowerCase().includes('commission'), false, 'Buyer response leaked commission data.');

  const buyerB = await propertyService.getBuyerPortfolio({
    actorUserId: BUYER_B,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
  });
  assert.equal(buyerB.properties.length, 1);
  assert.equal(buyerB.properties[0]?.transactionId, TRANSACTION_B);
  assert.equal(buyerB.properties[0]?.finance?.paidTowardContract, '0.00');
  assert.equal(buyerB.properties[0]?.finance?.remainingContractAmount, '300.00');

  const crossOwnerAssignments = await accessService.matchingAssignments({
    userId: BUYER_A,
    permission: 'property.read.self',
    context: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      resourceOwnerUserId: BUYER_B,
    },
  });
  assert.equal(crossOwnerAssignments.length, 0, 'Buyer .self permission matched another buyer.');

  const crossInstallmentAssignments = await accessService.matchingAssignments({
    userId: BUYER_A,
    permission: 'installment.read.self',
    context: {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      resourceOwnerUserId: BUYER_B,
    },
  });
  assert.equal(crossInstallmentAssignments.length, 0, 'Buyer installment .self permission matched another buyer.');

  console.log('Gate 5 buyer property certification passed.');
} finally {
  await db.destroy();
}
