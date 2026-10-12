import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRIVILEGED_ROLE_CODES,
  oidcAssuranceFromClaims,
  otpAssurance,
} from '../src/auth/auth-assurance.js';
import { safeRequestLog } from '../src/security/http-security.js';

test('request logs never include OAuth codes or query secrets', () => {
  const log = safeRequestLog({ id: 'request', method: 'GET', url: '/v1/auth/google/callback?code=secret-code&state=secret-state' });
  assert.equal(log.url, '/v1/auth/google/callback');
  assert.equal(JSON.stringify(log).includes('secret'), false);
});

test('OTP is always AAL1', () => {
  const assurance = otpAssurance();
  assert.equal(assurance.authMethod, 'OTP');
  assert.equal(assurance.assuranceLevel, 'AAL1');
});

test('OIDC is AAL2 only when verified claims prove approved step-up', () => {
  assert.equal(
    oidcAssuranceFromClaims({
      acr: 'urn:preneura:aal2',
      amr: [],
      approvedAcrValues: ['urn:preneura:aal2'],
    }).assuranceLevel,
    'AAL2',
  );

  assert.equal(
    oidcAssuranceFromClaims({
      acr: '1',
      amr: ['pwd', 'mfa'],
      approvedAcrValues: ['urn:preneura:aal2'],
    }).assuranceLevel,
    'AAL2',
  );

  assert.equal(
    oidcAssuranceFromClaims({
      acr: '1',
      amr: ['pwd'],
      approvedAcrValues: ['urn:preneura:aal2'],
    }).assuranceLevel,
    'AAL1',
  );
});

test('OIDC OTP or key AMR alone cannot satisfy privileged AAL2', () => {
  for (const amr of [
    ['otp'],
    ['pwd', 'otp'],
    ['hwk'],
    ['swk'],
  ]) {
    const assurance = oidcAssuranceFromClaims({
      acr: '1',
      amr,
      approvedAcrValues: ['urn:preneura:aal2'],
    });
    assert.equal(
      assurance.assuranceLevel,
      'AAL1',
      `AMR ${JSON.stringify(amr)} must not independently grant AAL2`,
    );
  }
});

test('privileged role set covers administrative, allocation and finance authority', () => {
  for (const role of [
    'PRENEURA_SUPER_ADMIN',
    'OPERATIONS_DIRECTOR',
    'MANAGER',
    'ALLOCATOR',
    'TRANSACTION_OPERATOR',
    'BROKER_MANAGER',
    'BROKER_FINANCE',
  ] as const) {
    assert.equal(PRIVILEGED_ROLE_CODES.has(role), true, `${role} must require AAL2`);
  }
  assert.equal(PRIVILEGED_ROLE_CODES.has('BUYER'), false);
  assert.equal(PRIVILEGED_ROLE_CODES.has('BROKER_AGENT'), false);
});
