import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const platform = resolve(process.cwd());
const failures = [];

function requireFile(relative) {
  const full = resolve(root, relative);
  if (!existsSync(full)) failures.push(`Missing required release artifact: ${relative}`);
}

const requiredWorkflows = [
  '.github/workflows/platform-foundation.yml',
  '.github/workflows/runtime-readiness-certification.yml',
  '.github/workflows/production-config-certification.yml',
  '.github/workflows/inventory-lock-durability-certification.yml',
  '.github/workflows/gate45-product-parity-certification.yml',
  '.github/workflows/gate6-nonfunctional-certification.yml',
  '.github/workflows/gate6-security-scan.yml',
  '.github/workflows/backup-restore-certification.yml',
];
for (const workflow of requiredWorkflows) requireFile(workflow);

for (const artifact of [
  'platform/docs/PRODUCTION_CANDIDATE.md',
  'platform/docs/backup-restore.md',
  'platform/docs/gate6-nonfunctional-certification.md',
  'platform/docs/gate6-security-scan.md',
  'platform/ops/railway-gate7-staging.json',
  'docs/PRODUCTION_DELIVERY_GATES.md',
  'platform/.env.example',
]) requireFile(artifact);

const migrationsDir = resolve(platform, 'packages/database/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const latestMigration = migrations.at(-1);
if (latestMigration !== '0041_inventory_lock_expiry_durability.sql') {
  failures.push(`Expected canonical latest migration 0041_inventory_lock_expiry_durability.sql, found ${latestMigration ?? 'none'}.`);
}

const runtimeReadiness = readFileSync(resolve(platform, 'packages/database/src/runtime-readiness.ts'), 'utf8');
if (!runtimeReadiness.includes('RUNTIME_SCHEMA_VERSION = 41')) {
  failures.push('Runtime readiness is not pinned to canonical schema version 41.');
}
if (!runtimeReadiness.includes("RUNTIME_MIGRATION_MARKER = '0041_inventory_lock_expiry_durability'")) {
  failures.push('Runtime readiness does not require migration 0041_inventory_lock_expiry_durability.');
}

const envExample = readFileSync(resolve(platform, '.env.example'), 'utf8');
const requiredEnv = [
  'DATABASE_URL', 'WEB_ORIGIN', 'NEXT_PUBLIC_API_URL',
  'AUTH_IDENTIFIER_HMAC_KEY', 'AUTH_OTP_PEPPER', 'COOKIE_SIGNING_SECRET',
  'CONTACT_ENCRYPTION_KEY_BASE64', 'OIDC_ISSUER', 'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OBJECT_STORAGE_BUCKET',
  'DOCUMENT_SCANNER_URL', 'DOCUMENT_SCANNER_TOKEN',
  'FINANCE_PROVIDER_INGRESS_TOKEN', 'SETTLEMENT_PROVIDER_INGRESS_TOKEN',
  'NOTIFICATION_GATEWAY_URL', 'NOTIFICATION_GATEWAY_TOKEN',
  'INVENTORY_LOCK_EXPIRY_SCAN_MS', 'INVENTORY_LOCK_EXPIRY_BATCH_SIZE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
];
for (const name of requiredEnv) {
  if (!new RegExp(`^${name}=`, 'm').test(envExample)) failures.push(`.env.example is missing ${name}.`);
}

const topologyPath = resolve(platform, 'ops/railway-gate7-staging.json');
if (existsSync(topologyPath)) {
  const topology = JSON.parse(readFileSync(topologyPath, 'utf8'));
  const canonicalReleaseSha = '288f4afba3b87dbc123eff6b198e1720075edc7d';

  if (topology.product !== 'PRENEURA Real Estate OS') failures.push('Gate 7 topology is not scoped to PRENEURA Real Estate OS.');
  if (topology.repository !== 'karimelzoser/realestate') failures.push('Gate 7 topology points to the wrong GitHub repository.');
  if (topology.releaseSha !== canonicalReleaseSha) failures.push(`Gate 7 topology release SHA must remain pinned to ${canonicalReleaseSha}.`);
  if (topology.railway?.projectName !== 'preneura-re-gate7-staging') failures.push('Gate 7 topology points to the wrong Railway project.');
  if (topology.railway?.environmentName !== 'staging') failures.push('Gate 7 topology must target the staging environment.');
  if (!topology.railway?.doNotTouchProjects?.includes('preneura-platform-preview')) {
    failures.push('Gate 7 topology must explicitly protect the separate preneura-platform-preview project.');
  }
  if (topology.railway?.database?.template !== 'postgres') failures.push('Gate 7 database must use the Railway postgres template.');
  if (topology.railway?.database?.expectedImage !== 'ghcr.io/railwayapp-templates/postgres-ssl:18') {
    failures.push('Gate 7 database image must remain PostgreSQL 18.');
  }

  const services = new Map((topology.railway?.services ?? []).map((service) => [service.name, service]));
  const expectedServices = ['re-web', 're-api', 're-worker', 're-notification-gateway'];
  if (services.size !== expectedServices.length || expectedServices.some((name) => !services.has(name))) {
    failures.push(`Gate 7 service set must be exactly: ${expectedServices.join(', ')}.`);
  }

  const web = services.get('re-web');
  const api = services.get('re-api');
  const worker = services.get('re-worker');
  const gateway = services.get('re-notification-gateway');
  for (const [name, service] of services) {
    if (service.rootDirectory !== 'platform') failures.push(`${name} must build from platform/.`);
    if (!service.buildCommand?.includes('pnpm install --frozen-lockfile')) failures.push(`${name} must use frozen dependency installation.`);
  }
  if (web?.healthcheckPath !== '/login') failures.push('re-web must use /login as its stable staging health path.');
  if (api?.healthcheckPath !== '/v1/health/ready') failures.push('re-api must use the readiness endpoint, not liveness, for traffic admission.');
  if (!api?.preDeployCommand?.includes('@preneura/database migrate')) failures.push('re-api must run the certified migration command before deploy.');
  if (worker?.public !== false) failures.push('re-worker must remain private.');
  if (gateway?.public !== false) failures.push('re-notification-gateway must remain private.');
  if (gateway?.healthcheckPath !== '/health') failures.push('re-notification-gateway health path must be /health.');
}

const deliveryGates = readFileSync(resolve(root, 'docs/PRODUCTION_DELIVERY_GATES.md'), 'utf8');
for (const phrase of [
  'no open P0/P1 launch defects',
  'migration rehearsal complete',
  'integrations verified with production credentials/endpoints',
  'data backup/restore verified',
  'monitoring dashboards and alerts live',
  'rollback path validated',
  'named operational owners available',
]) {
  if (!deliveryGates.includes(phrase)) failures.push(`Gate 7 definition is missing: ${phrase}`);
}

if (failures.length) {
  console.error('GATE7_STRUCTURAL_PREFLIGHT=FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('GATE7_STRUCTURAL_PREFLIGHT=PASS');
console.log(`LATEST_MIGRATION=${latestMigration}`);
console.log('RUNTIME_SCHEMA_VERSION=41');
console.log('CANONICAL_RELEASE_SHA=288f4afba3b87dbc123eff6b198e1720075edc7d');
console.log('RAILWAY_PROJECT=preneura-re-gate7-staging');
console.log('NOTE=External deployment, credential, monitoring, rollback and ownership evidence is intentionally not certified by this structural preflight.');
