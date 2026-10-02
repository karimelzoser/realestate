import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/core/state.js','utf8');

const app={
  role:'buyer',
  page:'b-browse',
  fx:{
    queue:{waiting:[{token:233,buyer:'Mona Adel'}]},
    rt:{registry:[{customerId:'CUS-1',name:'Demo Buyer'}]},
    final6:{
      buyerSession:{customerId:'CUS-1',loggedIn:true},
      buyerProperties:[{unit:17}],
      installments:[{no:'Q1'}]
    },
    transaction:{id:'TX-1'},
    contract:{id:'CTR-1'},
    p59:{physicalSeats:10,onlineSlots:3,callGraceMinutes:10}
  }
};
const P={'b-browse':{id:'b-browse'}};
const UNITS=[{id:17,status:'available'}];
const RT_ROLE_CONFIG={buyer:{steps:[['b-browse','Explore']]}};

const sandbox={window:{},app,P,UNITS,RT_ROLE_CONFIG,console};
sandbox.window.window=sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'state.js'});

const s=sandbox.window.PRENEURA?.state;
if(!s) throw new Error('State facade did not initialize');
if(s.app()!==app) throw new Error('App reference mismatch');
if(s.pages()!==P) throw new Error('Page registry mismatch');
if(s.unitById(17)!==UNITS[0]) throw new Error('Unit lookup failed');
if(s.queueWaiting()[0].token!==233) throw new Error('Queue access failed');
if(s.currentBuyer()?.customerId!=='CUS-1') throw new Error('Current buyer lookup failed');
if(s.transaction()?.id!=='TX-1') throw new Error('Transaction access failed');
if(s.contract()?.id!=='CTR-1') throw new Error('Contract access failed');
if(s.properties().length!==1) throw new Error('Property access failed');
if(s.installments().length!==1) throw new Error('Installment access failed');
if(s.allocationConfig().physicalSeats!==10||s.allocationConfig().onlineSlots!==3) throw new Error('Allocation config failed');

let eventValue=0;
const off=s.on('demo',v=>{eventValue=v});
s.emit('demo',7);
off();
if(eventValue!==7) throw new Error('State event bus failed');

const snap=s.snapshot();
if(snap.role!=='buyer'||snap.queue.length!==1||snap.buyer.customerId!=='CUS-1') throw new Error('Snapshot failed');

console.log('PRENEURA state facade validated');
console.log('- app / pages / units');
console.log('- queue / buyer / transaction / contract');
console.log('- properties / installments / allocation config');
console.log('- event subscription');
