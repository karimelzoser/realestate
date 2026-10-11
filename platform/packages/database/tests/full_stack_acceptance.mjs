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
const MANAGER_USER = '31000000-0000-4000-8000-000000000001';
const BROKER = '33000000-0000-4000-8000-000000000001';
const BUYER_TRANSACTION = '10000000-0000-4000-8000-000000000061';
const OTHER_BUYER_TRANSACTION = '20000000-0000-4000-8000-000000000062';
const OUTBOX_EVENT = '61000000-0000-4000-8000-000000000001';
const NOTIFICATION_JOB = '62000000-0000-4000-8000-000000000001';
const EXPIRED_LOCK = '64000000-0000-4000-8000-000000000001';
const SUPPORT_USER = '36000000-0000-4000-8000-000000000001';
const SUPPORT_ASSIGNMENT = '36000000-0000-4000-8000-000000000002';
const SUPPORT_AUTH_SESSION = '36000000-0000-4000-8000-000000000003';
const SUPPORT_ACCESS_SESSION = '36000000-0000-4000-8000-000000000004';
const SUPPORT_TOKEN = 'acceptance-super-admin-token-000000001';

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
  await certifyEoiChoiceHttpBoundary();
  await certifyLifecycleRevocation();
  await certifyBrokerRedaction();
  await certifyProjectStreamMembershipRevocation();
  await certifyBrokerStreamAccessRevocation();
  await certifySupportStreamExpiry();
  await certifyStreamPrivilegeEscalation();
  await certifyWorkerEffects();
  await certifyAuthenticatedNotificationProjection();
  await certifySessionRevocation();
  console.log('FULL_STACK_ACCEPTANCE_OK');
} finally {
  await db.end();
}

async function certifyEoiChoiceHttpBoundary() {
  const path = `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}`;
  const policy = await requestJson(`${path}/eoi-policy`, session(tokens.buyer));
  assert.equal(policy.response.status, 200);
  assert.equal(policy.body.refundPolicyId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  const headers = { ...session(tokens.buyer).headers, 'content-type': 'application/json' };
  const choice = { unitTypeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', refundPolicyId: policy.body.refundPolicyId, acceptedPolicy: true };
  const missing = await requestJson(`${path}/buyers/10000000-0000-4000-8000-000000000001/eois`, {
    method: 'POST', headers, body: JSON.stringify({ refundPolicyId: policy.body.refundPolicyId, acceptedPolicy: true }),
  });
  assert.equal(missing.response.status, 400, 'missing apartment type must fail at HTTP boundary');
  const otherBuyer = await requestJson(`${path}/buyers/20000000-0000-4000-8000-000000000002/eois`, {
    method: 'POST', headers, body: JSON.stringify(choice),
  });
  assert.equal(otherBuyer.response.status, 403, 'buyer may not create another buyer EOI');
  const retry = await requestJson(`${path}/buyers/10000000-0000-4000-8000-000000000001/eois`, {
    method: 'POST', headers, body: JSON.stringify(choice),
  });
  assert.equal(retry.response.status, 201);
  assert.equal(retry.body.eoiId, '10000000-0000-4000-8000-000000000011');
  const list = await requestJson(`${path}/eois`, session(tokens.buyer));
  assert.equal(list.response.status, 200);
  assert.equal(list.body.length, 1, 'buyer EOI list must remain ownership-scoped');
  assert.equal(list.body[0].selectedUnitTypeId, choice.unitTypeId);
  assert.equal(list.body[0].policyVersionNumber, 1);
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

async function certifyLifecycleRevocation() {
  const catalogUrl = `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/catalog`;
  const active = await fetch(catalogUrl, session(tokens.manager));
  assert.equal(active.status, 200, 'active tenant/member/project should authorize existing manager session');

  try {
    await db.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1::uuid`, [TENANT]);
    const suspendedTenant = await fetch(catalogUrl, session(tokens.manager));
    assert.equal(suspendedTenant.status, 403, 'suspended tenant must revoke direct API authorization immediately');
  } finally {
    await db.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1::uuid`, [TENANT]);
  }

  try {
    await db.query(
      `UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE tenant_id = $1::uuid AND user_id = $2::uuid`,
      [TENANT, MANAGER_USER],
    );
    const suspendedMembership = await fetch(catalogUrl, session(tokens.manager));
    assert.equal(suspendedMembership.status, 403, 'suspended membership must revoke direct API authorization immediately');
  } finally {
    await db.query(
      `UPDATE tenant_memberships SET status = 'ACTIVE' WHERE tenant_id = $1::uuid AND user_id = $2::uuid`,
      [TENANT, MANAGER_USER],
    );
  }

  try {
    await db.query(`UPDATE projects SET status = 'PAUSED' WHERE id = $1::uuid`, [PROJECT]);
    const pausedRead = await fetch(catalogUrl, session(tokens.manager));
    assert.equal(pausedRead.status, 200, 'paused project must retain historical/read-only access');

    const pausedWrite = await fetch(`${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/unit-types`, {
      ...session(tokens.manager),
      method: 'POST',
      headers: {
        ...session(tokens.manager).headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        code: 'PAUSED-LIFECYCLE-PROBE',
        name: 'Paused lifecycle probe',
        indoorAreaSqm: '100',
        roofAreaSqm: '0',
        gardenAreaSqm: '0',
      }),
    });
    assert.equal(pausedWrite.status, 403, 'paused project must reject mutating project operations');
  } finally {
    await db.query(`UPDATE projects SET status = 'ACTIVE' WHERE id = $1::uuid`, [PROJECT]);
  }

  try {
    await db.query(`UPDATE projects SET status = 'ARCHIVED' WHERE id = $1::uuid`, [PROJECT]);
    const archived = await fetch(catalogUrl, session(tokens.manager));
    assert.ok([403, 404].includes(archived.status), 'archived project must not authorize direct project access');
  } finally {
    await db.query(`UPDATE projects SET status = 'ACTIVE' WHERE id = $1::uuid`, [PROJECT]);
  }
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

async function certifyProjectStreamMembershipRevocation() {
  const stream = await openSse(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/events`,
    tokens.manager,
  );
  try {
    await db.query(
      `UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE tenant_id = $1::uuid AND user_id = $2::uuid`,
      [TENANT, MANAGER_USER],
    );
    await waitForSseEvent(stream, 'access_revoked', 7_000);
  } finally {
    await db.query(
      `UPDATE tenant_memberships SET status = 'ACTIVE' WHERE tenant_id = $1::uuid AND user_id = $2::uuid`,
      [TENANT, MANAGER_USER],
    );
    await closeSse(stream);
  }
}

async function certifyBrokerStreamAccessRevocation() {
  const stream = await openSse(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/brokers/${BROKER}/events`,
    tokens.brokerAgent,
  );
  try {
    await db.query(
      `UPDATE broker_project_access SET status = 'SUSPENDED' WHERE tenant_id = $1::uuid AND project_id = $2::uuid AND broker_company_id = $3::uuid`,
      [TENANT, PROJECT, BROKER],
    );
    await waitForSseEvent(stream, 'access_revoked', 7_000);
  } finally {
    await db.query(
      `UPDATE broker_project_access SET status = 'ACTIVE' WHERE tenant_id = $1::uuid AND project_id = $2::uuid AND broker_company_id = $3::uuid`,
      [TENANT, PROJECT, BROKER],
    );
    await closeSse(stream);
  }
}

async function certifySupportStreamExpiry() {
  await createTemporarySupportFixture();
  const stream = await openSse(
    `${apiBase}/v1/tenants/${TENANT}/projects/${PROJECT}/events`,
    SUPPORT_TOKEN,
  );
  try {
    await db.query(
      `UPDATE platform_support_access_sessions SET expires_at = now() + interval '2 seconds' WHERE id = $1::uuid`,
      [SUPPORT_ACCESS_SESSION],
    );
    await waitForSseEvent(stream, 'access_revoked', 7_000);
  } finally {
    await closeSse(stream);
    await deleteTemporarySupportFixture();
  }
}

async function createTemporarySupportFixture() {
  await db.query(
    `INSERT INTO users (id, display_name, status)
     VALUES ($1::uuid, 'Acceptance Support Admin', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ACTIVE'`,
    [SUPPORT_USER],
  );
  await db.query(
    `INSERT INTO access_role_assignments (
       id, user_id, role_code, scope_type, tenant_id, project_id, broker_company_id, status
     ) VALUES ($1::uuid, $2::uuid, 'PRENEURA_SUPER_ADMIN', 'PLATFORM', NULL, NULL, NULL, 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', revoked_at = NULL`,
    [SUPPORT_ASSIGNMENT, SUPPORT_USER],
  );
  await db.query(
    `INSERT INTO auth_sessions (id, user_id, token_digest, expires_at)
     VALUES ($1::uuid, $2::uuid, digest($3, 'sha256'), now() + interval '1 hour')
     ON CONFLICT (id) DO UPDATE SET revoked_at = NULL, expires_at = EXCLUDED.expires_at`,
    [SUPPORT_AUTH_SESSION, SUPPORT_USER, SUPPORT_TOKEN],
  );
  await db.query(
    `INSERT INTO platform_support_access_sessions (
       id, operator_user_id, tenant_id, project_id, reason, status, expires_at
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Full-stack support expiry certification', 'ACTIVE', now() + interval '10 minutes')
     ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', ended_at = NULL, expires_at = EXCLUDED.expires_at`,
    [SUPPORT_ACCESS_SESSION, SUPPORT_USER, TENANT, PROJECT],
  );
}

async function deleteTemporarySupportFixture() {
  await db.query(`DELETE FROM platform_support_access_sessions WHERE id = $1::uuid`, [SUPPORT_ACCESS_SESSION]);
  await db.query(`DELETE FROM auth_sessions WHERE id = $1::uuid`, [SUPPORT_AUTH_SESSION]);
  await db.query(`DELETE FROM access_role_assignments WHERE id = $1::uuid`, [SUPPORT_ASSIGNMENT]);
  await db.query(`DELETE FROM users WHERE id = $1::uuid`, [SUPPORT_USER]);
}

async function certifyStreamPrivilegeEscalation() {
  const stream = await openSse(`${apiBase}/v1/me/notifications/events`, tokens.buyer);
  const assignment = '36000000-0000-4000-8000-000000000010';
  try {
    const buyer = await db.query(`SELECT user_id FROM auth_sessions WHERE token_digest = digest($1, 'sha256')`, [tokens.buyer]);
    await db.query(`INSERT INTO access_role_assignments (id, user_id, role_code, scope_type, tenant_id, project_id, status)
      VALUES ($1::uuid, $2::uuid, 'MANAGER', 'PROJECT', $3::uuid, $4::uuid, 'ACTIVE')`,
    [assignment, buyer.rows[0].user_id, TENANT, PROJECT]);
    await waitForSseEvent(stream, 'access_revoked', 7_000);
  } finally {
    await db.query('DELETE FROM access_role_assignments WHERE id = $1::uuid', [assignment]);
    await closeSse(stream);
  }
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
  const stream = await openSse(`${apiBase}/v1/me/notifications/events`, tokens.buyer);
  try {
    const logout = await fetch(`${apiBase}/v1/auth/logout`, {
      ...session(tokens.buyer),
      method: 'POST',
    });
    assert.ok([200, 204].includes(logout.status));
    await waitForSseEvent(stream, 'access_revoked', 7_000);
  } finally {
    await closeSse(stream);
  }
  const after = await fetch(`${apiBase}/v1/me/workspace`, session(tokens.buyer));
  assert.equal(after.status, 401, 'revoked session must not remain authorized');
}

function session(token) {
  return { headers: { cookie: `preneura_session=${token}` } };
}

async function openSse(url, token) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: {
      cookie: `preneura_session=${token}`,
      accept: 'text/event-stream',
    },
    signal: controller.signal,
  });
  if (response.status !== 200) {
    const text = await response.text();
    controller.abort();
    throw new Error(`SSE open failed ${response.status} ${url}: ${text.slice(0, 500)}`);
  }
  assert.ok(response.body, `SSE response body missing for ${url}`);
  return {
    url,
    controller,
    reader: response.body.getReader(),
    decoder: new TextDecoder(),
    buffer: '',
  };
}

async function waitForSseEvent(stream, eventType, timeoutMs) {
  const timeout = setTimeout(() => stream.controller.abort(), timeoutMs);
  try {
    while (true) {
      const { value, done } = await stream.reader.read();
      if (done) throw new Error(`SSE stream ${stream.url} closed before ${eventType}`);
      stream.buffer += stream.decoder.decode(value, { stream: true });
      const blocks = stream.buffer.split(/\r?\n\r?\n/);
      stream.buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const eventLine = block
          .split(/\r?\n/)
          .find((line) => line.startsWith('event:'));
        if (eventLine?.slice('event:'.length).trim() === eventType) return;
      }
      if (stream.buffer.length > 32_000) stream.buffer = stream.buffer.slice(-8_000);
    }
  } catch (error) {
    if (stream.controller.signal.aborted) {
      throw new Error(`Timed out waiting ${timeoutMs}ms for SSE event ${eventType} from ${stream.url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function closeSse(stream) {
  if (!stream.controller.signal.aborted) stream.controller.abort();
  await stream.reader.cancel().catch(() => undefined);
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
