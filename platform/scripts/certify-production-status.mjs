import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '..');
const statusPath = path.join(repoRoot, 'docs/PRODUCTION_IMPLEMENTATION_STATUS.md');
const text = fs.readFileSync(statusPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const requirementIds = [
  ...Array.from({ length: 15 }, (_, index) => `REQ-${String(index + 1).padStart(2, '0')}`),
  'AUTH-01',
];

for (const id of requirementIds) {
  const occurrences = text.split(`| ${id} |`).length - 1;
  assert(occurrences === 1, `${id} must appear exactly once in the production traceability table; found ${occurrences}.`);
}

for (const gate of ['G0','G1','G2','G3','G4','G5','G6','G7']) {
  assert(text.includes(`| ${gate} |`), `Production gate ${gate} is missing from the implementation status.`);
}

for (const phrase of [
  'IMPLEMENTED + CI CERTIFIED',
  'IMPLEMENTED; EXTERNAL CONFIG REQUIRED',
  'LAUNCH EVIDENCE REQUIRED',
  'NO_GO',
]) {
  assert(text.includes(phrase), `Required status vocabulary/decision phrase is missing: ${phrase}`);
}

const requiredExternalEvidence = [
  'PostgreSQL PITR',
  'object-storage recovery',
  'security review',
  'monitoring dashboards',
  'on-call',
  'customer/business signoff',
  'Gate 7 go/no-go',
];
for (const phrase of requiredExternalEvidence) {
  assert(text.toLowerCase().includes(phrase.toLowerCase()), `External launch dependency is missing from status: ${phrase}`);
}

assert(!/\|\s*(REQ-\d+|AUTH-01)\s*\|[^\n]*\|\s*NOT IMPLEMENTED\s*\|/i.test(text), 'A tracked requirement is still marked NOT IMPLEMENTED.');

console.log(`Production implementation traceability certified for ${requirementIds.length} tracked requirements and 8 release gates.`);
