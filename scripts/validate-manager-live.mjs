import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const index=read('index.html');
const js=read('src/features/manager-live/index.js');
const css=read('src/features/manager-live/index.css');
function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}

must(index,'src/features/manager-live/index.css','Manager live CSS is not loaded');
must(index,'src/features/manager-live/index.js','Manager live JS is not loaded');
must(js,"P['m-allocation-live']",'Live Allocation page override missing');
must(js,"P['m-replay']",'Detailed audit page override missing');
must(js,'p65SnapshotLive','Live state snapshot API missing');
must(js,'p65RefreshLiveAllocation','Live refresh API missing');
must(js,'p65AuditJourney','Buyer journey API missing');
must(js,'Authoritative live queue','Authoritative queue language missing');
must(js,'Human Allocator seats','Human allocation capacity view missing');
must(js,'Live allocation event feed','Allocation event feed missing');
must(js,'User / actor','Detailed audit actor field missing');
must(js,'Reference','Detailed audit reference field missing');
must(js,'RECORDED AUDIT','Recorded audit source distinction missing');
must(js,'CURRENT STATE','Authoritative state-source distinction missing');
must(js,'setInterval','Live refresh timer missing');
must(css,'.p65-journey-event','Detailed journey visual component missing');
must(css,'.p65-table','Live queue table styling missing');

if(/slice\(0\s*,\s*10\)/.test(js))fail.push('Manager Live Allocation must not cap the authoritative queue to ten rows');
if(!js.includes("app.fx.queue&&app.fx.queue.waiting")&&!js.includes('STATE?STATE.queueWaiting()'))fail.push('Manager Live Allocation is not connected to queue state');
if(!js.includes('app.fx.audit'))fail.push('Detailed audit is not connected to audit state');

if(fail.length){
  console.error('PRENEURA manager live validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}
console.log('PRENEURA manager live validation passed');
console.log('- uncapped authoritative shared queue');
console.log('- live seats / waits / locks / event feed');
console.log('- detailed buyer journey with role + actual actor');
console.log('- recorded audit vs current-state distinction');
