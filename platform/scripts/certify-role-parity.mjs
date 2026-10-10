import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const accessModule = await import(pathToFileURL(path.join(root, 'packages/contracts/dist/access.js')).href);
const { roleCapabilityMap, roleHasPermission } = accessModule;

const expectedRoles = [
  'PRENEURA_SUPER_ADMIN','OPERATIONS_DIRECTOR','MANAGER','SALES','QUEUE_RECEPTIONIST','ALLOCATOR','TRANSACTION_OPERATOR','BROKER_MANAGER','BROKER_FINANCE','BROKER_AGENT','BUYER',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(JSON.stringify(Object.keys(roleCapabilityMap).sort()) === JSON.stringify([...expectedRoles].sort()), 'Production role set does not match the approved 11-role model.');

function has(role, permission) { return roleHasPermission(role, permission); }
function requireHas(role, permissions) {
  for (const permission of permissions) assert(has(role, permission), `${role} must have ${permission}`);
}
function requireLacks(role, permissions) {
  for (const permission of permissions) assert(!has(role, permission), `${role} must not have ${permission}`);
}

requireHas('BROKER_AGENT', ['commission.status.read','broker.buyers.read','inventory.read','transaction.read']);
requireLacks('BROKER_AGENT', ['commission.amount.read','commission.rate.read','commission.payment.manage','commission.plan.manage','payment.verify','pricing.publish']);

// Broker Finance can reconcile economics and manage invoices, but cannot manufacture
// a paid commission projection. Payment is settlement-derived through the internal
// payout authority introduced by Gate 4.
requireHas('BROKER_FINANCE', ['commission.status.read','commission.amount.read','commission.rate.read','commission.invoice.manage','payment.read']);
requireLacks('BROKER_FINANCE', ['commission.payment.manage','commission.payout.manage','unit.lock','pricing.publish','contract.execute']);

requireHas('BROKER_MANAGER', ['broker.users.manage','broker.performance.read','commission.status.read','commission.amount.read','commission.rate.read']);
requireLacks('BROKER_MANAGER', ['payment.verify','contract.execute','pricing.publish']);

requireHas('TRANSACTION_OPERATOR', ['transaction.manage','payment.read','payment.verify','payment.schedule.manage','documents.upload','documents.verify','contract.generate','contract.execute','commission.status.read']);
requireLacks('TRANSACTION_OPERATOR', ['commission.amount.read','commission.rate.read','commission.payment.manage','commission.plan.manage','pricing.publish']);

requireHas('ALLOCATOR', ['allocation.assist','unit.lock','inventory.read','transaction.read']);
requireLacks('ALLOCATOR', ['payment.verify','documents.verify','commission.amount.read']);

requireHas('QUEUE_RECEPTIONIST', ['queue.read','queue.checkin','queue.manage']);
requireLacks('QUEUE_RECEPTIONIST', ['unit.lock','payment.verify','contract.execute']);

requireHas('SALES', ['buyers.manage','eoi.manage','queue.read','inventory.read','transaction.read']);
requireLacks('SALES', ['payment.verify','unit.lock','commission.amount.read']);

requireHas('BUYER', ['buyers.read.self','eoi.read.self','transaction.read.self','documents.read.self','documents.upload.self','contract.read.self','contract.sign.self','installment.read.self','refund.request','ai.buyer.use']);
requireLacks('BUYER', ['buyers.read','transaction.read','payment.verify','unit.lock','pricing.publish','ai.manager.use','ai.settings.manage']);

requireHas('MANAGER', ['ai.manager.use','ai.settings.manage','notifications.manage','refund.approve','commission.status.read','commission.amount.read','commission.rate.read']);
requireHas('OPERATIONS_DIRECTOR', ['tenant.users.manage','project.import.manage','pricing.publish','commission.payment.manage','refund.approve','notifications.manage','ai.manager.use','ai.settings.manage']);

requireHas('PRENEURA_SUPER_ADMIN', ['platform.tenants.read','platform.tenants.manage','platform.support.access']);
requireLacks('PRENEURA_SUPER_ADMIN', ['transaction.manage','payment.verify','unit.lock','pricing.publish','commission.payment.manage']);

const requiredFiles = [
  'apps/api/src/exports/export.controller.ts',
  'apps/web/app/workspace/exports/page.tsx',
  'apps/web/app/workspace/reminders/page.tsx',
  'apps/web/app/workspace/refunds/page.tsx',
  'apps/web/app/workspace/commissions/page.tsx',
  'apps/web/app/workspace/accounts/page.tsx',
  'apps/web/app/workspace/ai/page.tsx',
  'apps/web/app/workspace/project-setup/page.tsx',
  'apps/web/app/workspace/document-templates/page.tsx',
  'apps/web/app/admin/page.tsx',
  'apps/web/app/admin/support/page.tsx',
  'apps/notification-gateway/src/main.ts',
];
for (const file of requiredFiles) assert(fs.existsSync(path.join(root, file)), `Required production surface is missing: ${file}`);

const exportService = fs.readFileSync(path.join(root, 'apps/api/src/exports/export.service.ts'), 'utf8');
for (const dataset of ['buyers','eois','queue','inventory','pricing','transactions','payments','cheques','documents','refunds','commissions','notifications','audit','accounts','templates']) {
  assert(exportService.includes(`'${dataset}'`), `Export dataset missing: ${dataset}`);
}
assert(exportService.includes("commission.amount.read"), 'Commission export must independently gate amount visibility.');
assert(exportService.includes("commission.rate.read"), 'Commission export must independently gate rate visibility.');
assert(exportService.includes("/^[=+\\-@]/"), 'CSV formula-injection defense is missing.');

const aiServicePath = path.join(root, 'apps/api/src/ai/ai.service.ts');
assert(fs.existsSync(aiServicePath), 'AI service is missing.');
const aiService = fs.readFileSync(aiServicePath, 'utf8');
assert(aiService.includes('deterministic') || aiService.includes('fallback'), 'AI implementation must preserve a deterministic/fallback path.');

const reminderWorker = fs.readFileSync(path.join(root, 'apps/worker/src/installment-reminders.ts'), 'utf8');
assert(reminderWorker.includes('installment'), 'Installment reminder scheduler is missing.');
const milestoneWorker = fs.readFileSync(path.join(root, 'apps/worker/src/milestone-reminders.ts'), 'utf8');
assert(milestoneWorker.includes('milestone'), 'Missing-step reminder scheduler is missing.');

console.log('Gate 4/5 role and product parity certification passed.');
