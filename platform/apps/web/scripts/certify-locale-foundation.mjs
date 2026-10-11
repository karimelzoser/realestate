import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');

const [localeSource, providerSource, layoutSource] = await Promise.all([
  readFile(resolve(webRoot, 'lib/locale.ts'), 'utf8'),
  readFile(resolve(webRoot, 'app/locale-provider.tsx'), 'utf8'),
  readFile(resolve(webRoot, 'app/layout.tsx'), 'utf8'),
]);

for (const token of ["['en', 'ar']", "'Africa/Cairo'", "'EGP'", "'preneura.locale'"]) {
  assert.ok(localeSource.includes(token), `locale contract is missing ${token}`);
}

for (const token of [
  'window.localStorage.getItem',
  'window.localStorage.setItem',
  'document.documentElement',
  'root.lang = locale',
  'root.dir = getLocaleDirection(locale)',
  "persistLocale('en')",
  "persistLocale('ar')",
  'aria-pressed',
]) {
  assert.ok(providerSource.includes(token), `locale provider is missing ${token}`);
}

assert.ok(layoutSource.includes('<LocaleProvider>'), 'root layout must install LocaleProvider');
assert.ok(layoutSource.includes('lang="en"'), 'root layout must provide an English SSR fallback language');
assert.ok(layoutSource.includes('dir="ltr"'), 'root layout must provide an LTR SSR fallback direction');

const egp = new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(1250);
assert.match(egp, /1[,.]?250|١/);

const cairo = new Intl.DateTimeFormat('en-EG', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date('2026-01-15T10:00:00Z'));
assert.ok(cairo.length > 0, 'Cairo formatter must produce output');

console.log('E02.1 locale foundation certification passed.');
