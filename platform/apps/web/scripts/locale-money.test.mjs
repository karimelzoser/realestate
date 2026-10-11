import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDecimalCurrency, normalizeLocalizedDigits } from '../lib/locale.ts';
import { eoiMessages } from '../lib/eoi-messages.ts';

test('large immutable monetary strings retain cents beyond floating-point precision', () => {
  assert.match(formatDecimalCurrency('9007199254740991.12', 'EGP', 'en'), /9,007,199,254,740,991\.12/);
  assert.match(formatDecimalCurrency('0', 'EGP', 'en'), /0\.00/);
});
test('Arabic monetary formatting preserves the same exact amount', () => {
  const text = normalizeLocalizedDigits(formatDecimalCurrency('9007199254740991.12', 'EGP', 'ar'))
    .replaceAll('٬', '').replaceAll('٫', '.');
  assert.match(text, /9007199254740991\.12/);
});
test('small negative amounts keep their sign and invalid decimals fail closed', () => {
  assert.match(formatDecimalCurrency('-0.05', 'EGP', 'en'), /-.*0\.05/);
  for (const value of ['NaN', 'Infinity', '1e4', '12.345', '']) {
    assert.throws(() => formatDecimalCurrency(value, 'EGP', 'en'));
  }
  assert.throws(() => formatDecimalCurrency('1.00', 'bad', 'en'));
});
test('every EOI policy and selection message has Arabic and English copy', () => {
  assert.deepEqual(Object.keys(eoiMessages.ar).sort(), Object.keys(eoiMessages.en).sort());
  for (const key of Object.keys(eoiMessages.en)) {
    assert.ok(eoiMessages.en[key].trim());
    assert.match(eoiMessages.ar[key], /[\u0600-\u06ff]/);
  }
});
