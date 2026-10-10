#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const targetPath = resolve(root, 'ops/gate7-railway-target.json');
const envExamplePath = resolve(root, '.env.example');
const target = JSON.parse(await readFile(targetPath, 'utf8'));
const envExample = await readFile(envExamplePath, 'utf8');
const knownVariables = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim()),
);

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);
const note = (message) => notes.push(message);

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

const services = target.services ?? [];
const byRole = new Map();
for (const service of services) {
  requireCondition(typeof service.role === 'string' && service.role.length > 0, 'Every Gate 7 service requires a role.');
  if (byRole.has(service.role)) fail(`Role ${service.role} is declared more than once.`);
  byRole.set(service.role, service);

  for (const variable of service.requiredVariables ?? []) {
    requireCondition(knownVariables.has(variable), `${service.role} requires ${variable}, but it is absent from platform/.env.example.`);
  }

  if (service.buildCommand) {
    requireCondition(
      service.buildCommand.includes('pnpm install --frozen-lockfile'),
      `${service.role} build must use the committed frozen lockfile.`,
    );
  }
}

const requiredRoles = ['web', 'api', 'worker', 'notification-gateway', 'keycloak', 'postgres', 'object-storage'];
for (const role of requiredRoles) requireCondition(byRole.has(role), `Missing required Gate 7 role: ${role}.`);

const api = byRole.get('api');
const web = byRole.get('web');
const worker = byRole.get('worker');
const gateway = byRole.get('notification-gateway');
const postgres = byRole.get('postgres');
const objectStorage = byRole.get('object-storage');

requireCondition(api?.healthcheckPath === '/v1/health/ready', 'API Railway healthcheck must use /v1/health/ready.');
requireCondition(
  api?.preDeployCommand === target.deploymentPolicy?.migrationCommand,
  'API pre-deploy must be the single declared migration authority.',
);
requireCondition(web?.public === true && api?.public === true, 'Web and API must be public edge services.');
requireCondition(worker?.public === false, 'Worker must not be publicly exposed.');
requireCondition(gateway?.public === false, 'Notification gateway must not be publicly exposed.');
requireCondition(postgres?.public === false, 'PostgreSQL must not be publicly exposed.');
requireCondition(postgres?.majorVersion === 18, 'Gate 7 requires PostgreSQL 18.');
requireCondition(postgres?.persistentVolumeRequired === true, 'PostgreSQL requires durable storage.');
requireCondition(postgres?.pitrRequired === true, 'PostgreSQL requires PITR/continuous recovery capability.');
requireCondition(objectStorage?.public === false, 'Document object storage must remain private.');
requireCondition(objectStorage?.versioningRequired === true, 'Document object storage must enable object versioning.');
requireCondition(
  objectStorage?.serverSideEncryptionRequired === true,
  'Document object storage must enable server-side encryption.',
);
requireCondition(target.deploymentPolicy?.databasePublicTcpAllowed === false, 'Public database TCP must be forbidden.');
requireCondition(target.deploymentPolicy?.objectStoragePublicAllowed === false, 'Public object storage must be forbidden.');

const forbiddenLegacyRoles = new Set(['nats', 'temporal']);
for (const service of services) {
  requireCondition(!forbiddenLegacyRoles.has(service.role), `${service.role} is not part of the certified Real Estate runtime.`);
}

const minimumReplicas = target.deploymentPolicy?.productionMinimumReplicas ?? {};
requireCondition((minimumReplicas.web ?? 0) >= 2, 'Production web target requires at least two replicas.');
requireCondition((minimumReplicas.api ?? 0) >= 2, 'Production API target requires at least two replicas.');

const apiUrl = process.env.GATE7_API_URL;
const webUrl = process.env.GATE7_WEB_URL;
if (apiUrl || webUrl) {
  requireCondition(Boolean(apiUrl && webUrl), 'Live Gate 7 probe requires both GATE7_API_URL and GATE7_WEB_URL.');
  if (apiUrl && webUrl) await certifyLive({ apiUrl, webUrl });
} else {
  note('Live probe skipped: GATE7_API_URL/GATE7_WEB_URL were not supplied. Static Gate 7 contract was still certified.');
}

if (failures.length > 0) {
  console.error(JSON.stringify({ status: 'failed', failures, notes }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: 'passed', services: services.map((service) => service.role), notes }, null, 2));

async function certifyLive({ apiUrl, webUrl }) {
  const normalizedApi = normalizedHttpsOrigin(apiUrl, 'GATE7_API_URL');
  const normalizedWeb = normalizedHttpsOrigin(webUrl, 'GATE7_WEB_URL');
  if (!normalizedApi || !normalizedWeb) return;

  const liveness = await timedFetch(`${normalizedApi}${target.liveCertification.apiLivenessPath}`);
  requireCondition(liveness.response.status === 200, `API liveness returned HTTP ${liveness.response.status}.`);

  const readiness = await timedFetch(`${normalizedApi}${target.liveCertification.apiReadinessPath}`);
  requireCondition(readiness.response.status === 200, `API readiness returned HTTP ${readiness.response.status}.`);
  const readyBody = await safeJson(readiness.response.clone());
  requireCondition(readyBody?.status === 'ok', 'API readiness body is not status=ok.');
  requireCondition(readyBody?.checks?.database === 'ok', 'API readiness did not certify PostgreSQL.');
  requireCondition(readyBody?.checks?.schema === 'ok', 'API readiness did not certify schema compatibility.');

  const expectedHeaders = target.liveCertification.expectedApiSecurityHeaders ?? {};
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    const actual = readiness.response.headers.get(name);
    requireCondition(actual === expected, `API security header ${name} expected ${expected}, got ${actual ?? '<missing>'}.`);
  }

  if (target.liveCertification.requireHsts) {
    const hsts = readiness.response.headers.get('strict-transport-security') ?? '';
    requireCondition(/max-age=\d+/i.test(hsts), 'API HSTS header is missing or invalid.');
  }
  if (target.liveCertification.requireRequestId) {
    const requestId = readiness.response.headers.get('x-request-id') ?? '';
    requireCondition(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId),
      'API response does not contain a valid server-generated UUID request ID.',
    );
  }

  const cors = await timedFetch(`${normalizedApi}${target.liveCertification.apiLivenessPath}`, {
    method: 'OPTIONS',
    headers: {
      Origin: normalizedWeb,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (target.liveCertification.requireCredentialedCors) {
    requireCondition(
      cors.response.headers.get('access-control-allow-origin') === normalizedWeb,
      'Credentialed CORS does not echo the certified web origin.',
    );
    requireCondition(
      cors.response.headers.get('access-control-allow-credentials') === 'true',
      'Credentialed CORS is missing Access-Control-Allow-Credentials: true.',
    );
  }

  const webResponse = await timedFetch(`${normalizedWeb}/`);
  requireCondition(webResponse.response.status >= 200 && webResponse.response.status < 400, `Web edge returned HTTP ${webResponse.response.status}.`);

  note(`Live API readiness: ${readiness.elapsedMs} ms.`);
  note(`Live web response: ${webResponse.elapsedMs} ms.`);
}

function normalizedHttpsOrigin(value, name) {
  try {
    const url = new URL(value);
    requireCondition(url.protocol === 'https:', `${name} must use HTTPS.`);
    requireCondition(url.pathname === '/' && !url.search && !url.hash, `${name} must be an origin without path/query/fragment.`);
    return url.origin;
  } catch (error) {
    fail(`${name} is not a valid URL: ${error instanceof Error ? error.message : String(error)}.`);
    return null;
  }
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GATE7_HTTP_TIMEOUT_MS ?? 10000));
  const started = performance.now();
  try {
    const response = await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
    return { response, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    fail(`Request failed for ${url}: ${error instanceof Error ? error.message : String(error)}.`);
    return { response: new Response(null, { status: 599 }), elapsedMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
