import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const roots = ['apps', 'packages'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const violations = [];
const rules = [
  { name: '@ts-nocheck', pattern: /@ts-nocheck\b/ },
  { name: '@ts-ignore', pattern: /@ts-ignore\b/ },
  { name: 'focused test', pattern: /\b(?:test|it|describe)\.only\s*\(/ },
  { name: 'merge conflict marker', pattern: /^(?:<{7}|={7}|>{7})/m },
];

for (const directory of roots) {
  await scan(join(root, directory));
}

if (violations.length > 0) {
  console.error('Static policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('STATIC_POLICY_LINT_OK');
}

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!extensions.has(extname(entry.name))) continue;
    const content = await readFile(path, 'utf8');
    for (const rule of rules) {
      if (rule.pattern.test(content)) {
        violations.push(`${relative(root, path)}: ${rule.name}`);
      }
    }
  }
}
