import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/core/product-model.js','utf8');
const sandbox={
  window:{},
  RT_ROLE_CONFIG:{},
  labels:{}
};
sandbox.window.window=sandbox.window;
sandbox.window.RT_ROLE_CONFIG=sandbox.RT_ROLE_CONFIG;
sandbox.window.labels=sandbox.labels;
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'product-model.js'});

const p=sandbox.window.PRENEURA;
if(!p?.model) throw new Error('PRENEURA.model was not created');

const expectedRoles=['buyer','registrar','operator','finance','broker','manager'];
const actualRoles=Object.keys(p.model.roles);
if(JSON.stringify(actualRoles)!==JSON.stringify(expectedRoles)){
  throw new Error('Role contract mismatch: '+actualRoles.join(', '));
}

const a=p.model.allocation;
if(a.queuePolicy!=='ONE_SHARED_QUEUE') throw new Error('Queue policy must remain ONE_SHARED_QUEUE');
if(a.priorityPolicy!=='SAME_PRIORITY_ENGINE') throw new Error('Priority policy must remain SAME_PRIORITY_ENGINE');
if(a.attendanceDoesNotChangePriority!==true) throw new Error('Attendance must not change queue priority');

const d233=a.demoBuyers.find(x=>x.token===233);
const d234=a.demoBuyers.find(x=>x.token===234);
if(!d233||d233.attendanceMode!=='SALES_CENTER') throw new Error('#233 must be the offline / Sales Center demo buyer');
if(!d234||d234.attendanceMode!=='ONLINE') throw new Error('#234 must be the online demo buyer');
if(a.assistance.ONLINE!=='AI Allocation Advisor') throw new Error('Online assistance must be AI Allocation Advisor');
if(a.assistance.SALES_CENTER!=='Human Allocator') throw new Error('Sales Center assistance must be Human Allocator');

const stable=fs.readFileSync('app/index.html','utf8');
const routePages=[];
for(const stage of p.model.flow.stages){
  if(stage.page)routePages.push(stage.page);
  for(const r of stage.routes||[]) if(r.page)routePages.push(r.page);
  for(const r of stage.subroutes||[]) if(r.page)routePages.push(r.page);
}
for(const page of new Set(routePages)){
  if(!stable.includes("'"+page+"'")&&!stable.includes('"'+page+'"')){
    throw new Error('Product model points to missing page: '+page);
  }
}

const irreversible=p.model.permissions.irreversible;
for(const key of ['unitLock','paymentConfirmation','finalContractSignature']){
  if(!irreversible[key]) throw new Error('Missing irreversible-action policy: '+key);
}

console.log('PRENEURA product model validated');
console.log('- 6 roles');
console.log('- one shared queue / one priority engine');
console.log('- #233 offline / #234 online demo');
console.log('- AI online / Human Allocator offline');
console.log('- '+new Set(routePages).size+' routed pages exist');
