import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const pkg=JSON.parse(read('package.json'));
const entry=read('index.html');
const readme=read('README.md');
const presentation=read('docs/PRESENTATION_6.7.md');
const finalReview=read('docs/FINAL_REVIEW_6.7.md');
const releaseValidator=read('scripts/validate-release.mjs');
const englishVoice=read('src/features/local-voice-agent/english-only.js');
const server67=read('local_voice_agent/server67.py');
const grace=read('src/features/lock-grace/index.js');
const graceInbox=read('src/features/lock-grace/operator-inbox.js');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}
function mustNot(text,needle,label){if(text.includes(needle))fail.push(label||('Unexpected '+needle));}

if(pkg.version!=='6.7.1') fail.push('package.json must identify the final consistency release as 6.7.1');
must(readme,'Modular online release: 6.7.1','README release number is stale');
must(readme,'docs/PRESENTATION_6.7.md','README must point to the current presentation runbook');
must(readme,'docs/FINAL_REVIEW_6.7.md','README must point to the final review');

must(entry,'src/features/local-voice-agent/english-only.js','Active English advisor asset is not loaded');
must(entry,'src/features/lock-grace/index.js','Lock grace asset is not loaded');
must(entry,'src/features/lock-grace/operator-inbox.js','Grace decision inbox is not loaded');
if(entry.indexOf('src/features/local-voice-agent/english-only.js')<=entry.indexOf('src/features/local-voice-agent/index.js')) fail.push('English-only overlay must load after the retained multilingual foundation');

for(const marker of ['Live Allocation Advisor','English live guidance',"c.language='en-US'",'BROWSER VOICE • READY']) must(englishVoice,marker,'English advisor consistency missing '+marker);
for(const marker of ['English only for this release','Never answer in Arabic','_transcribe_english','_run_agent_english']) must(server67,marker,'English runtime consistency missing '+marker);

for(const marker of ['shortMinutes:15','extendedHours:24','Short Handoff Grace','24h Extended Grace','Online buyer extension','Sales Center paperwork exception']) must(grace,marker,'Grace consistency missing '+marker);
for(const marker of ['GRACE DECISION INBOX','Approve 24h Extension','Grant 24h Paperwork Exception']) must(graceInbox,marker,'Grace inbox consistency missing '+marker);

for(const marker of ['English-only in 6.7','Short Handoff Grace','24h Extended Grace','LOCAL AI • CONNECTED','BROWSER VOICE • READY']) must(presentation,marker,'Presentation 6.7 missing '+marker);
mustNot(presentation,'LOCAL AI • متصل','6.7 presentation runbook must not use the old Arabic connection label');

for(const marker of ['Presentation/demo status: READY','21/21 browser tests passing','Known non-blocking demo limitations']) must(finalReview,marker,'Final review missing '+marker);

must(releaseValidator,'active English allocation advisor contract','Release validator output must describe the active English contract');
mustNot(releaseValidator,'bilingual AI advisor contract','Release validator still reports the retired active bilingual contract');

if(fail.length){
  console.error('PRENEURA 6.7 final consistency validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}
console.log('PRENEURA 6.7 final consistency validation passed');
console.log('- active buyer-facing voice contract is English-only');
console.log('- two-stage unit-lock grace and Transaction Operator authority are documented');
console.log('- presentation runbook matches the current UI labels and workflow');
console.log('- release/foundation validators no longer mislabel the active voice experience');
console.log('- final review and published release documentation are aligned');
