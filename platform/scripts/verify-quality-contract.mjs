import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const mandatoryTests = [
  {
    path: 'apps/api/test/auth-assurance.test.ts',
    minimumDeclaredTests: 4,
  },
  {
    path: 'apps/api/test/identity-enrollment.test.ts',
    minimumDeclaredTests: 5,
  },
  { path: 'apps/api/test/developer-onboarding.test.ts', minimumDeclaredTests: 4 },
  { path: 'apps/api/test/eoi-choice.test.ts', minimumDeclaredTests: 4 },
  { path: 'apps/api/test/http-origin.test.ts', minimumDeclaredTests: 4 },
  { path: 'apps/api/test/exact-allocation.test.ts', minimumDeclaredTests: 4 },
  { path: 'apps/api/test/attribution-authority.test.ts', minimumDeclaredTests: 4 },
  { path: 'apps/web/scripts/locale-money.test.mjs', minimumDeclaredTests: 4 },
  { path: 'apps/web/scripts/api-proxy-config.test.mjs', minimumDeclaredTests: 3 },
  { path: 'apps/worker/test/runtime-config.test.ts', minimumDeclaredTests: 3 },
];
const workspaceManifests = [
  'apps/api/package.json',
  'apps/notification-gateway/package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/contracts/package.json',
  'packages/database/package.json',
  'packages/observability/package.json',
  'packages/security/package.json',
];

let declaredTests = 0;
for (const suite of mandatoryTests) {
  const absolute = resolve(root, suite.path);
  let source;
  try {
    source = await readFile(absolute, 'utf8');
  } catch (error) {
    throw new Error(`Mandatory test suite cannot be read: ${suite.path}`, { cause: error });
  }
  const count = [...source.matchAll(/\btest\s*\(/g)].length;
  if (count < suite.minimumDeclaredTests) {
    throw new Error(
      `Mandatory test suite ${suite.path} declares ${count} tests; expected at least ${suite.minimumDeclaredTests}.`,
    );
  }
  declaredTests += count;
}

const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const apiPackage = JSON.parse(await readFile(resolve(root, 'apps/api/package.json'), 'utf8'));

if (!String(rootPackage.scripts?.test ?? '').includes('verify-quality-contract.mjs')) {
  throw new Error('Root test command must verify the quality contract before Turbo runs.');
}
if (!String(rootPackage.scripts?.lint ?? '').includes('static-policy-lint.mjs')) {
  throw new Error('Root lint command must execute the static policy scanner.');
}
if (!String(apiPackage.scripts?.test ?? '').includes('auth-assurance.test.ts')) {
  throw new Error('API test command must execute the privileged-assurance suite explicitly.');
}
for (const file of ['identity-enrollment.test.ts', 'developer-onboarding.test.ts', 'eoi-choice.test.ts', 'http-origin.test.ts','exact-allocation.test.ts','attribution-authority.test.ts']) {
  if (!String(apiPackage.scripts?.test ?? '').includes(file)) throw new Error(`API test command must execute ${file}.`);
}
const webPackage = JSON.parse(await readFile(resolve(root, 'apps/web/package.json'), 'utf8'));
if (!String(webPackage.scripts?.test ?? '').includes('locale-money.test.mjs')) throw new Error('Web tests must execute exact money and bilingual EOI regressions.');

for (const relative of workspaceManifests) {
  const manifest = JSON.parse(await readFile(resolve(root, relative), 'utf8'));
  const testCommand = String(manifest.scripts?.test ?? '').trim();
  if (testCommand === 'node --test') {
    throw new Error(
      `${relative} advertises a bare node --test command that can pass with zero tests. Remove it or point it at a real suite.`,
    );
  }
}

console.log(
  `QUALITY_CONTRACT_OK mandatorySuites=${mandatoryTests.length} declaredTests=${declaredTests}`,
);
