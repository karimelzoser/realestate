import assert from 'node:assert/strict';
import {
  normalizeEgyptPhone,
  normalizeIdentityDocument,
  toAsciiDigits,
} from '../src/identity/identity-normalization.ts';

assert.equal(toAsciiDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
assert.equal(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
assert.equal(normalizeEgyptPhone('٠١٠١٢٣٤٥٦٧٨'), '+201012345678');

const nationalId = normalizeIdentityDocument({
  kind: 'NATIONAL_ID',
  identifier: '٣٠١٠١٠١١٢٣٤٥٦٧',
});
assert.deepEqual(nationalId, {
  kind: 'NATIONAL_ID',
  normalizedIdentifier: '30101011234567',
  countryCode: 'EG',
  displayHint: '••••••••••4567',
});

const passport = normalizeIdentityDocument({
  kind: 'PASSPORT',
  identifier: ' ab 12-345 ',
  countryCode: 'eg',
});
assert.deepEqual(passport, {
  kind: 'PASSPORT',
  normalizedIdentifier: 'EG:AB12345',
  countryCode: 'EG',
  displayHint: 'EG ••••2345',
});

for (const invalidNationalId of [
  '30113011234567', // invalid month
  '30102311234567', // invalid day
  '40101011234567', // unsupported century marker
  '3010101123456',  // too short
]) {
  assert.throws(() => normalizeIdentityDocument({ kind: 'NATIONAL_ID', identifier: invalidNationalId }));
}

assert.throws(() => normalizeIdentityDocument({ kind: 'PASSPORT', identifier: '***', countryCode: 'EG' }));

console.log('E02.2 Egypt identity normalization certification passed.');
