import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const entry=read('index.html');
const voice=read('src/features/local-voice-agent/english-only.js');
const voiceCss=read('src/features/local-voice-agent/english-only.css');
const server=read('local_voice_agent/server67.py');
const grace=read('src/features/lock-grace/index.js');
const graceInbox=read('src/features/lock-grace/operator-inbox.js');
const graceCss=read('src/features/lock-grace/index.css');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||`Missing ${needle}`)}
function mustNot(text,needle,label){if(text.includes(needle))fail.push(label||`Unexpected ${needle}`)}

for(const asset of [
  'src/features/local-voice-agent/english-only.css',
  'src/features/local-voice-agent/english-only.js',
  'src/features/lock-grace/index.css',
  'src/features/lock-grace/index.js',
  'src/features/lock-grace/operator-inbox.js'
]) must(entry,asset,'Root entry does not load '+asset);

for(const marker of ['Live Allocation Advisor','English live guidance','Best available now','Master Plan','Final lock and signing stay under your control','language=\'en-US\'']) must(voice,marker,'English advisor missing '+marker);
for(const marker of ['English only for this release','Never answer in Arabic','Systran/faster-whisper-large-v3-turbo','_transcribe_english','24h Extended Grace','_run_agent_english']) must(server,marker,'English local runtime missing '+marker);
must(voiceCss,'.p621-agent{display:none!important}','Legacy Arabic advisor must be hidden in 6.7');
mustNot(voice,'new MutationObserver','English voice override must not add a broad MutationObserver');

for(const marker of [
  'shortMinutes:15','extendedHours:24','SHORT_ACTIVE','EXTENSION_REQUESTED','EXTENDED_24H',
  'Short Handoff Grace','24h Extended Grace','Online buyer extension','Sales Center paperwork exception',
  'p67RequestExtendedGrace','p67ApproveExtendedGrace','p67GrantPaperworkException','p67CompleteGrace','p67ReleaseGraceLock',
  'UNIT_LOCK_24H_EXTENSION_APPROVED','UNIT_LOCK_24H_PAPERWORK_EXCEPTION_GRANTED','UNIT_LOCK_EXTENSION_REQUEST_PENDING_AFTER_SHORT_GRACE'
]) must(grace,marker,'Grace workflow missing '+marker);
for(const page of ['b-unit','b-paymentdocs','b-contract','a-desk','a-handoff','t-inbox','t-readiness','m-allocation-live']) must(grace,"'"+page+"'",'Grace visibility missing page '+page);
for(const marker of ['GRACE DECISION INBOX','Short Handoff Grace','24h Extended Grace','p67ApprovePendingGrace','p67RejectPendingGrace','p67GrantOfflineGraceById','EXTENSION_REQUESTED','t-inbox','t-readiness']) must(graceInbox,marker,'Transaction Operator grace inbox missing '+marker);
for(const marker of ['.p67g-time','.p67g-policy-grid','.p67g-policy']) must(graceCss,marker,'Grace presentation styling missing '+marker);
mustNot(grace,'new MutationObserver','Grace workflow must not add a broad MutationObserver');
mustNot(graceInbox,'new MutationObserver','Grace inbox must not add a broad MutationObserver');

if(fail.length){
  console.error('PRENEURA 6.7 English voice / grace validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}
console.log('PRENEURA 6.7 English voice / lock grace validated');
console.log('- live allocation advisor is English-only at the active presentation layer');
console.log('- English ASR hint and server-side English response guard are configured');
console.log('- exact-unit lock starts with a visible Short Handoff Grace');
console.log('- Online buyer can request 24h Extended Grace; Transaction Operator must approve');
console.log('- Sales Center paperwork exception can be granted only by Transaction Operations');
console.log('- pending Online requests survive short-grace expiry until Transaction Operations decides them');
console.log('- shared Transaction Operator grace inbox survives transaction/page context changes');
console.log('- manager / buyer / allocator / transaction surfaces expose both grace stages and policy');
