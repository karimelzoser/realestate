import fs from 'node:fs';
import vm from 'node:vm';

const product=fs.readFileSync('src/core/product-model.js','utf8');
const policy=fs.readFileSync('src/core/role-policy.js','utf8');

const sandbox={
  console:{warn(){}},
  window:{},
  RT_ROLE_CONFIG:{
    buyer:{steps:[['b-browse','Explore'],['b-eoi','EOI'],['b-properties','Properties']]},
    registrar:{steps:[['r-checkin','Check-in']]},
    operator:{steps:[['a-desk','Assigned Buyer'],['a-handoff','Lock & Handoff']]},
    finance:{steps:[['t-inbox','Inbox'],['t-readiness','Readiness']]},
    broker:{steps:[['br-dashboard','Dashboard'],['br-delegated','Act for Buyer']]},
    manager:{steps:[['m-home','Overview'],['m-workflow','Workflow']]}
  },
  rolePages:{},
  labels:{},
  app:{role:'buyer',fx:{final6:{delegatedBuyer:null}}},
  toast(){}
};
sandbox.window.window=sandbox.window;
sandbox.window.RT_ROLE_CONFIG=sandbox.RT_ROLE_CONFIG;
sandbox.window.rolePages=sandbox.rolePages;
sandbox.window.labels=sandbox.labels;
sandbox.window.app=sandbox.app;
sandbox.window.toast=sandbox.toast;
sandbox.window.go=function(){return true};
sandbox.window.rtEnterRole=function(){return true};

vm.createContext(sandbox);
vm.runInContext(product,sandbox,{filename:'product-model.js'});
vm.runInContext(policy,sandbox,{filename:'role-policy.js'});

const rp=sandbox.window.PRENEURA.rolePolicy;
if(!rp) throw new Error('Role policy did not initialize');

const allow=[
  ['buyer','b-browse'],
  ['registrar','r-checkin'],
  ['operator','a-desk'],
  ['finance','t-inbox'],
  ['broker','br-dashboard'],
  ['manager','m-workflow']
];
for(const [role,page] of allow){
  if(!rp.canOpen(role,page,{preview:false})) throw new Error(role+' should be allowed to open '+page);
}

const deny=[
  ['buyer','m-home'],
  ['registrar','m-pricing'],
  ['operator','t-inbox'],
  ['finance','a-desk'],
  ['broker','m-home']
];
for(const [role,page] of deny){
  if(rp.canOpen(role,page,{preview:false})) throw new Error(role+' must not open '+page);
}

if(!rp.canOpen('buyer','m-home',{preview:true})) throw new Error('OPEN preview should bypass role navigation restrictions');

sandbox.app.fx.final6.delegatedBuyer='CUS-100';
if(!rp.canOpen('broker','b-eoi',{preview:false})) throw new Error('Broker delegated buyer context should allow EOI assistance page');

if(!rp.has('registrar','queue.issue')) throw new Error('Registrar must have queue.issue');
if(rp.has('registrar','governance.pricing')) throw new Error('Registrar must not have governance.pricing');

console.log('PRENEURA role policy validated');
console.log('- six role scopes');
console.log('- OPEN preview bypass preserved');
console.log('- ROLE restrictions enforced');
console.log('- delegated broker context supported');
