import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const stable=path.join(root,'app','index.html');
const entry=path.join(root,'index.html');

const requiredAssets=[
  'src/features/live-allocation/index.css',
  'src/features/live-allocation/index.js',
  'src/core/flow-navigation.css',
  'src/core/flow-navigation.js',
  'src/features/how-it-works/index.css',
  'src/features/how-it-works/index.js'
];

const requiredRoutes=[
  'b-browse','br-dashboard','r-checkin','m-home','b-eoi','b-allocation-day',
  'm-allocation-live','a-desk','b-site','b-building','b-floor','b-unit',
  'a-handoff','t-inbox','b-contract','b-properties','m-workflow','m-pricing',
  'm-permissions','m-replay'
];

const failures=[];
for(const rel of [stable,entry]) if(!fs.existsSync(rel)) failures.push('Missing '+path.relative(root,rel));
for(const rel of requiredAssets) if(!fs.existsSync(path.join(root,rel))) failures.push('Missing '+rel);

const combined=[
  fs.existsSync(stable)?fs.readFileSync(stable,'utf8'):'',
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

console.log('PRENEURA validation passed: '+requiredAssets.length+' modular assets and '+requiredRoutes.length+' flow destinations checked.');
