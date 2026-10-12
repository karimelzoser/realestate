import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat, rename } from 'node:fs/promises';

// Offline provisioning inside the isolated project only. This does not activate
// an application account, mark email verified, enroll OTP or grant any role.
assert.equal(process.env.PRENEURA_VPS_OWNER_PREPARATION, 'true', 'Explicit isolated owner preparation is required.');
const email = (process.env.PRENEURA_OWNER_EMAIL ?? '').trim().toLowerCase();
assert.match(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'A supplied owner email is required.');
const password = process.env.KEYCLOAK_BOOTSTRAP_PASSWORD;
assert.ok(password, 'Private identity deployment credentials are required.');
const base = 'http://identity:8080/identity';
const target = '/owner-handoff/initial-owner.json';
const loginUrl = 'https://realestate-test.aipreneura.com:8443/login';
const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'realestate-deployment-admin', password }),
});
assert.equal(tokenResponse.status, 200, 'Private deployment administrator authentication failed.');
const { access_token: token } = await tokenResponse.json();
async function request(path, options = {}) {
  return fetch(`${base}/admin/realms/realestate${path}`, {
    ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...options.headers },
  });
}
async function saveHandoff(value) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
}
let handoff;
try { handoff = JSON.parse(await readFile(target, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  handoff = { username: email, reference: randomUUID(), temporaryPassword: randomBytes(24).toString('hex'), loginUrl,
    instructions: 'Sign in with your organization; replace the temporary password and configure your own authenticator. Administrator activation requires genuine MFA and separate offline review. Email ownership is not asserted by provisioning.' };
  await writeFile(target, JSON.stringify(handoff, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
assert.equal(handoff.username, email, 'Prepared identity belongs to another requested owner; preserve it for review.');
const response = await request(`/users?username=${encodeURIComponent(email)}&exact=true`);
assert.equal(response.status, 200, 'Owner candidate lookup failed.');
let users = await response.json();
if (users.length === 0) {
  const created = await request('/users', { method: 'POST', body: JSON.stringify({
    username: email, email, enabled: true, emailVerified: false, firstName: 'Platform', lastName: 'Owner',
    requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    attributes: { 'preneura-owner-preparation': [handoff.reference] },
    credentials: [{ type: 'password', temporary: true, value: handoff.temporaryPassword }],
  }) });
  assert.equal(created.status, 201, 'Owner creation failed; prepared credentials retained privately for safe recovery.');
  const location = created.headers.get('location') ?? '';
  const subject = location.match(/\/users\/([0-9a-f-]{36})$/)?.[1];
  assert.ok(subject, 'Created identity response lacks a subject; preserve private handoff and review before retry.');
  handoff.identitySubject = subject;
  await saveHandoff(handoff);
  const reread = await request(`/users?username=${encodeURIComponent(email)}&exact=true`);
  assert.equal(reread.status, 200, 'Created candidate could not be re-read.');
  users = await reread.json();
}
assert.equal(users.length, 1, 'Owner candidate must be unambiguous.');
const user = users[0];
// Keycloak's user-profile policy may omit unmanaged attributes. The subject in
// the actual create response is the durable authority; never reset an existing
// user's password based only on matching email/attributes.
if (!handoff.identitySubject) {
  const reviewedSubject = process.env.PRENEURA_OWNER_RECOVER_CREATED_SUBJECT;
  const preparedAt = (await stat(target)).mtimeMs;
  assert.equal(reviewedSubject, user.id, 'An interrupted create requires explicit review of its exact returned candidate.');
  assert.ok(Math.abs(user.createdTimestamp - preparedAt) < 300_000, 'Candidate was not created during this prepared handoff.');
  assert.ok(user.requiredActions.includes('UPDATE_PASSWORD') && user.requiredActions.includes('CONFIGURE_TOTP'), 'Do not recover an already used identity.');
  handoff.identitySubject = user.id;
  await saveHandoff(handoff);
}
assert.equal(user.enabled, true);
assert.equal(user.emailVerified, false, 'This preparation must not assert verified email ownership.');
assert.equal(handoff.identitySubject, user.id, 'Prepared subject changed.');
const roles = await request(`/users/${user.id}/role-mappings`);
assert.equal(roles.status, 200);
const mapping = await roles.json();
assert.ok(!Object.values(mapping.clientMappings ?? {}).some(client => ['realm-management', 'realestate-web'].includes(client.client)));
console.log(JSON.stringify({ status: 'OWNER_CANDIDATE_PREPARED', identitySubject: user.id,
  requiredActions: user.requiredActions, emailVerified: false, applicationAdminGranted: false, handoff: 'Private root-only file; never publish credentials.' }));
