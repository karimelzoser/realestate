/* PRENEURA 6.6 — professional presentation mode, deterministic scenarios and executive drill-down. */
(function(){
  'use strict';
  if(typeof app==='undefined'||typeof P==='undefined')return;
  var PRE=window.PRENEURA=window.PRENEURA||{};
  var X=app.fx.presentation66=app.fx.presentation66||{activeScenario:'baseline',lastApplied:null};
  function E(v){try{return typeof fxEsc==='function'?fxEsc(v):String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})}catch(_){return String(v==null?'':v)}}
  function T(v){try{if(typeof toast==='function')toast(v)}catch(_){}}
  function R(){try{if(typeof render==='function')render()}catch(_){}}
  function money(v){try{return typeof euro==='function'?euro(Number(v)||0):(Number(v)||0).toLocaleString('en-US')+' EGP'}catch(_){return (Number(v)||0).toLocaleString('en-US')+' EGP'}}
  function clone(v){try{return typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v))}catch(_){return JSON.parse(JSON.stringify(v||null))}}
  function arr(v){return Array.isArray(v)?v:[]}
  function units(){try{return typeof UNITS!=='undefined'?UNITS:[]}catch(_){return []}}
  function queue(){app.fx.queue=app.fx.queue||{};app.fx.queue.waiting=arr(app.fx.queue.waiting);return app.fx.queue.waiting}
  function stations(){app.fx.queue=app.fx.queue||{};app.fx.queue.stations=arr(app.fx.queue.stations);return app.fx.queue.stations}
  function registry(){app.fx.rt=app.fx.rt||{};app.fx.rt.registry=arr(app.fx.rt.registry);return app.fx.rt.registry}
  function audit(){app.fx.audit=arr(app.fx.audit);return app.fx.audit}
  function final6(){app.fx.final6=app.fx.final6||{};return app.fx.final6}
  function props(){var f=final6();f.buyerProperties=arr(f.buyerProperties);return f.buyerProperties}
  function installments(){var f=final6();f.installments=arr(f.installments);return f.installments}
  function brokers(){var f=final6();f.brokerCompanies=arr(f.brokerCompanies);return f.brokerCompanies}
  function brokerData(){app.fx.broker=app.fx.broker||{};app.fx.broker.buyers=arr(app.fx.broker.buyers);app.fx.broker.eois=arr(app.fx.broker.eois);app.fx.broker.commissions=arr(app.fx.broker.commissions);return app.fx.broker}
  function replaceArray(target,source){target.splice(0,target.length);clone(source||[]).forEach(function(x){target.push(x)})}

  var baseline={
    queue:clone(queue()),stations:clone(stations()),registry:clone(registry()),audit:clone(audit()),
    properties:clone(props()),installments:clone(installments()),brokers:clone(brokers()),broker:clone(brokerData()),
    unitStates:units().map(function(u){return {id:u.id,status:u.status,price:u.price}})
  };

  function restoreBaseline(){
    replaceArray(queue(),baseline.queue);replaceArray(stations(),baseline.stations);replaceArray(registry(),baseline.registry);replaceArray(audit(),baseline.audit);
    replaceArray(props(),baseline.properties);replaceArray(installments(),baseline.installments);replaceArray(brokers(),baseline.brokers);
    var bd=brokerData();replaceArray(bd.buyers,baseline.broker&&baseline.broker.buyers);replaceArray(bd.eois,baseline.broker&&baseline.broker.eois);replaceArray(bd.commissions,baseline.broker&&baseline.broker.commissions);
    baseline.unitStates.forEach(function(s){var u=units().find(function(x){return Number(x.id)===Number(s.id)});if(u){u.status=s.status;u.price=s.price}});
    X.activeScenario='baseline';X.lastApplied=new Date().toISOString();
  }
  function ensureBuyer(o){var r=registry().find(function(x){return x.customerId===o.customerId});if(!r){r={customerId:o.customerId};registry().push(r)}Object.assign(r,{name:o.name,phone:o.phone||'+2010'+String(o.token||1).padStart(8,'0'),eoi:o.eoi||('EOI-'+o.token),eoiState:'ELIGIBLE',eoiPaid:true,docs:'VERIFIED',eligible:o.eligible||['R2-STD','R3-MID'],allocationEntered:true,attendanceMode:o.attendanceMode||'ONLINE',priorityTier:o.priorityTier||'A',source:o.source||'Buyer Direct',__p66:true});return r}
  function ensureQueue(o){var q=queue().find(function(x){return Number(x.token)===Number(o.token)});if(!q){q={token:o.token};queue().push(q)}Object.assign(q,{buyer:o.name,customerId:o.customerId,eoi:o.eoi||('EOI-'+o.token),eligible:o.eligible||['R2-STD','R3-MID'],preferred:o.preferred||['R2-STD'],state:o.state||'WAITING',attendanceMode:o.attendanceMode||'ONLINE',priorityTier:o.priorityTier||'A',registeredAt:o.registeredAt||new Date().toISOString(),__p66:true});return q}
  function event(type,buyer,role,user,ref,detail,minutesAgo){audit().push({type:type,buyer:buyer.name,buyerId:buyer.customerId,role:role,user:user,actor:user,ref:ref||buyer.customerId,detail:detail||'',at:new Date(Date.now()-(minutesAgo||0)*60000).toISOString(),step:type.replaceAll('_',' '),__p66:true})}
  function makeBuyer(i,opts){opts=opts||{};var token=opts.token||260+i,online=opts.online!=null?opts.online:i%2===0;return {token:token,customerId:'PR66-'+token,name:opts.name||['Ahmed Samir','Mariam Adel','Omar Khaled','Youssef Nabil','Dina Mostafa','Karim Tarek','Salma Hany','Hassan Wael','Nour Ali','Mahmoud Fathy','Farah Emad','Mostafa Nasser'][i%12],attendanceMode:online?'ONLINE':'SALES_CENTER',priorityTier:i<3?'A':'B',source:opts.source|| (i%4===0?'Broker':'Buyer Direct')}}
  function seedNormal(){
    restoreBaseline();var names=['Ahmed Samir','Mariam Adel','Omar Khaled','Dina Mostafa','Hassan Wael'];
    names.forEach(function(n,i){var b=makeBuyer(i,{token:233+i,name:n,online:i%2===1}),r=ensureBuyer(b),q=ensureQueue(Object.assign({},b,{state:i===0?'CALLED':i===1?'IN_ALLOCATION':'WAITING',registeredAt:new Date(Date.now()-(6+i*4)*60000).toISOString()}));event('QUEUE_TOKEN_ISSUED',r,'Queue Receptionist','Mariam Hassan','#'+q.token,'Eligible buyer joined the shared allocation queue.',6+i*4)});
    X.activeScenario='normal';X.lastApplied=new Date().toISOString();
  }
  function seedQueuePressure(){
    restoreBaseline();for(var i=0;i<12;i++){var b=makeBuyer(i,{token:270+i}),r=ensureBuyer(b),state=i<2?'CALLED':i===2?'CALL_GRACE':'WAITING',q=ensureQueue(Object.assign({},b,{state:state,registeredAt:new Date(Date.now()-(7+i*4)*60000).toISOString()}));event('QUEUE_TOKEN_ISSUED',r,'Queue Receptionist','Mariam Hassan','#'+q.token,'Buyer checked in and joined the shared queue with priority '+q.priorityTier+'.',7+i*4)}
    var off=queue().filter(function(q){return q.__p66&&String(q.attendanceMode).toUpperCase()!=='ONLINE'}),ss=stations();ss.forEach(function(s,i){if(i<Math.min(off.length,ss.length)){Object.assign(s,{token:off[i].token,buyer:off[i].buyer,state:'SELECTION_ACTIVE',attendanceMode:'SALES_CENTER',unit:null});off[i].state='CALLED'}else if(s.__p66){Object.assign(s,{token:null,buyer:null,state:'FREE',unit:null})}});
    X.activeScenario='queue';X.lastApplied=new Date().toISOString();
  }
  function seedConflict(){
    seedNormal();var us=units().filter(function(u){return String(u.status||'').toLowerCase()==='available'}),u=us[0]||units()[0];if(u)u.status='hold';
    var a=ensureBuyer(makeBuyer(8,{token:288,name:'Nour Ali',online:true})),b=ensureBuyer(makeBuyer(9,{token:289,name:'Mahmoud Fathy',online:false}));ensureQueue(Object.assign({},makeBuyer(8,{token:288,name:a.name,online:true}),{state:'IN_ALLOCATION',registeredAt:new Date(Date.now()-12*60000).toISOString()}));ensureQueue(Object.assign({},makeBuyer(9,{token:289,name:b.name,online:false}),{state:'CALLED',registeredAt:new Date(Date.now()-10*60000).toISOString()}));event('UNIT_LOCK_ACQUIRED',a,'System','PRENEURA Lock Engine',u?'UNIT-'+u.id:'UNIT-DEMO','Exact unit lock acquired for '+a.name+'.',3);event('UNIT_LOCK_CONFLICT_REJECTED',b,'Allocator','Hany Ibrahim',u?'UNIT-'+u.id:'UNIT-DEMO','Second allocation attempt rejected because the physical unit is already locked.',1);X.activeScenario='conflict';
  }
  function seedOverdue(){
    seedNormal();var p=props().find(function(x){return x.__p66Overdue});if(!p){p={buyer:'Omar Khaled',customerId:'PR66-235',tx:'TX-PR66-235',unit:(units()[1]&&units()[1].id)||17,contract:'CTR-PR66-235',total:5800000,paid:2030000,status:'ACTIVE',__p66:true,__p66Overdue:true};props().push(p)}
    replaceArray(installments(),[
      {no:'Reservation',due:'2026-05-15',amount:1160000,paidAmount:1160000,status:'PAID'},
      {no:'Q1',due:'2026-07-01',amount:435000,paidAmount:435000,status:'PAID'},
      {no:'Q2',due:'2026-09-01',amount:435000,paidAmount:217500,status:'MISSED'},
      {no:'Q3',due:'2026-10-01',amount:435000,paidAmount:0,status:'MISSED'},
      {no:'Q4',due:'2027-01-01',amount:435000,paidAmount:0,status:'UPCOMING'}
    ]);var b=registry().find(function(x){return x.name==='Omar Khaled'})||ensureBuyer(makeBuyer(2,{token:235,name:'Omar Khaled'}));event('INSTALLMENT_OVERDUE',b,'System','PRENEURA Collections','CTR-PR66-235','Two installments require collection follow-up; partial Q2 payment is recorded.',0);X.activeScenario='overdue';
  }
  function seedBrokers(){
    seedNormal();var comps=brokers();if(!comps.some(function(c){return c.id==='BR-P66-1'})){comps.push({id:'BR-P66-1',name:'NorthGate Realty',admin:'Laila Ahmed',state:'ACTIVE',scope:['Project'],agents:[{id:'AG-P66-11',name:'Tarek Hassan',state:'ACTIVE'},{id:'AG-P66-12',name:'Mona Samy',state:'ACTIVE'}]},{id:'BR-P66-2',name:'Prime Keys',admin:'Omar Fadel',state:'ACTIVE',scope:['Project'],agents:[{id:'AG-P66-21',name:'Nadine Adel',state:'ACTIVE'},{id:'AG-P66-22',name:'Youssef Emad',state:'ACTIVE'}]})}
    var bd=brokerData(),names=['Broker Buyer 1','Broker Buyer 2','Broker Buyer 3','Broker Buyer 4','Broker Buyer 5','Broker Buyer 6','Broker Buyer 7'];names.forEach(function(name,i){var agent=i<4?'Tarek Hassan':i<6?'Mona Samy':'Nadine Adel';if(!bd.buyers.some(function(x){return x.name===name}))bd.buyers.push({name:name,agent:agent,agentId:agent==='Tarek Hassan'?'AG-P66-11':agent==='Mona Samy'?'AG-P66-12':'AG-P66-21'});if(!bd.eois.some(function(x){return x.buyer===name}))bd.eois.push({buyer:name,state:i===6?'DRAFT':'ELIGIBLE'});if(i<4&&!bd.commissions.some(function(x){return x.buyer===name}))bd.commissions.push({buyer:name,state:i<3?'APPROVED':'DUE',amount:85000+i*10000})});X.activeScenario='brokers';
  }
  function applyScenario(name){
    name=String(name||'normal');if(name==='baseline'){restoreBaseline();T('Presentation data reset to the clean baseline.');R();return}
    if(name==='normal')seedNormal();else if(name==='queue')seedQueuePressure();else if(name==='conflict')seedConflict();else if(name==='overdue')seedOverdue();else if(name==='brokers')seedBrokers();
    var target={normal:'m-home',queue:'m-allocation-live',conflict:'m-allocation-live',overdue:'m-home',brokers:'m-brokers'}[name]||'m-home';T('Presentation scenario ready: '+scenarioName(name));if(typeof go==='function')go(target);else R();
  }
  function scenarioName(n){return {baseline:'Clean baseline',normal:'Normal Allocation Day',queue:'High Queue Pressure',conflict:'Unit Lock Conflict',overdue:'Overdue Collections',brokers:'Broker Performance'}[n]||n}
  window.p66ApplyScenario=applyScenario;
  window.p66ResetDemo=function(){restoreBaseline();T('Presentation reset complete.');if(typeof go==='function')go('m-home');else R()};

  function queueStats(){var q=queue().filter(function(x){return !['COMPLETED','DONE','CANCELLED','CANCELED'].includes(String(x.state||'WAITING').toUpperCase())}),waits=q.map(function(x){var d=Date.parse(x.registeredAt||x.joinedAt||'');return isFinite(d)?Math.max(0,Math.floor((Date.now()-d)/60000)):0}),online=q.filter(function(x){return ['ONLINE','REMOTE','DIGITAL'].includes(String(x.attendanceMode||'').toUpperCase())}).length;return {active:q.length,online:online,offline:q.length-online,avg:waits.length?Math.round(waits.reduce(function(a,b){return a+b},0)/waits.length):0,longest:waits.length?Math.max.apply(null,waits):0}}
  function financeStats(){var rows=installments(),now=Date.now(),over=rows.filter(function(x){var paid=x.paidAmount!=null?Number(x.paidAmount):(String(x.status||'').toUpperCase()==='PAID'?Number(x.amount||0):0),left=Math.max(0,Number(x.amount||0)-paid),due=Date.parse(x.due||'');return left>0&&isFinite(due)&&due<now}),amount=over.reduce(function(a,x){var paid=x.paidAmount!=null?Number(x.paidAmount):(String(x.status||'').toUpperCase()==='PAID'?Number(x.amount||0):0);return a+Math.max(0,Number(x.amount||0)-paid)},0);return {count:over.length,amount:amount}}
  function inventoryStats(){var us=units(),locked=us.filter(function(u){return ['hold','held','reserved','booked','locked'].includes(String(u.status||'').toLowerCase())}),sold=us.filter(function(u){return ['sold','completed'].includes(String(u.status||'').toLowerCase())});return {total:us.length,locked:locked.length,sold:sold.length}}
  function presentationConsole(compact){var buttons=[['normal','Normal Day'],['queue','Queue Pressure'],['conflict','Unit Conflict'],['overdue','Overdue Collections'],['brokers','Broker Performance']];return '<section class="p66-console '+(compact?'compact':'')+'"><div class="p66-console-copy"><small>PRESENTATION CONTROL</small><b>'+E(scenarioName(X.activeScenario))+'</b><span>Switch to a prepared operating condition without leaving the product demo.</span></div><div class="p66-scenarios">'+buttons.map(function(x){return '<button class="'+(X.activeScenario===x[0]?'active':'')+'" onclick="p66ApplyScenario(\''+x[0]+'\')">'+x[1]+'</button>'}).join('')+'<button class="reset" onclick="p66ResetDemo()">Reset Demo</button></div></section>'}
  function decisionRoom(){var q=queueStats(),f=financeStats(),i=inventoryStats(),buyers=registry(),eligible=buyers.filter(function(b){return b.eoiPaid||b.eoiState==='ELIGIBLE'}).length,conv=buyers.length?Math.round(eligible/buyers.length*100):0;return '<section class="p66-decision"><div class="p66-decision-head"><div><small>MANAGEMENT DECISION ROOM</small><h3>What needs attention right now?</h3><p>Presentation KPIs are calculated from the same current demo state used by the operational pages.</p></div><span class="p66-status '+(q.avg>=15||f.count?'warn':'ok')+'">'+(q.avg>=15||f.count?'ATTENTION':'ON TRACK')+'</span></div><div class="p66-kpis"><button onclick="go(\'m-allocation-live\')"><strong>'+q.active+'</strong><span>Active queue</span><em>'+q.online+' online • '+q.offline+' Sales Center</em></button><button onclick="go(\'m-allocation-live\')"><strong>'+q.avg+'m</strong><span>Average wait</span><em>Longest '+q.longest+'m</em></button><button onclick="go(\'m-allocation-live\')"><strong>'+i.locked+'</strong><span>Units locked / reserved</span><em>'+i.sold+' sold of '+i.total+'</em></button><button onclick="go(\'m-buyer-control\')"><strong>'+conv+'%</strong><span>EOI ready rate</span><em>'+eligible+' of '+buyers.length+' buyers</em></button><button class="'+(f.count?'alert':'')+'" onclick="go(\'m-home\')"><strong>'+f.count+'</strong><span>Overdue installments</span><em>'+E(money(f.amount))+' outstanding</em></button><button onclick="go(\'m-brokers\')"><strong>'+brokers().length+'</strong><span>Broker companies</span><em>'+brokers().reduce(function(a,c){return a+arr(c.agents).length},0)+' agents</em></button></div><div class="p66-signals"><div class="'+(q.avg>=15?'warn':'good')+'"><b>Queue SLA</b><span>'+(q.avg>=15?'Average wait is above the 15-minute presentation threshold. Open Live Allocation to inspect the exact buyers causing pressure.':'Queue wait is currently within the presentation threshold.')+'</span></div><div class="'+(f.count?'bad':'good')+'"><b>Collections</b><span>'+(f.count?f.count+' installment(s) require follow-up for '+money(f.amount)+'.':'No overdue installment is visible in the current scenario.')+'</span></div><div class="'+(i.locked?'warn':'good')+'"><b>Inventory commitment</b><span>'+i.locked+' physical unit(s) are held / reserved / booked. Review locks before exposing more stock.</span></div></div></section>'}
  function wrap(id,fn){var page=P[id];if(!page||typeof page.render!=='function'||page.__p66Wrapped)return;var base=page.render;page.render=function(){var html=String(base.apply(this,arguments)||'');return fn(html)};page.__p66Wrapped=true}
  wrap('m-home',function(html){return '<div class="p66-shell">'+presentationConsole(false)+decisionRoom()+'</div>'+html});
  ['m-allocation-live','m-brokers','m-buyer-control','m-phases','m-project-data','m-sales-allocation'].forEach(function(id){wrap(id,function(html){return '<div class="p66-shell">'+presentationConsole(true)+'</div>'+html})});
  wrap('m-replay',function(html){html=html.replaceAll('RECORDED AUDIT','Recorded Event').replaceAll('CURRENT STATE','Current State Snapshot').replaceAll('recorded + authoritative current-state journey','recorded journey + current operational state').replaceAll('authoritative snapshots reconstructed','current operational snapshots reconstructed');return '<div class="p66-shell">'+presentationConsole(true)+'<div class="p66-audit-note"><b>How to read this journey</b><span><strong>Recorded Event</strong> = an action captured in the audit history. <strong>Current State Snapshot</strong> = what PRENEURA currently knows from the buyer, queue, transaction, documents, contract and property records.</span></div></div>'+html});

  PRE.presentation={state:X,applyScenario:applyScenario,reset:window.p66ResetDemo,decisionSnapshot:function(){return {queue:queueStats(),finance:financeStats(),inventory:inventoryStats(),scenario:X.activeScenario}}};
})();
