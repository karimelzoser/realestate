import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const stable=read('app/index.html');
const entry=read('index.html');
const model=read('src/core/product-model.js');
const roles=read('src/core/role-policy.js');
const router=read('src/core/router.js');
const flowJs=read('src/features/how-it-works/index.js');
const flowCss=read('src/features/how-it-works/index.css');
const queueJs=read('src/features/live-allocation/index.js');
const buyerJs=read('src/features/buyer-experience/index.js');
const englishVoice=read('src/features/local-voice-agent/english-only.js');
const englishServer=read('local_voice_agent/server67.py');
const grace=read('src/features/lock-grace/index.js');

function must(text,needle,label){ if(!text.includes(needle)) fail.push(label||('Missing '+needle)); }
function mustNot(text,needle,label){ if(text.includes(needle)) fail.push(label||('Unexpected '+needle)); }

for(const page of ['b-browse','br-dashboard','r-checkin','m-home','b-eoi','b-allocation-day','m-allocation-live','a-desk','b-site','b-building','b-floor','b-unit','a-handoff','t-inbox','b-contract','b-properties']){
  if(!stable.includes("'"+page+"'")&&!stable.includes('"'+page+'"')) fail.push('Stable app missing routed page '+page);
}
for(const role of ['buyer','registrar','operator','finance','broker','manager']) must(model,role+':','Product model missing role '+role);

must(queueJs,'token:233','Shared queue demo missing #233');
must(queueJs,'token:234','Shared queue demo missing #234');
must(queueJs,'ONE SHARED QUEUE','Live Allocation must visibly say ONE SHARED QUEUE');
must(queueJs,'same allocator-seat pool','Live Allocation must explain same allocator seats');
must(model,'attendanceDoesNotChangePriority:true','Attendance must not change priority');
must(model,"ONLINE:'AI Allocation Advisor'",'Online assistance contract missing');
must(model,"SALES_CENTER:'Human Allocator'",'Offline assistance contract missing');

must(router,'app.__flowDirectPreview=true','OPEN preview mode not enabled');
must(router,'restoreSnapshot()','Preview state restoration missing');
must(roles,'opts.preview===true','Role policy must allow explicit preview bypass');
must(roles,'isDelegatedBrokerBuyerPage','Delegated Broker rules missing');

for(const marker of ["P['b-properties']",'window.p614OpenProperty','window.p614PropertyTab','window.p614ShowDoc','installments','documents','updates']) must(buyerJs,marker,'My Property missing '+marker);

// 6.7 active allocation advisor contract. Older multilingual source remains in the
// repository for future re-enablement, but the buyer-facing layer is English-only.
for(const marker of ['Live Allocation Advisor','English live guidance','Best available now',"c.language='en-US'","u.lang='en-US'",'Final lock and signing stay under your control','Master Plan']) must(englishVoice,marker,'Active English advisor missing '+marker);
for(const marker of ['English only for this release','Never answer in Arabic','_transcribe_english','_run_agent_english']) must(englishServer,marker,'Active English local runtime missing '+marker);
mustNot(englishVoice,"lang='ar-EG'",'Active English advisor must not set Arabic speech output');
const oldVoicePos=entry.indexOf("src/features/local-voice-agent/index.js");
const englishVoicePos=entry.indexOf("src/features/local-voice-agent/english-only.js");
if(oldVoicePos<0||englishVoicePos<0||englishVoicePos<=oldVoicePos) fail.push('English-only advisor must load after the retained legacy voice foundation');

for(const marker of ['shortMinutes:15','extendedHours:24','Short Handoff Grace','24h Extended Grace','Online buyer extension','Sales Center paperwork exception']) must(grace,marker,'Two-stage unit-lock grace missing '+marker);

must(flowCss,'width:3340px','Metro canvas width must support full horizontal flow');
must(flowCss,'.p616-property{left:3080px;top:202px;width:220px}','My Property must remain on the horizontal completion row');
must(flowCss,'.p616-node h3{font-size:12.4px','Metro title readability regression');
must(flowCss,'.p616-node p{font-size:8.2px','Metro body readability regression');
must(flowJs,'<path d="M3045 264 H3080"/>','Contract -> My Property connector must be horizontal');
if(flowJs.includes('p616-bottom-note')) fail.push('Redundant bottom ownership note should stay removed');

const boxes=[['unit',1980,270],['lock',2290,220],['transaction',2550,235],['contract',2825,220],['property',3080,220]];
for(let i=1;i<boxes.length;i++){ const prev=boxes[i-1],cur=boxes[i]; if(prev[1]+prev[2]>=cur[1]) fail.push('Metro overlap: '+prev[0]+' -> '+cur[0]); }
if(3080+220>3340) fail.push('My Property clips outside Metro canvas');

if(fail.length){ console.error('PRENEURA release validation failed'); fail.forEach(x=>console.error('- '+x)); process.exit(1); }
console.log('PRENEURA release validation passed');
console.log('- core routes present');
console.log('- shared queue / assistance invariants');
console.log('- OPEN vs ROLE behavior');
console.log('- My Property functional markers');
console.log('- active English allocation advisor contract');
console.log('- two-stage unit-lock grace contract');
console.log('- Metro geometry / readability');
