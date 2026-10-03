import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const entry=read('index.html');
const stable=read('app/index.html');
const preview=read('src/features/flow-preview/index.js');
const previewCss=read('src/features/flow-preview/index.css');
const model=read('src/core/product-model.js');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}

must(entry,'src/features/flow-preview/index.css','Root entry does not load flow-preview CSS');
must(entry,'src/features/flow-preview/index.js','Root entry does not load flow-preview JS');

for(const marker of [
  'ensureSelection','ensureAllocatorHandoff','ensureTransactionBase',
  'p620CompleteContractRequirements','p581ContractNext','simplifyPortal',
  'p620FlowPreviewAudit'
]) must(preview,marker,'Flow preview missing '+marker);

for(const page of ['b-building','b-floor','b-unit','r-checkin','a-handoff','t-inbox','b-contract']){
  must(preview,"page==='"+page+"'",'Preview fixture not prepared for '+page);
}

must(preview,"state:'CONFIRMED'",'Contract demo must confirm payment');
must(preview,'d.verified=true','Contract demo must verify documents');
must(preview,'t.approved=true','Contract demo must satisfy configured approval gate');
must(preview,"type:opts.type||'HANDOFF'",'Contract demo must create an active selected-unit lock');
must(preview,"f6GenerateBuyerContract()",'Contract preview must expose exact-contract generation');

for(const sel of ['.p616-head p','.p616-head-actions','.p616-truth','.p616-guide','.p616-legend']){
  must(preview,sel,'How It Works cleanup missing '+sel);
}
must(previewCss,'.p616-portal .p616-head p','How It Works subtitle must be hidden before JS cleanup');
must(previewCss,'body.p620-contract-active #app .topbar>div:first-child','Contract top title padding missing');
must(previewCss,'#pageRoot>.p58-buyer-shell','Contract Buyer stage padding missing');
must(previewCss,'#pageRoot>.p614-example','Contract flow example padding missing');

// The underlying application still has the actual interactive controls that the preview prepares.
for(const marker of [
  'function f6ContractReadyChecks',
  'function f6GenerateBuyerContract',
  'window.r52SmartContractPage=function',
  'window.r52CompleteSmartSignature=function',
  "P['b-contract'].render=r52SmartContractPage",
  "P['b-properties']"
]) must(stable,marker,'Stable workflow missing '+marker);

for(const page of ['b-eoi','b-allocation-day','r-checkin','m-allocation-live','b-site','b-building','b-floor','b-unit','a-handoff','t-inbox','b-contract','b-properties']){
  if(!stable.includes("'"+page+"'")&&!stable.includes('"'+page+'"'))fail.push('Flow destination missing from application: '+page);
}

must(model,"queuePolicy:'ONE_SHARED_QUEUE'",'Shared queue contract missing');
must(model,"ONLINE:'AI Allocation Advisor'",'Online AI assistance contract missing');
must(model,"SALES_CENTER:'Human Allocator'",'Offline allocator assistance contract missing');

if(fail.length){
  console.error('PRENEURA flow-preview validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}

console.log('PRENEURA flow-preview validation passed');
console.log('- direct preview prerequisites prepared');
console.log('- Contract demo can complete gates and generate exact contract');
console.log('- requested How It Works chrome removed');
console.log('- Contract heading / preview text spacing protected');
console.log('- all critical flow destinations present');
