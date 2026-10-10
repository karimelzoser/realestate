import fs from 'node:fs';
import process from 'node:process';

const EXPECTED_SCHEMA_VERSION = 33;
const EXPECTED_MIGRATION_MARKER = '0033_runtime_readiness_contract';
const PLACEHOLDER = /(REPLACE_ME|\bTODO\b|\bTBC\b|\bUNKNOWN\b|\bN\/A\b|\bNONE\b)/i;
const REQUIRED_STRINGS = [
  'changeId',
  'migrationRehearsalId',
  'migrationPlanId',
  'rollbackPlanId',
  'backupEvidenceId',
  'restoreRehearsalId',
  'databasePitrEvidenceId',
  'objectStorageRecoveryEvidenceId',
  'securityReviewId',
  'monitoringDashboardUrl',
  'alertDeploymentId',
  'providerVerificationId',
  'oncallPrimary',
  'oncallSecondary',
  'customerSignoffId',
  'runbookVersion',
  'releaseManager',
  'attestedAt',
];

function fail(reason, details = {}) {
  console.error(JSON.stringify({ decision: 'NO_GO', reason, ...details }));
  process.exit(1);
}

function assertValue(record, key) {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length < 3) fail('MISSING_EVIDENCE', { field: key });
  if (PLACEHOLDER.test(value)) fail('PLACEHOLDER_EVIDENCE', { field: key });
  return value.trim();
}

function validateEvidence(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('INVALID_EVIDENCE_DOCUMENT');
  if (record.version !== 1) fail('UNSUPPORTED_EVIDENCE_VERSION', { expected: 1 });
  if (record.environment !== 'production') fail('INVALID_ENVIRONMENT', { expected: 'production' });
  if (typeof record.releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(record.releaseSha)) fail('INVALID_RELEASE_SHA');
  for (const key of REQUIRED_STRINGS) assertValue(record, key);

  let monitoring;
  try {
    monitoring = new URL(record.monitoringDashboardUrl);
  } catch {
    fail('INVALID_MONITORING_URL');
  }
  if (monitoring.protocol !== 'https:') fail('MONITORING_MUST_USE_HTTPS');
  if (record.oncallPrimary.trim().toLowerCase() === record.oncallSecondary.trim().toLowerCase()) {
    fail('ONCALL_OWNERS_MUST_BE_DISTINCT');
  }

  const attestedAt = new Date(record.attestedAt);
  if (Number.isNaN(attestedAt.getTime())) fail('INVALID_ATTESTATION_TIME');
  const ageMs = Date.now() - attestedAt.getTime();
  if (ageMs < -5 * 60_000) fail('ATTESTATION_TIME_IN_FUTURE');
  if (ageMs > 7 * 24 * 60 * 60_000) fail('ATTESTATION_TOO_OLD', { maxAgeDays: 7 });

  return record;
}

async function verifyProductionRuntime(evidence) {
  const expectedSha = process.env.EXPECTED_RELEASE_SHA;
  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) fail('EXPECTED_RELEASE_SHA_REQUIRED');
  if (expectedSha !== evidence.releaseSha) fail('RELEASE_SHA_MISMATCH', { expectedSha, evidenceSha: evidence.releaseSha });
  if (process.env.GATE7_EXTERNAL_ATTESTED !== 'true') fail('EXTERNAL_EVIDENCE_ATTESTATION_REQUIRED');

  const configured = process.env.PRODUCTION_READY_URL;
  if (!configured) fail('PRODUCTION_READY_URL_REQUIRED');
  let target;
  try {
    const base = new URL(configured);
    if (base.protocol !== 'https:') fail('PRODUCTION_READY_URL_MUST_USE_HTTPS');
    target = base.pathname.endsWith('/health/ready')
      ? base
      : new URL(`${base.href.replace(/\/$/, '')}/v1/health/ready`);
  } catch {
    fail('INVALID_PRODUCTION_READY_URL');
  }

  let response;
  try {
    response = await fetch(target, { headers: { 'user-agent': 'preneura-gate7-preflight/1' }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    fail('PRODUCTION_READINESS_UNREACHABLE', { error: error instanceof Error ? error.message : String(error) });
  }
  if (!response.ok) fail('PRODUCTION_NOT_READY', { status: response.status });

  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('INVALID_READINESS_PAYLOAD');
  }
  if (payload?.status !== 'ok' || payload?.checks?.database !== 'ok' || payload?.checks?.schema !== 'ok') {
    fail('PRODUCTION_READINESS_CHECKS_FAILED');
  }
  if (payload.checks.schemaVersion !== EXPECTED_SCHEMA_VERSION || payload.checks.migrationMarker !== EXPECTED_MIGRATION_MARKER) {
    fail('PRODUCTION_SCHEMA_CONTRACT_MISMATCH', {
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
      actualSchemaVersion: payload.checks.schemaVersion,
      expectedMigrationMarker: EXPECTED_MIGRATION_MARKER,
      actualMigrationMarker: payload.checks.migrationMarker,
    });
  }
  return { readinessUrl: target.href, schemaVersion: payload.checks.schemaVersion, migrationMarker: payload.checks.migrationMarker };
}

const args = process.argv.slice(2);
const offline = args.includes('--offline-test');
const path = args.find((arg) => !arg.startsWith('--'));
if (!path) fail('EVIDENCE_FILE_REQUIRED');

let evidence;
try {
  evidence = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (error) {
  fail('EVIDENCE_FILE_UNREADABLE', { error: error instanceof Error ? error.message : String(error) });
}

validateEvidence(evidence);

if (offline) {
  console.log(JSON.stringify({ decision: 'STRUCTURAL_PASS', releaseSha: evidence.releaseSha, note: 'No production GO is issued in offline test mode.' }));
  process.exit(0);
}

const runtime = await verifyProductionRuntime(evidence);
console.log(JSON.stringify({
  decision: 'GO',
  releaseSha: evidence.releaseSha,
  changeId: evidence.changeId,
  releaseManager: evidence.releaseManager,
  attestedAt: evidence.attestedAt,
  runtime,
}));
