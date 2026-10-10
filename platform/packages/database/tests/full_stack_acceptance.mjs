import assert from 'node:assert/strict';
import { Pool } from 'pg';

const apiBase = process.env.ACCEPTANCE_API_URL ?? 'http://127.0.0.1:4100';
const webBase = process.env.ACCEPTANCE_WEB_URL ?? 'http://127.0.0.1:3000';
const gatewayBase = process.env.ACCEPTANCE_GATEWAY_URL ?? 'http://127.0.0.1:4300';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_TENANT = '41000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = '42000000-0000-4000-8000-000000000001';
const BROKER = '33000000-0000-4000-8000-000000000001';
const BUYER_TRANSACTION = '10000000-0000-4000-8000-000000000061';
const OTHER_BUYER_TRANSACTION = '20000000-0000-4000-8000-000000000062';
const OUTBOX_EVENT = '61000000-0000-4000-8000-000000000001';
const NOTIFICATION_JOB = '62000000-0000-4000-8000-000000000001';
const EXPIRED_LOCK = '64000000-0000-4000-8000-000000000001';

const tokens = {
  buyer: 'acceptance-buyer-token-0000000000000001',
  manager: 'acceptance-manager-token-00000000000001',
  brokerManager: 'acceptance-broker-manager-token-000001',
  brokerAgent: 'acceptance-broker-agent-token-0000001',
};

const db = new Pool({ connectionString: databaseUrl, max: 3 });

try {
  await certifyHealthAndPublicSurfaces();
  await certifyAuthorizationAndIsolation();
  await certifyBrokerRedaction();
  await certifyWorkerEffects();
  await certifyAuthenticatedNotificationProjection();
  await certifySessionRevocation();
  console.log('FULL_STACK_ACCEPTANCE_OK');
} finally {
  await db.end();
}

async function certifyHealthAndPublicSurfaces() {
  const live = await requestJson(`${apiBase}/v1/health/live`);
  assert.equal(live.response.status, 200);
  assert.equal(live.body.status, 'ok');

  const ready = await requestJson(`${apiBase}/v1/health/ready`);
  assert.equal(ready.response.status, 200);
  assert.equal(ready.body.status, 'ready');

  const unauthenticated = await fetch(`${apiBase}/v1/me/workspace`);
  assert.equal(unauthenticated.status, 401, 'protected API must reject missing session');

  const gatewayHealth = await requestJson(`${gatewayBase}/health`);
  assert.equal(gatewayHealth.response.status, 200);
  assert.equal(gatewayHealth.body.ok, true);

  const gatewayUnauthorized = await fetch(`${gatewayBase}/deliver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'acceptance-unauthorized' },
    body: JSON.stringify({}),
  });
  assert.equal(gatewayUnauthorized.status, 401, 'gateway delivery must reject missing bearer token');

  const login = await fetch(`${webBase}/login`);
  assert.equal(login.status, 200, 'production web login must render');
  const html = await login.text();
  assert.match(html, /Sign in to PRENEURA|Real Estate Operating System/);
}

async function certifyAuthorizationAndIsolation() {
  const managerWorkspace = await requestJson(`${apiBase}/v1/me/workspace`, session(tokens.manager));
  assert.equal(managerWorkspace.response.status, 200);
  assert.equal(managerWorkspace.body.projects.length, 1);
  assert.equal(managerWorkspace.body.projects[0].projectId, PROJECT);
  assert.ok(!managerWorkspace.body.projects.some((item) => item.projectId === OTHER_PROJECT));

  const forbidden = await fetch(`${apiBase}/v1/tenants/${OTHER_TENANT}/projects/${OTHER_PROJECT}/catalog`, session(tokens.manager));
  assert.ok([403, 404].includes(forbidden.status), `cross-tenant request leaked with HTTP ${forbidden.status}`);

  const buyerTransactions = await requestJson(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/transactions`,
    session(tokens.buyer),
  );
  assert.equal(buyerTransactions.response.status, 200);
  assert.ok(buyerTransactions.body.some((item) => item.transactionId === BUYER_TRANSACTION));
  assert.ok(!buyerTransactions.body.some((item) => item.transactionId === OTHER_BUYER_TRANSACTION));

  const brokerAgentTransactions = await requestJson(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/transactions`,
    session(tokens.brokerAgent),
  );
  assert.equal(brokerAgentTransactions.response.status, 200);
  assert.ok(brokerAgentTransactions.body.some((item) => item.transactionId === BUYER_TRANSACTION));
  assert.ok(!brokerAgentTransactions.body.some((item) => item.transactionId === OTHER_BUYER_TRANSACTION));
}

async function certifyBrokerRedaction() {
  const agent = await requestJson(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/brokers/${BROKER}/commissions`,
    session(tokens.brokerAgent),
  );
  assert.equal(agent.response.status, 200);
  assert.ok(agent.body.length >= 1, 'broker agent should see its attributed commission case');
  for (const item of agent.body) {
    assert.equal(Object.hasOwn(item, 'ratePercent'), false, 'broker agent must not receive commission rate');
    assert.equal(Object.hasOwn(item, 'commissionAmount'), false, 'broker agent must not receive commission amount');
    assert.equal(Object.hasOwn(item, 'basisAmount'), false, 'broker agent must not receive commission basis');
  }

  const manager = await requestJson(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/brokers/${BROKER}/commissions`,
    session(tokens.brokerManager),
  );
  assert.equal(manager.response.status, 200);
  assert.ok(manager.body.length >= 1, 'broker manager should see commission case');
  assert.ok(Object.hasOwn(manager.body[0], 'ratePercent'));
  assert.ok(Object.hasOwn(manager.body[0], 'commissionAmount'));
  assert.ok(Object.hasOwn(manager.body[0], 'basisAmount'));
}

async function certifyWorkerEffects() {
  await waitFor(async () => {
    const result = await db.query(
      `SELECT status, sent_at FROM notification_jobs WHERE id = $1::uuid`,
      [NOTIFICATION_JOB],
    );
    return result.rows[0]?.status === 'SENT' && result.rows[0]?.sent_at;
  }, 'worker did not send in-app notification');

  await waitFor(async () => {
    const result = await db.query(
      `SELECT count(*)::int AS count FROM user_notifications WHERE notification_job_id = $1::uuid`,
      [NOTIFICATION_JOB],
    );
    return result.rows[0]?.count === 1;
  }, 'worker did not materialize user notification');

  await waitFor(async () => {
    const result = await db.query(
      `SELECT published_at FROM domain_outbox_events WHERE id = $1::uuid`,
      [OUTBOX_EVENT],
    );
    return Boolean(result.rows[0]?.published_at);
  }, 'worker did not publish outbox event');

  const replay = await db.query(
    `SELECT count(*)::int AS count FROM realtime_events WHERE outbox_event_id = $1::uuid`,
    [OUTBOX_EVENT],
  );
  assert.equal(replay.rows[0].count, 1, 'outbox event must appear exactly once in durable realtime replay');

  await waitFor(async () => {
    const result = await db.query(`SELECT status FROM inventory_locks WHERE id = $1::uuid`, [EXPIRED_LOCK]);
    return result.rows[0]?.status === 'EXPIRED';
  }, 'worker did not reclaim expired inventory lock');
}

async function certifyAuthenticatedNotificationProjection() {
  const notifications = await requestJson(`${apiBase}/v1/me/notifications`, session(tokens.buyer));
  assert.equal(notifications.response.status, 200);
  assert.ok(
    notifications.body.some((item) => item.templateCode === 'acceptance.in_app'),
    'buyer notification inbox must expose worker-materialized notification',
  );
}

async function certifySessionRevocation() {
  const logout = await fetch(`${apiBase}/v1/auth/logout`, {
    ...session(tokens.buyer),
    method: 'POST',
  });
  assert.ok([200, 204].includes(logout.status));
  const after = await fetch(`${apiBase}/v1/me/workspace`, session(tokens.buyer));
  assert.equal(after.status, 401, 'revoked session must not remain authorized');
}

function session(token) {
  return { headers: { cookie: `preneura_session=${token}` } };
}

async function requestJson(url, init = undefined) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { response, body };
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw lastError;
  throw new Error(message);
}
