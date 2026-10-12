import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateOidcRequestClaims } from '../src/auth/google-oidc.service.js';
const input = { nonce: 'random-request-nonce', clientId: 'preneura', requireAal2: true, nowSeconds: 1000 };
test('an MFA claim from a different or missing request nonce is rejected', () => {
  assert.throws(() => validateOidcRequestClaims({ auth_time: 1000 },input));
  assert.throws(() => validateOidcRequestClaims({ nonce: 'another-flow', auth_time: 1000 },input));
});
test('MFA authentication must include a fresh integral provider auth_time', () => {
  for (const auth_time of [undefined,699,1061,'1000',999.5]) assert.throws(() => validateOidcRequestClaims({ nonce: input.nonce,auth_time },input));
  assert.doesNotThrow(() => validateOidcRequestClaims({ nonce: input.nonce,auth_time: 700 },input));
});
test('a multi-audience token must explicitly identify this client as authorized party', () => {
  assert.throws(() => validateOidcRequestClaims({ nonce: input.nonce,auth_time: 1000,aud: ['preneura','other'] },input));
  assert.throws(() => validateOidcRequestClaims({ nonce: input.nonce,auth_time: 1000,azp: 'other' },input));
  assert.doesNotThrow(() => validateOidcRequestClaims({ nonce: input.nonce,auth_time: 1000,aud: ['preneura','other'],azp: 'preneura' },input));
});
test('ordinary sign-in still binds the nonce without claiming fresh MFA evidence', () => {
  assert.doesNotThrow(() => validateOidcRequestClaims({ nonce: input.nonce },{ ...input,requireAal2: false }));
});
