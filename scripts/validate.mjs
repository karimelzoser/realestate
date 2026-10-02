import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const stable=path.join(root,'app','index.html');
const entry=path.join(root,'index.html');

const requiredAssets=[
  'src/core/product-model.js',
  'src/core/role-policy.js',
  'src/core/state.js',
  'src/features/live-allocation/index.css',
  'src/features/live-allocation/index.js',
  'src/core/flow-navigation.css',
  'src/core/flow-navigation.js',
  'src/core/router.css',
  'src/core/router.js',
  'src/features/buyer-experience/index.css',
  'src/features/buyer-experience/index.js',
  'src/features/how-it-works/index.css',
  'src/features/how-it-works/index.js'
];

const requiredRoutes=[
  'b-browse','br-dashboard','r-checkin','m-home','b-eoi','b-allocation-day',
  'm-allocation-live','a-desk','b-site','b-building','b-floor','b-unit',
  'a-handoff','t-inbox','b-contract','b-properties','m-workflow','m-pricing',
  'm-permissions','m-replay'
];

const requiredLegacyAnchors=[
  'rev607-horizontal-scroll-flow-style',
  'rev607-horizontal-scroll-flow-script',
  'rev609-click-label-home-fix-style',
  'rev611-stable-home-navigation-script',
  'rev613-role-clarity-voice-advisor-style',
  'rev613-role-clarity-voice-advisor-script',
  'rev614-page-audit-myproperty-bilingual-ai-style',
  'rev614-page-audit-myproperty-bilingual-ai-script',
  'rev615-flow-page-audit-style',
  'rev615-flow-page-audit-script'
];

const failures=[];
for(const rel of [stable,entry]) if(!fs.existsSync(rel)) failures.push('Missing '+path.relative(root,rel));
for(const rel of requiredAssets) if(!fs.existsSync(path.join(root,rel))) failures.push('Missing '+rel);

const stableHtml=fs.existsSync(stable)?fs.readFileSync(stable,'utf8'):'';
const entryHtml=fs.existsSync(entry)?fs.readFileSync(entry,'utf8'):'';

for(const anchor of requiredLegacyAnchors){
  if(!stableHtml.includes('id="'+anchor+'"')) failures.push('Stable shell anchor missing: '+anchor);
}

for(const asset of requiredAssets){
  if(!entryHtml.includes(asset)) failures.push('Modular loader does not reference: '+asset);
}

const combined=[
  stableHtml,
  ...requiredAssets.filter(x=>x.endsWith('.js')&&fs.existsSync(path.join(root,x))).map(x=>fs.readFileSync(path.join(root,x),'utf8'))
].join('\n');

for(const route of requiredRoutes){
  if(!combined.includes("'"+route+"'")&&!combined.includes('"'+route+'"')) failures.push('Flow destination not found: '+route);
}

if(failures.length){
  console.error('PRENEURA validation failed');
  failures.forEach(x=>console.error('- '+x));
  process.exit(1);
}

console.log('PRENEURA validation passed');
console.log('- '+requiredAssets.length+' modular assets');
console.log('- '+requiredLegacyAnchors.length+' stable-shell extraction anchors');
console.log('- '+requiredRoutes.length+' required flow destinations');
