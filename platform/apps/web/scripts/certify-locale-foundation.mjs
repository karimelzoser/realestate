import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');

const [
  localeSource,
  providerSource,
  layoutSource,
  messagesSource,
  loginSource,
  pendingSource,
  verifySource,
] = await Promise.all([
  readFile(resolve(webRoot, 'lib/locale.ts'), 'utf8'),
  readFile(resolve(webRoot, 'app/locale-provider.tsx'), 'utf8'),
  readFile(resolve(webRoot, 'app/layout.tsx'), 'utf8'),
  readFile(resolve(webRoot, 'lib/messages.ts'), 'utf8'),
  readFile(resolve(webRoot, 'app/login/page.tsx'), 'utf8'),
  readFile(resolve(webRoot, 'app/access-pending/page.tsx'), 'utf8'),
  readFile(resolve(webRoot, 'app/verify-account/verify-account-client.tsx'), 'utf8'),
]);

for (const token of ["['en', 'ar']", "'Africa/Cairo'", "'EGP'", "'preneura.locale'"]) {
  assert.ok(localeSource.includes(token), `locale contract is missing ${token}`);
}

for (const token of ['arabicIndicDigits', 'easternArabicDigits', 'normalizeLocalizedDigits']) {
  assert.ok(localeSource.includes(token), `localized digit handling is missing ${token}`);
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

for (const token of [
  'تسجيل الدخول إلى PRENEURA',
  'الرقم القومي',
  'المتابعة باستخدام Google',
  'تم التحقق من الهوية',
  'تحقق من حسابك',
]) {
  assert.ok(messagesSource.includes(token), `Arabic critical-journey copy is missing ${token}`);
}

for (const [name, source] of [
  ['login', loginSource],
  ['access-pending', pendingSource],
  ['verify-account', verifySource],
]) {
  assert.ok(source.includes('authMessages[locale]'), `${name} must resolve copy from the active locale`);
  assert.ok(source.includes('useLocale()'), `${name} must use the shared locale context`);
}

assert.ok(
  loginSource.includes('normalizeLocalizedDigits(event.target.value)'),
  'login OTP input must accept Arabic-Indic digits',
);
assert.ok(
  verifySource.includes('normalizeLocalizedDigits(event.target.value)'),
  'account verification OTP input must accept Arabic-Indic digits',
);
assert.ok(
  loginSource.includes('setNotice(copy.genericOtpNotice)'),
  'localized login must preserve the generic anti-enumeration OTP response',
);

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

console.log('E02.1 locale and bilingual authentication certification passed.');
