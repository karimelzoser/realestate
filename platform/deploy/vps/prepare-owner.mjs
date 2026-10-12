import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

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
let handoff;
try { handoff = JSON.parse(await readFile(target, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const generated = { reference: randomUUID(), temporaryPassword: randomBytes(24).toString('hex'), loginUrl,
    instructions: 'Sign in with your organization; replace the temporary password and configure your own authenticator. Administrator activation requires genuine MFA and separate offline review. Email ownership is not asserted by provisioning.' };
  // Only locally generated values enter this credential file. No email or HTTP
  // response is persisted; identity correlation stays in an admin-only IdP field.
  await writeFile(target, JSON.stringify(generated, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  handoff = generated;
}
if (handoff.username) assert.equal(handoff.username, email, 'Legacy prepared identity belongs to another requested owner; preserve it.');
const response = await request(`/users?username=${encodeURIComponent(email)}&exact=true`);
assert.equal(response.status, 200, 'Owner candidate lookup failed.');
let users = await response.json();
if (users.length === 0) {
  const profileResponse = await request('/users/profile');
  assert.equal(profileResponse.status, 200, 'Own realm profile could not be read.');
  const profile = await profileResponse.json();
  const attributeName = 'preneura-owner-preparation';
  if (!profile.attributes.some(attribute => attribute.name === attributeName)) {
    profile.attributes.push({name:attributeName,displayName:'Deployment preparation reference',
      permissions:{view:['admin'],edit:['admin']},validators:{pattern:{pattern:'^[0-9a-f-]{36}$'}}});
    assert.equal((await request('/users/profile',{method:'PUT',body:JSON.stringify(profile)})).status,200,'Private managed attribute configuration failed.');
  }
  const declared = profile.attributes.find(attribute => attribute.name === attributeName);
  assert.deepEqual(declared.permissions,{view:['admin'],edit:['admin']},'Preparation correlation must be admin-only.');
  const correlated = await request('/users?q='+encodeURIComponent(attributeName+':'+handoff.reference)+'&max=2');
  assert.equal(correlated.status,200);
  assert.equal((await correlated.json()).length,0,'This private preparation is already bound to another identity; never provision another account or reset credentials.');
  const created = await request('/users', { method: 'POST', body: JSON.stringify({
    username: email, email, enabled: true, emailVerified: false, firstName: 'Platform', lastName: 'Owner',
    requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    attributes: { 'preneura-owner-preparation': [handoff.reference] },
    credentials: [{ type: 'password', temporary: true, value: handoff.temporaryPassword }],
  }) });
  assert.equal(created.status, 201, 'Owner creation failed; prepared credentials retained privately for safe recovery.');
  const reread = await request(`/users?username=${encodeURIComponent(email)}&exact=true`);
  assert.equal(reread.status, 200, 'Created candidate could not be re-read.');
  users = await reread.json();
}
assert.equal(users.length, 1, 'Owner candidate must be unambiguous.');
const user = users[0];
// Older already prepared files retain their exact reviewed subject. New files
// use an admin-only IdP nonce so no response-derived data enters local storage.
if (handoff.identitySubject) assert.equal(handoff.identitySubject,user.id,'Legacy prepared subject changed.');
else assert.equal(user.attributes?.['preneura-owner-preparation']?.[0],handoff.reference,'Identity does not match this private generated preparation.');
assert.equal(user.enabled, true);
assert.equal(user.emailVerified, false, 'This preparation must not assert verified email ownership.');
const roles = await request(`/users/${user.id}/role-mappings`);
assert.equal(roles.status, 200);
const mapping = await roles.json();
assert.ok(!Object.values(mapping.clientMappings ?? {}).some(client => ['realm-management', 'realestate-web'].includes(client.client)));
console.log(JSON.stringify({ status: 'OWNER_CANDIDATE_PREPARED', identitySubject: user.id,
  requiredActions: user.requiredActions, emailVerified: false, applicationAdminGranted: false, handoff: 'Private root-only file; never publish credentials.' }));
