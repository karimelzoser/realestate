import { lookup } from 'node:dns/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect as tlsConnect } from 'node:tls';

const EXPECTED_RUNTIME_SCHEMA = 41;
const EXPECTED_MIGRATION = '0041_inventory_lock_expiry_durability';
const manifest = JSON.parse(
  await readFile(resolve(process.cwd(), 'ops/selfhosted-gate7-staging.json'), 'utf8'),
);

const evidenceEnv = {
  topologyTls: 'TOPOLOGY_TLS_EVIDENCE_REF',
  oidc: 'OIDC_EVIDENCE_REF',
  objectStorage: 'OBJECT_STORAGE_EVIDENCE_REF',
  messaging: 'MESSAGING_EVIDENCE_REF',
  documentScanner: 'DOCUMENT_SCANNER_EVIDENCE_REF',
  financeSettlement: 'FINANCE_SETTLEMENT_EVIDENCE_REF',
  observability: 'OBSERVABILITY_EVIDENCE_REF',
  backupRestore: 'BACKUP_RESTORE_EVIDENCE_REF',
  migrationRehearsal: 'MIGRATION_REHEARSAL_EVIDENCE_REF',
  rollbackCutover: 'ROLLBACK_CUTOVER_EVIDENCE_REF',
  securityApproval: 'SECURITY_APPROVAL_EVIDENCE_REF',
  operationalOwnership: 'OPERATIONAL_OWNERSHIP_EVIDENCE_REF',
};

function required(name) {
  const value = (process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required for final Gate 7 certification.`);
  return value;
}

function fullSha(value, name) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${name} must be a full 40-character lowercase Git SHA.`);
  return value;
}

function safeHttpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${name} must not contain embedded credentials.`);
  if (url.search || url.hash) throw new Error(`${name} must not contain query strings or fragments.`);
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`${name} must not use a loopback host.`);
  return url;
}

function evidenceRef(value, name) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length < 4 || trimmed.length > 500) throw new Error(`${name} must be a bounded evidence reference.`);
  if (/\s/.test(trimmed)) throw new Error(`${name} must not contain whitespace.`);
  if (/^(https:\/\/|gh-run:|artifact:|ticket:|runbook:|change:|incident:|approval:)[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(trimmed)) return trimmed;
  throw new Error(`${name} must be a traceable HTTPS or approved evidence reference (gh-run:, artifact:, ticket:, runbook:, change:, incident:, approval:).`);
}

function parseEvidenceBundle() {
  const bundleRaw = (process.env.GATE7_EVIDENCE_JSON ?? '').trim();
  let bundle = {};
  if (bundleRaw) {
    if (Buffer.byteLength(bundleRaw, 'utf8') > 16_384) throw new Error('GATE7_EVIDENCE_JSON exceeds 16 KiB.');
    try {
      bundle = JSON.parse(bundleRaw);
    } catch {
      throw new Error('GATE7_EVIDENCE_JSON must be valid JSON.');
    }
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('GATE7_EVIDENCE_JSON must be a JSON object.');
  }

  const evidence = {};
  const requiredEvidence = new Set(manifest.gate7?.requiredEvidence ?? []);
  const allowedKeys = new Set(Object.keys(evidenceEnv));
  for (const key of Object.keys(bundle)) {
    if (!allowedKeys.has(key)) throw new Error(`GATE7_EVIDENCE_JSON contains unknown evidence category ${key}.`);
  }
  for (const [key, envName] of Object.entries(evidenceEnv)) {
    if (!requiredEvidence.has(key)) throw new Error(`Manifest does not require Gate 7 evidence category ${key}.`);
    evidence[key] = evidenceRef(bundle[key] ?? process.env[envName], bundleRaw ? `evidence.${key}` : envName);
  }
  return evidence;
}

function joinUrl(base, suffix) {
  const url = new URL(base.toString());
  const basePath = url.pathname.replace(/\/$/, '');
  url.pathname = `${basePath}${suffix.startsWith('/') ? suffix : `/${suffix}`}`.replace(/\/+/g, '/');
  return url;
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) throw new Error(`${label} did not return JSON.`);
  return response.json();
}

async function fetchHtml(url, label) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  const body = await response.text();
  if (body.length < 100 || !/<html[\s>]/i.test(body)) throw new Error(`${label} did not return a usable HTML document.`);
  return { status: response.status, bytes: Buffer.byteLength(body) };
}

async function dnsProbe(url) {
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error(`DNS returned no addresses for ${url.hostname}.`);
  return records.map(({ address, family }) => ({ address, family }));
}

async function tlsProbe(url, minimumDays) {
  const port = url.port ? Number(url.port) : 443;
  return new Promise((resolvePromise, reject) => {
    const socket = tlsConnect(
      {
        host: url.hostname,
        port,
        servername: url.hostname,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        timeout: 15_000,
      },
      () => {
        try {
          if (!socket.authorized) throw new Error(socket.authorizationError || 'TLS peer is not authorized.');
          const cert = socket.getPeerCertificate();
          if (!cert?.valid_to || !cert.fingerprint256) throw new Error('TLS certificate metadata is incomplete.');
          const validTo = new Date(cert.valid_to);
          const remainingMs = validTo.getTime() - Date.now();
          if (!Number.isFinite(validTo.getTime()) || remainingMs < minimumDays * 86_400_000) {
            throw new Error(`TLS certificate for ${url.hostname} expires too soon (${cert.valid_to}).`);
          }
          resolvePromise({
            protocol: socket.getProtocol(),
            authorized: true,
            validTo: validTo.toISOString(),
            fingerprint256: cert.fingerprint256,
          });
        } catch (error) {
          reject(error);
        } finally {
          socket.end();
        }
      },
    );
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${url.hostname}:${port} timed out.`));
    });
    socket.once('error', reject);
  });
}

const deployedBundleSha = fullSha(required('DEPLOYED_RELEASE_SHA'), 'DEPLOYED_RELEASE_SHA');
const expectedBundleSha = fullSha(manifest.release?.deploymentBundleSha ?? '', 'manifest release.deploymentBundleSha');
const applicationRuntimeSha = fullSha(manifest.release?.applicationRuntimeSha ?? '', 'manifest release.applicationRuntimeSha');
if (deployedBundleSha !== expectedBundleSha) {
  throw new Error(`Deployed bundle ${deployedBundleSha} does not match certified deployment bundle ${expectedBundleSha}.`);
}
if (manifest.release?.runtimeSchemaVersion !== EXPECTED_RUNTIME_SCHEMA || manifest.release?.migrationMarker !== EXPECTED_MIGRATION) {
  throw new Error('Release manifest runtime schema identity does not match the certified Gate 7 evaluator.');
}

const apiUrl = safeHttpsUrl(required('API_URL'), 'API_URL');
const webUrl = safeHttpsUrl(required('WEB_URL'), 'WEB_URL');
const oidcIssuer = safeHttpsUrl(required('OIDC_ISSUER_URL'), 'OIDC_ISSUER_URL');
const operationalOwner = required('OPERATIONAL_OWNER');
if (operationalOwner.length < 3 || operationalOwner.length > 160) throw new Error('OPERATIONAL_OWNER must identify a named release/on-call owner.');
const evidence = parseEvidenceBundle();

const minimumTlsDays = Number(process.env.GATE7_TLS_MIN_REMAINING_DAYS ?? 14);
if (!Number.isInteger(minimumTlsDays) || minimumTlsDays < 1 || minimumTlsDays > 90) {
  throw new Error('GATE7_TLS_MIN_REMAINING_DAYS must be an integer from 1 through 90.');
}

const uniqueHosts = new Map();
for (const url of [apiUrl, webUrl, oidcIssuer]) uniqueHosts.set(url.hostname, url);
const network = {};
for (const [host, url] of uniqueHosts) {
  network[host] = {
    dns: await dnsProbe(url),
    tls: await tlsProbe(url, minimumTlsDays),
  };
}

const live = await fetchJson(joinUrl(apiUrl, '/v1/health/live'), 'API liveness');
if (live.status !== 'ok' || live.service !== 'preneura-api') throw new Error('API liveness payload is invalid.');

const ready = await fetchJson(joinUrl(apiUrl, '/v1/health/ready'), 'API readiness');
if (ready.status !== 'ready' || ready.service !== 'preneura-api') throw new Error('API readiness payload is not ready.');
const checks = ready.checks ?? {};
if (checks.database !== 'ok' || checks.schema !== 'ok') throw new Error('API readiness does not report healthy database/schema state.');
if (checks.runtimeSchemaVersion !== EXPECTED_RUNTIME_SCHEMA) throw new Error(`Deployed runtime schema is ${checks.runtimeSchemaVersion}, expected ${EXPECTED_RUNTIME_SCHEMA}.`);
if (!Number.isInteger(checks.databaseSchemaVersion) || checks.databaseSchemaVersion < EXPECTED_RUNTIME_SCHEMA) {
  throw new Error(`Database schema ${checks.databaseSchemaVersion} is older than runtime schema ${EXPECTED_RUNTIME_SCHEMA}.`);
}
if (!Number.isInteger(checks.minimumRuntimeVersion) || checks.minimumRuntimeVersion > EXPECTED_RUNTIME_SCHEMA) {
  throw new Error(`Database requires runtime ${checks.minimumRuntimeVersion}, which is newer than certified runtime ${EXPECTED_RUNTIME_SCHEMA}.`);
}
if (checks.databaseSchemaVersion === EXPECTED_RUNTIME_SCHEMA && checks.migrationMarker !== EXPECTED_MIGRATION.replace(/\.sql$/, '')) {
  throw new Error(`Database migration marker ${checks.migrationMarker} does not match ${EXPECTED_MIGRATION}.`);
}

const webProbe = await fetchHtml(webUrl, 'Web application');
const discoveryUrl = joinUrl(oidcIssuer, '/.well-known/openid-configuration');
const oidc = await fetchJson(discoveryUrl, 'OIDC discovery');
const normalizedIssuer = oidcIssuer.toString().replace(/\/$/, '');
if (String(oidc.issuer ?? '').replace(/\/$/, '') !== normalizedIssuer) throw new Error('OIDC discovery issuer does not exactly match OIDC_ISSUER_URL.');
for (const field of ['jwks_uri', 'authorization_endpoint', 'token_endpoint']) {
  const value = oidc[field];
  if (typeof value !== 'string') throw new Error(`OIDC discovery is missing ${field}.`);
  safeHttpsUrl(value, `OIDC ${field}`);
}

const report = {
  schemaVersion: 1,
  decision: 'GO',
  certifiedAt: new Date().toISOString(),
  repository: manifest.repository,
  release: {
    deployedBundleSha,
    certifiedBundleSha: expectedBundleSha,
    applicationRuntimeSha,
    runtimeSchemaVersion: EXPECTED_RUNTIME_SCHEMA,
    migrationMarker: EXPECTED_MIGRATION,
    certificationWorkflowSha: process.env.GITHUB_SHA ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
  },
  environment: {
    deploymentMode: manifest.deployment?.mode,
    operationalOwner,
    apiUrl: apiUrl.toString().replace(/\/$/, ''),
    webUrl: webUrl.toString().replace(/\/$/, ''),
    oidcIssuer: normalizedIssuer,
  },
  evidence,
  probes: {
    network,
    api: {
      liveness: { status: live.status, service: live.service },
      readiness: {
        status: ready.status,
        database: checks.database,
        schema: checks.schema,
        runtimeSchemaVersion: checks.runtimeSchemaVersion,
        databaseSchemaVersion: checks.databaseSchemaVersion,
        minimumRuntimeVersion: checks.minimumRuntimeVersion,
        migrationMarker: checks.migrationMarker,
      },
    },
    web: webProbe,
    oidc: {
      issuer: oidc.issuer,
      jwksUri: oidc.jwks_uri,
      authorizationEndpoint: oidc.authorization_endpoint,
      tokenEndpoint: oidc.token_endpoint,
    },
  },
};

const reportPath = resolve(process.cwd(), process.env.REPORT_PATH ?? 'gate7-live-evidence.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log('GATE7_FINAL_DECISION=GO');
console.log(`DEPLOYED_BUNDLE_SHA=${deployedBundleSha}`);
console.log(`APPLICATION_RUNTIME_SHA=${applicationRuntimeSha}`);
console.log(`RUNTIME_SCHEMA_VERSION=${EXPECTED_RUNTIME_SCHEMA}`);
console.log(`EVIDENCE_REPORT=${reportPath}`);
