import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const platform = resolve(process.cwd());
const failures = [];
const EXPECTED_RUNTIME_SHA = 'c2746523eb434898cbb4c46cf5df452d122ba78f';
const EXPECTED_BUNDLE_SHA = '4da4a83f7c5ca17ed7033237b9aca74186b912ce';
const EXPECTED_SCHEMA = 41;
const EXPECTED_MIGRATION = '0041_inventory_lock_expiry_durability.sql';

function requireFile(relative) {
  const full = resolve(root, relative);
  if (!existsSync(full)) failures.push(`Missing required release artifact: ${relative}`);
}

function requireGitAncestor(ancestor, descendant, description) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    failures.push(`${description}: ${ancestor} is not an ancestor of ${descendant}.`);
  }
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
  '.github/workflows/full-stack-acceptance-certification.yml',
  '.github/workflows/selfhosted-deployment-certification.yml',
  '.github/workflows/gate7-go-no-go.yml',
];
for (const workflow of requiredWorkflows) requireFile(workflow);

for (const artifact of [
  'platform/docs/PRODUCTION_CANDIDATE.md',
  'platform/docs/backup-restore.md',
  'platform/docs/gate6-nonfunctional-certification.md',
  'platform/docs/gate6-security-scan.md',
  'platform/docs/selfhosted-deployment-bundle.md',
  'platform/docs/deployment-provenance.md',
  'platform/ops/selfhosted-gate7-staging.json',
  'platform/scripts/collect-gate7-host-evidence.mjs',
  'docs/PRODUCTION_DELIVERY_GATES.md',
  'platform/.env.example',
]) requireFile(artifact);

const migrationsDir = resolve(platform, 'packages/database/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const latestMigration = migrations.at(-1);
if (latestMigration !== EXPECTED_MIGRATION) {
  failures.push(`Expected canonical latest migration ${EXPECTED_MIGRATION}, found ${latestMigration ?? 'none'}.`);
}

const runtimeReadiness = readFileSync(resolve(platform, 'packages/database/src/runtime-readiness.ts'), 'utf8');
if (!runtimeReadiness.includes(`RUNTIME_SCHEMA_VERSION = ${EXPECTED_SCHEMA}`)) {
  failures.push(`Runtime readiness is not pinned to canonical schema version ${EXPECTED_SCHEMA}.`);
}
if (!runtimeReadiness.includes("RUNTIME_MIGRATION_MARKER = '0041_inventory_lock_expiry_durability'")) {
  failures.push(`Runtime readiness does not require migration ${EXPECTED_MIGRATION}.`);
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

const topologyPath = resolve(platform, 'ops/selfhosted-gate7-staging.json');
if (existsSync(topologyPath)) {
  const topology = JSON.parse(readFileSync(topologyPath, 'utf8'));

  if (topology.version !== 2) failures.push('Gate 7 topology must use release manifest version 2.');
  if (topology.product !== 'PRENEURA Real Estate OS') failures.push('Gate 7 topology is not scoped to PRENEURA Real Estate OS.');
  if (topology.repository !== 'karimelzoser/realestate') failures.push('Gate 7 topology points to the wrong GitHub repository.');

  const release = topology.release ?? {};
  if (release.applicationRuntimeSha !== EXPECTED_RUNTIME_SHA) {
    failures.push(`Application runtime SHA must remain pinned to ${EXPECTED_RUNTIME_SHA}.`);
  }
  if (release.deploymentBundleSha !== EXPECTED_BUNDLE_SHA) {
    failures.push(`Deployment bundle SHA must remain pinned to ${EXPECTED_BUNDLE_SHA}.`);
  }
  if (release.runtimeSchemaVersion !== EXPECTED_SCHEMA) failures.push(`Release manifest runtime schema must be ${EXPECTED_SCHEMA}.`);
  if (release.migrationMarker !== EXPECTED_MIGRATION) failures.push(`Release manifest migration marker must be ${EXPECTED_MIGRATION}.`);

  requireGitAncestor(EXPECTED_RUNTIME_SHA, EXPECTED_BUNDLE_SHA, 'Release lineage is invalid');
  try {
    const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    requireGitAncestor(EXPECTED_BUNDLE_SHA, currentHead, 'Gate 7 policy must descend from the certified deployment bundle');
  } catch (error) {
    failures.push(`Unable to resolve current Git release lineage: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (topology.deployment?.mode !== 'self-hosted') failures.push('Gate 7 deployment mode must remain self-hosted.');
  if (topology.deployment?.operatingSystem !== 'Linux') failures.push('Gate 7 operating system contract must be Linux.');
  if (topology.deployment?.reverseProxy !== 'Nginx') failures.push('Certified deployment bundle must use Nginx as its edge proxy.');
  if (topology.deployment?.database?.engine !== 'PostgreSQL' || topology.deployment?.database?.majorVersion !== 18) {
    failures.push('Gate 7 database must remain PostgreSQL 18.');
  }
  if (topology.deployment?.database?.public !== false) failures.push('PostgreSQL must remain private.');
  if (topology.deployment?.objectStorage?.protocol !== 'S3-compatible') failures.push('Gate 7 object storage must remain S3-compatible.');
  if (topology.deployment?.objectStorage?.public !== false) failures.push('Object storage must remain private by default.');

  const ingress = topology.deployment?.ingress ?? {};
  if (ingress.publicService !== 're-edge') failures.push('Only re-edge may be the public ingress service.');
  if (ingress.bundleListenerPort !== 8080) failures.push('Certified edge listener must remain port 8080 inside the deployment bundle.');
  if (ingress.tlsTermination !== 'external' || ingress.publicHttpsRequired !== true) {
    failures.push('Gate 7 requires external TLS termination and public HTTPS.');
  }
  if (ingress.apiBasePath !== '/api' || ingress.readinessPath !== '/healthz' || ingress.livenessPath !== '/livez') {
    failures.push('Gate 7 ingress route contract does not match the certified Nginx bundle.');
  }

  const services = new Map((topology.deployment?.services ?? []).map((service) => [service.name, service]));
  const expectedServices = ['re-web', 're-api', 're-worker', 're-notification-gateway'];
  if (services.size !== expectedServices.length || expectedServices.some((name) => !services.has(name))) {
    failures.push(`Gate 7 application service set must be exactly: ${expectedServices.join(', ')}.`);
  }

  const web = services.get('re-web');
  const api = services.get('re-api');
  const gateway = services.get('re-notification-gateway');
  for (const [name, service] of services) {
    if (service.rootDirectory !== 'platform') failures.push(`${name} must build from platform/.`);
    if (!service.buildCommand?.includes('pnpm install --frozen-lockfile')) failures.push(`${name} must use frozen dependency installation.`);
    if (!service.startCommand?.startsWith('pnpm --filter @preneura/')) failures.push(`${name} must use the package-owned production start command.`);
    if (service.public !== false) failures.push(`${name} must remain private behind re-edge.`);
  }
  if (web?.healthcheckPath !== '/login') failures.push('re-web internal healthcheck must use /login.');
  if (api?.healthcheckPath !== '/v1/health/ready') failures.push('re-api must use readiness, not liveness, for traffic admission.');
  if (gateway?.healthcheckPath !== '/health') failures.push('re-notification-gateway health path must be /health.');

  const edge = topology.deployment?.edge ?? {};
  if (edge.name !== 're-edge' || edge.public !== true || edge.internalPort !== 8080) failures.push('Certified edge service contract is invalid.');
  const routes = edge.routes ?? {};
  const expectedRoutes = {
    '/': 're-web:3000',
    '/api/': 're-api:4100',
    '/healthz': 're-api:4100/v1/health/ready',
    '/livez': 're-api:4100/v1/health/live',
  };
  for (const [route, target] of Object.entries(expectedRoutes)) {
    if (routes[route] !== target) failures.push(`Edge route ${route} must target ${target}.`);
  }

  const migration = topology.deployment?.migration;
  if (!migration?.command?.includes('@preneura/database migrate')) failures.push('Gate 7 must use the certified migration runner.');
  if (migration?.runBeforeApplicationRestart !== true) failures.push('Migration must run before application restart/rollout.');
  if (migration?.autoMigrateOnApplicationStartup !== false) failures.push('Application processes must not auto-migrate at startup.');

  const requiredEvidence = new Set(topology.gate7?.requiredEvidence ?? []);
  for (const evidence of [
    'topologyTls', 'oidc', 'objectStorage', 'messaging', 'documentScanner',
    'financeSettlement', 'observability', 'backupRestore', 'migrationRehearsal',
    'rollbackCutover', 'securityApproval', 'operationalOwnership',
  ]) {
    if (!requiredEvidence.has(evidence)) failures.push(`Gate 7 required evidence list is missing ${evidence}.`);
  }

  const deployOnlyWhen = topology.gate7?.deployOnlyWhen ?? [];
  for (const phrase of ['PostgreSQL 18', 'TLS', 'operational owner', 'rollback', 'deploymentBundleSha']) {
    if (!deployOnlyWhen.some((item) => item.includes(phrase))) failures.push(`Gate 7 deployment prerequisites are missing a ${phrase} requirement.`);
  }
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
console.log(`RUNTIME_SCHEMA_VERSION=${EXPECTED_SCHEMA}`);
console.log(`APPLICATION_RUNTIME_SHA=${EXPECTED_RUNTIME_SHA}`);
console.log(`DEPLOYMENT_BUNDLE_SHA=${EXPECTED_BUNDLE_SHA}`);
console.log('DEPLOYMENT_MODE=self-hosted');
console.log('PUBLIC_INGRESS=re-edge');
console.log('NOTE=Live DNS/TLS/provider/monitoring/restore/cutover evidence remains fail-closed and must be supplied to the final Gate 7 workflow.');
