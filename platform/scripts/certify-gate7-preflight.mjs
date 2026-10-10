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
console.log('NOTE=External deployment, credential, monitoring, rollback and ownership evidence is intentionally not certified by this structural preflight.');
