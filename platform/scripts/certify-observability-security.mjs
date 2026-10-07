import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

const apiPort = 4510;
const collectorPort = 4511;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const collectorEndpoint = `http://127.0.0.1:${collectorPort}/v1/traces`;
const allowedWebOrigin = 'http://web.test';

const received = [];
const collector = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  request.on('end', () => {
    received.push({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks),
      contentType: request.headers['content-type'] ?? '',
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
});

await listen(collector, collectorPort);

process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = collectorEndpoint;
process.env.OTEL_SERVICE_NAME = 'preneura-observability-certification';
const { initializeObservability, shutdownObservability, withObservedSpan } = await import(
  '../packages/observability/dist/index.js'
);
initializeObservability('preneura-observability-certification');
await withObservedSpan('certification.span', { 'certification.kind': 'otlp-export' }, async () => 1);
await shutdownObservability();
await waitUntil(() => received.some((item) => item.url === '/v1/traces' && item.body.length > 0), 5_000);
console.log('OTLP trace export: VERIFIED');

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(apiPort),
  WEB_ORIGIN: allowedWebOrigin,
  DATABASE_URL: process.env.DATABASE_URL,
  OBJECT_STORAGE_BUCKET: 'certification-bucket',
  API_RATE_LIMIT_PER_MINUTE: '2',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: collectorEndpoint,
  SESSION_COOKIE_NAME: 'preneura_session',
};

const api = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: new URL('..', import.meta.url),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
api.stdout.on('data', (chunk) => { stdout += String(chunk); });
api.stderr.on('data', (chunk) => { stderr += String(chunk); });

try {
  await waitUntil(async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/health/live`);
      return response.status === 200;
    } catch {
      return false;
    }
  }, 15_000);

  const requestId = 'certification-request-12345';
  const live = await fetch(`${apiOrigin}/v1/health/live`, {
    headers: { 'x-request-id': requestId },
  });
  assert(live.status === 200, `Expected health/live 200, got ${live.status}`);
  assert(live.headers.get('x-request-id') === requestId, 'Request ID was not propagated to response.');
  assert(live.headers.get('cache-control') === 'no-store', 'API responses must be no-store.');
  assert(live.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff', 'Helmet nosniff missing.');
  console.log('Request correlation + security headers: VERIFIED');

  const csrf = await fetch(`${apiOrigin}/v1/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: 'preneura_session=fake-session',
      origin: 'http://evil.test',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert(csrf.status === 403, `Expected cross-origin cookie POST to return 403, got ${csrf.status}`);
  console.log('Cookie-session Origin enforcement: VERIFIED');

  const rateStatuses = [];
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch(`${apiOrigin}/v1/auth/me`);
    rateStatuses.push(response.status);
  }
  assert(rateStatuses.includes(429), `Expected rate limiting to produce 429, got ${rateStatuses.join(',')}`);
  console.log(`Global API throttling: VERIFIED (${rateStatuses.join(',')})`);

  await waitUntil(() => received.filter((item) => item.url === '/v1/traces' && item.body.length > 0).length >= 2, 8_000);
  console.log('API telemetry export: VERIFIED');

  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  for (const expected of [
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@fastify/helmet',
    '@fastify/rate-limit',
  ]) {
    assert(lock.includes(expected), `Lockfile does not contain ${expected}.`);
  }
  console.log('Observability/security dependency lock: VERIFIED');
} finally {
  api.kill('SIGTERM');
  await Promise.race([onceExit(api), sleep(5_000)]).catch(() => undefined);
  collector.close();
}

if (api.exitCode && api.exitCode !== 0) {
  throw new Error(`API exited unexpectedly (${api.exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function waitUntil(test, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test()) return;
    await sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for certification condition.`);
}

function onceExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once('exit', resolve);
  });
}
