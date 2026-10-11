import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerHttpSecurity, trustedMutationOrigin } from '../src/security/http-security.js';

const env = { WEB_ORIGIN: 'https://app.preneura.test,https://admin.preneura.test' };
const cookie = 'preneura_session=synthetic-test-cookie';

test('unsafe cookie requests require an exact trusted origin or trusted referer', () => {
  assert.equal(trustedMutationOrigin('POST', { cookie, origin: 'https://app.preneura.test' }, env), true);
  assert.equal(trustedMutationOrigin('DELETE', { cookie, referer: 'https://admin.preneura.test/workspace' }, env), true);
  for (const origin of ['null', 'https://evil.test', 'https://app.preneura.test.evil.test', 'https://app.preneura.test/', 'https://app.preneura.test/path', 'https://user@app.preneura.test', 'http://app.preneura.test']) {
    assert.equal(trustedMutationOrigin('POST', { cookie, origin }, env), false, origin);
  }
  assert.equal(trustedMutationOrigin('POST', { cookie }, env), false);
  assert.equal(trustedMutationOrigin('POST', { cookie, origin: ['https://app.preneura.test', 'https://evil.test'] }, env), false);
});

test('an invalid Origin cannot be overridden by Referer and custom cookie names remain protected', () => {
  assert.equal(trustedMutationOrigin('PATCH', { cookie, origin: 'https://evil.test', referer: 'https://app.preneura.test/' }, env), false);
  assert.equal(trustedMutationOrigin('POST', { cookie: 'custom_session=value' }, { ...env, SESSION_COOKIE_NAME: 'custom_session' }), false);
});

test('safe reads and authenticated non-cookie machine flows retain their authorization boundary', () => {
  assert.equal(trustedMutationOrigin('GET', { cookie, origin: 'https://evil.test' }, env), true);
  assert.equal(trustedMutationOrigin('OPTIONS', { origin: 'https://evil.test' }, env), true);
  assert.equal(trustedMutationOrigin('POST', {}, env), true);
  assert.equal(trustedMutationOrigin('POST', { origin: 'https://evil.test' }, env), false);
});

test('the real Fastify hook blocks bodyless CSRF before the mutation handler and retains security headers', async () => {
  const server = Fastify();
  registerHttpSecurity(server, env);
  let mutations = 0;
  server.post('/mutation', async () => { mutations++; return { ok: true }; });
  try {
    const attack = await server.inject({ method: 'POST', url: '/mutation', headers: { cookie, origin: 'https://evil.test' } });
    assert.equal(attack.statusCode, 403);
    assert.equal(attack.json().error, 'UNTRUSTED_ORIGIN');
    assert.equal(attack.headers['x-content-type-options'], 'nosniff');
    assert.equal(mutations, 0);
    const missing = await server.inject({ method: 'POST', url: '/mutation', headers: { cookie } });
    assert.equal(missing.statusCode, 403);
    assert.equal(mutations, 0);
    const trusted = await server.inject({ method: 'POST', url: '/mutation', headers: { cookie, origin: 'https://app.preneura.test' } });
    assert.equal(trusted.statusCode, 200);
    assert.equal(mutations, 1);
  } finally { await server.close(); }
});
