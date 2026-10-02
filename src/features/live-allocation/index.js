// extracted from rev607-horizontal-scroll-flow-script
(function(){
 if(typeof app==='undefined'||typeof P==='undefined'||typeof rtEnterRole==='undefined')return;
 var PRODUCT=window.PRENEURA&&window.PRENEURA.model?window.PRENEURA.model:null;
 var ALLOCATION=PRODUCT&&PRODUCT.allocation?PRODUCT.allocation:null;
 function tags(items){return items&&items.length?'<div class="p607-mini">'+items.map(function(x){return '<span>'+x+'</span>';}).join('')+'</div>':'';}
 function openPage(role,page){
   if(typeof p604OpenPage==='function'){p604OpenPage(role,page);return;}
   if(!P[page]){if(typeof toast==='function')toast('This page is not available');return;}
   document.getElementById('rolePortal')?.remove();app.role=role;app.page=page;if(typeof go==='function')go(page);else if(typeof render==='function')render();
 }
 window.p607OpenPage=openPage;
 function ensureAllocationDemo(){
   if(!app.fx||!app.fx.queue||!Array.isArray(app.fx.queue.waiting))return;
   var q=app.fx.queue.waiting;
   function add(token,name,mode,offset){
     var t=q.find(function(x){return Number(x.token)===token});
     if(!t){t={token:token,buyer:name,customerId:'P607-'+token,eoi:'ELIGIBLE',eligible:['R2-STD','R3-MID'],preferred:['R2-STD'],state:'WAITING',attendanceMode:mode,priorityTier:'A',registeredAt:new Date(Date.now()-offset*60000).toISOString()};q.push(t)}
     else{t.attendanceMode=mode;t.priorityTier=t.priorityTier||'A';t.registeredAt=t.registeredAt||new Date(Date.now()-offset*60000).toISOString()}
   }
   var demos=ALLOCATION&&Array.isArray(ALLOCATION.demoBuyers)?ALLOCATION.demoBuyers:[
     {token:233,name:'Mona Adel',attendanceMode:'SALES_CENTER'},
     {token:234,name:'Youssef Nabil',attendanceMode:'ONLINE'}
   ];
   demos.forEach(function(d,i){add(Number(d.token),d.name,d.attendanceMode,96-i)});
   if(app.fx.rt&&Array.isArray(app.fx.rt.registry)){
     if(!app.fx.rt.registry.some(function(r){return r.customerId==='P607-233'}))app.fx.rt.registry.push({customerId:'P607-233',name:'Mona Adel',nationalId:'29601011223344',phone:'+201000000233',eoi:'EOI-233',eoiState:'ELIGIBLE',eoiPaid:true,docs:'VERIFIED',eligible:['R2-STD','R3-MID'],allocationEntered:true,attendanceMode:'SALES_CENTER',priorityTier:'A'});
     if(!app.fx.rt.registry.some(function(r){return r.customerId==='P607-234'}))app.fx.rt.registry.push({customerId:'P607-234',name:'Youssef Nabil',nationalId:'29601011223444',phone:'+201000000234',eoi:'EOI-234',eoiState:'ELIGIBLE',eoiPaid:true,docs:'VERIFIED',eligible:['R2-STD','R3-MID'],allocationEntered:true,attendanceMode:'ONLINE',priorityTier:'A'});
   }
 }
 ensureAllocationDemo();
 function orderedDemoQueue(){
   ensureAllocationDemo();
   return (app.fx.queue.waiting||[]).filter(function(t){return ['WAITING','CALLED','CALL_GRACE','IN_ALLOCATION'].includes(t.state)}).slice().sort(function(a,b){var at=String(a.registeredAt||''),bt=String(b.registeredAt||'');return at.localeCompare(bt)||Number(a.token)-Number(b.token)});
 }
 function allocationDayPage(){
   ensureAllocationDemo();
   var capacity=ALLOCATION&&ALLOCATION.defaultCapacity?ALLOCATION.defaultCapacity:{salesCenterSeats:10,onlineSlots:3};
   var q=orderedDemoQueue(),preview=q.slice(0,10),seats=(app.fx.queue&&app.fx.queue.stations?app.fx.queue.stations:[]).slice(0,capacity.salesCenterSeats);
   while(seats.length<capacity.salesCenterSeats)seats.push({id:'S'+String(seats.length+1).padStart(2,'0'),name:'Allocator '+String(seats.length+1).padStart(2,'0'),token:null,buyer:null,state:'FREE'});
   var demo233=q.find(function(x){return Number(x.token)===233}),demo234=q.find(function(x){return Number(x.token)===234});
   return '<div class="p607-live">'+
     '<section class="p607-live-head"><div class="p607-live-card"><small style="font-size:7px;font-weight:950;color:#235fde;letter-spacing:.12em">LIVE ALLOCATION DAY</small><h3>One shared queue. One allocator pool.</h3><p>Online and Sales Center attendance are service modes only. They do not create separate priority lists. Buyers stay in one ordered queue and are assigned to the same allocator-seat pool when their turn arrives.</p></div><div class="p607-live-rule"><b>Demo rule</b><br>#233 is OFFLINE / Sales Center and #234 is ONLINE. They remain consecutive in the same queue and both feed the same allocator seats.</div></section>'+
     '<section class="p607-live-card"><h4>Two buyers, different attendance, one queue</h4><div class="p607-queue-demo"><div class="p607-token offline"><strong>#233</strong><span>Mona Adel</span><span class="p607-mode offline">OFFLINE / SALES CENTER</span></div><div class="p607-token online"><strong>#234</strong><span>Youssef Nabil</span><span class="p607-mode online">ONLINE</span></div></div><div class="p607-shared-arrow">↓</div><div class="p607-shared-queue"><h4>ONE SHARED QUEUE</h4><p>#233 stays before #234 because queue order is shared. Attendance changes how the buyer connects, not queue priority.</p><table class="p607-queue-table"><tr><th>Queue</th><th>Buyer</th><th>Attendance</th><th>Priority</th><th>Status</th></tr>'+preview.map(function(t){var mode=String(t.attendanceMode||'SALES_CENTER').toUpperCase()==='ONLINE'?'online':'offline';return '<tr><td><b>#'+t.token+'</b></td><td>'+String(t.buyer||'Buyer')+'</td><td><span class="p607-mode '+mode+'">'+(mode==='online'?'ONLINE':'OFFLINE / SALES CENTER')+'</span></td><td>'+String(t.priorityTier||'A')+'</td><td>'+String(t.state||'WAITING').replaceAll('_',' ')+'</td></tr>'}).join('')+'</table></div></section>'+
     '<section class="p607-live-card"><h4>Same allocator seats</h4><p>The next eligible buyer—online or offline—is routed to the next available allocator seat. The seat serves the buyer in the appropriate communication mode while working on the same inventory and transaction record.</p><div class="p607-flow-explain"><div><b>#233 OFFLINE</b><span>Sales Center connection</span></div><i>→</i><div><b>SHARED QUEUE</b><span>Same order and priority</span></div><i>→</i><div><b>ALLOCATOR SEATS</b><span>Same allocator pool for both channels</span></div></div><div class="p607-flow-explain" style="margin-top:8px"><div><b>#234 ONLINE</b><span>Remote connection</span></div><i>→</i><div><b>SHARED QUEUE</b><span>Immediately after #233</span></div><i>→</i><div><b>ALLOCATOR SEATS</b><span>Same allocator pool for both channels</span></div></div><div class="p607-seat-board">'+seats.map(function(s,i){var sample=i===0?demo233:i===1?demo234:null;return '<div class="p607-seat '+(sample?'busy':'')+'"><b>Allocator Seat '+String(i+1).padStart(2,'0')+'</b><span>'+(sample?('#'+sample.token+' • '+sample.buyer):'Available')+'</span>'+(sample?'<span class="att">'+(String(sample.attendanceMode).toUpperCase()==='ONLINE'?'ONLINE':'OFFLINE / SALES CENTER')+'</span>':'')+'</div>'}).join('')+'</div></section>'+
     '<section class="p607-live-card"><h4>What happens next</h4><p>When the buyer reaches an allocator seat, the Allocator opens Exact Unit Selection → Master Plan → Building → Floor → Exact Unit → Unit Lock. The buyer then moves to the Transaction Operator for payment, documents, contract and signing.</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" onclick="p607OpenPage(\'buyer\',\'b-queue\')">Open Buyer Queue</button><button class="btn" onclick="p607OpenPage(\'registrar\',\'r-checkin\')">Open Queue Reception</button><button class="btn primary" onclick="rtEnterRole(\'operator\')">Open Allocator Role</button></div></section>'+
   '</div>';
 }
 if(P['m-allocation-live']){
   P['m-allocation-live'].title='Live Allocation Day';
   P['m-allocation-live'].nav='Live Allocation Day';
   P['m-allocation-live'].guide='One shared queue for online and offline buyers feeding the same allocator-seat pool.';
   P['m-allocation-live'].render=allocationDayPage;
 }
 window.rtBuildRolePortal=function(){
   ensureAllocationDemo();
   var old=document.getElementById('rolePortal');if(old)old.remove();
   var seats=10;
   var launch=(app.fx&&app.fx.launch&&app.fx.launch.id)||'DEMO EVENT',phase=(app.fx&&app.fx.launch&&app.fx.launch.phase)||'ACTIVE PHASE';
   var el=document.createElement('div');el.id='rolePortal';
   el.innerHTML=''+
   '<div class="p607-portal"><div class="p607-shell">'+
    '<header class="p607-head"><div><small>SYSTEM OVERVIEW</small><h1>How PRENEURA Works</h1><p>Three entry channels merge into one buyer record, split only by attendance, merge back into one shared queue, then continue through the same allocator seats, exact-unit reservation, transaction completion and signing.</p></div><div class="p607-actions"><span class="p607-chip">'+launch+'</span><span class="p607-chip">'+phase+'</span><span class="p607-chip live">● SHARED REALTIME STATE</span><button onclick="showProjectHomepage()">Project home</button></div></header>'+
    '<div class="p607-truth"><i></i><b>ONE SHARED SOURCE OF TRUTH</b><span>Buyer • EOI • Queue • Exact Unit • Payment • Contract • Audit</span></div>'+
    '<section class="p607-manager"><div class="p607-manager-main" onclick="rtEnterRole(\'manager\')" title="Open Manager role"><b>MANAGER CONTROL →</b><span>Open Manager role home</span></div><div class="p607-gov"><button onclick="p607OpenPage(\'manager\',\'m-workflow\')">Rules</button><button onclick="p607OpenPage(\'manager\',\'m-pricing\')">Pricing</button><button onclick="p607OpenPage(\'manager\',\'m-allocation-live\')">Allocation Day</button><button onclick="p607OpenPage(\'manager\',\'m-permissions\')">Permissions</button><button onclick="p607OpenPage(\'manager\',\'m-home\')">Monitoring</button><button onclick="p607OpenPage(\'manager\',\'m-replay\')">Exceptions / Audit</button></div></section>'+
    '<div class="p607-scroll-note"><span><b>Flowchart stays in one row.</b> Drag or use the horizontal scrollbar to inspect every stage at a larger, easier-to-read size.</span><span>Scroll horizontally →</span></div>'+
    '<div class="p607-flow-wrap"><main class="p607-flow">'+
      '<section class="p607-stage"><div class="p607-label">ENTRY CHANNELS</div><div class="p607-entry"><h3>3 ways to enter</h3><p>Different channels. Same buyer journey.</p><div class="p607-entry-card p607-click" onclick="rtEnterRole(\'buyer\')" title="Open Buyer role"><span class="p607-open">ROLE ↗</span><b>Buyer Direct</b><span>Explore and register online.</span></div><div class="p607-entry-card p607-click" onclick="rtEnterRole(\'broker\')" title="Open Broker role"><span class="p607-open">ROLE ↗</span><b>Broker</b><span>Registers a buyer and follows the same process.</span></div><div class="p607-entry-card p607-click" onclick="rtEnterRole(\'registrar\')" title="Open Queue Receptionist role"><span class="p607-open">ROLE ↗</span><b>Sales Center</b><span>Register or find the buyer at reception.</span></div></div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">REGISTER & QUALIFY</div><article class="p607-card p607-record p607-click" onclick="p607OpenPage(\'buyer\',\'b-eoi\')" title="Open EOI & Eligibility"><span class="p607-open">OPEN ↗</span><h3>ONE BUYER RECORD + EOI</h3><p>All entry channels use one buyer and one EOI record.</p>'+tags(['One record','No duplicates'])+'</article></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage p607-decision-stage"><div class="p607-label">ELIGIBILITY</div><div class="p607-diamond" onclick="p607OpenPage(\'buyer\',\'b-eoi\')" title="Open Eligibility"><div class="p607-diamond-copy"><b>Ready for allocation?</b><span>Identity • EOI • Docs • Eligible unit type</span></div></div><div class="p607-loop" onclick="p607OpenPage(\'buyer\',\'b-eoi\')"><b>Not ready?</b>Complete missing requirements.</div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage p607-att-stage"><div class="p607-label">ATTENDANCE</div><div class="p607-diamond" onclick="p607OpenPage(\'buyer\',\'b-allocation-day\')" title="Open Allocation Day"><div class="p607-diamond-copy"><b>How will the buyer join?</b><span>Online • Sales Center</span></div></div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">ONLINE / OFFLINE</div><div class="p607-branch"><h3>Attendance path</h3><p>Different connection modes. Same queue rules.</p><div class="p607-lane online" onclick="p607OpenPage(\'buyer\',\'b-allocation-day\')"><b>ONLINE</b><span>Buyer joins Allocation Day digitally.</span></div><div class="p607-lane center" onclick="p607OpenPage(\'registrar\',\'r-checkin\')"><b>OFFLINE / SALES CENTER</b><span>Reception verifies and checks in the buyer.</span></div></div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">SHARED QUEUE</div><article class="p607-card p607-queue p607-click" onclick="p607OpenPage(\'manager\',\'m-allocation-live\')" title="Open Live Allocation Day"><span class="p607-open">OPEN ↗</span><h3>ONE SHARED QUEUE</h3><p>#233 Offline and #234 Online stay in the same ordered queue.</p>'+tags(['#233 Offline','#234 Online','Same priority'])+'</article></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">ALLOCATE</div><div class="p607-group p607-allocation"><h3>Allocate</h3><p>The shared queue feeds the same allocator-seat pool.</p><div class="p607-inside"><div class="p607-sub system clickable" onclick="p607OpenPage(\'manager\',\'m-allocation-live\')"><span class="p607-open">OPEN ↗</span><h4>Parallel Allocation</h4><p>#233 Offline • #234 Online • one queue • '+seats+' shared allocator seats</p></div><div class="p607-inside-arrow">→</div><div class="p607-sub role clickable" onclick="rtEnterRole(\'operator\')"><span class="p607-open">ROLE ↗</span><h4>Allocator</h4><p>Buyer is assigned automatically when their turn arrives.</p></div></div></div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">SELECT & RESERVE</div><div class="p607-group p607-select"><h3>Select & Reserve</h3><p>Choose the exact physical unit, then lock it.</p><div class="p607-inside"><div class="p607-sub system clickable" onclick="p607OpenPage(\'buyer\',\'b-site\')"><span class="p607-open">OPEN ↗</span><h4>Exact Unit Selection</h4><p>Master Plan → Building → Floor → Unit</p><div class="p607-chain"><button onclick="event.stopPropagation();p607OpenPage(\'buyer\',\'b-site\')">Plan</button><button onclick="event.stopPropagation();p607OpenPage(\'buyer\',\'b-building\')">Building</button><button onclick="event.stopPropagation();p607OpenPage(\'buyer\',\'b-floor\')">Floor</button><button onclick="event.stopPropagation();p607OpenPage(\'buyer\',\'b-unit\')">Unit</button></div></div><div class="p607-inside-arrow">→</div><div class="p607-sub rule clickable" onclick="p607OpenPage(\'operator\',\'a-handoff\')"><span class="p607-open">OPEN ↗</span><h4>Unit Lock</h4><p>Reserve exact unit and prevent double booking.</p></div></div></div></section>'+
      '<div class="p607-arrow">→</div>'+
      '<section class="p607-stage"><div class="p607-label">COMPLETE</div><div class="p607-group p607-complete"><h3>Complete Purchase</h3><p>Payment, contract and confirmed property.</p><div class="p607-inside"><div class="p607-sub role clickable" onclick="rtEnterRole(\'finance\')"><span class="p607-open">ROLE ↗</span><h4>Transaction Operator</h4><p>Payment • Documents • Finance</p></div><div class="p607-inside-arrow">→</div><div class="p607-sub system clickable" onclick="p607OpenPage(\'buyer\',\'b-contract\')"><span class="p607-open">OPEN ↗</span><h4>Contract & Sign</h4><p>OTP • Signature • Biometric</p></div><div class="p607-inside-arrow">→</div><div class="p607-sub outcome clickable" onclick="p607OpenPage(\'buyer\',\'b-properties\')"><span class="p607-open">OPEN ↗</span><h4>My Property</h4><p>Booking confirmed in the buyer account.</p></div></div></div></section>'+
      '<div class="p607-flow-footer"><div><b>Flow logic:</b> <span>3 entry channels → one buyer record → eligibility loop → attendance split → one shared queue → shared allocator seats → exact unit → lock → transaction → contract → property.</span></div><div class="p607-legend"><em><i style="background:#edf4ff;border:1px solid #c7d7f7"></i>Role</em><em><i style="background:#f8fafc;border:1px solid #dde5ee"></i>System</em><em><i style="background:#fff6e6;border:1px solid #f0d29a"></i>Rule</em><em><i style="background:#f1fbf5;border:1px solid #cce7d4"></i>Outcome</em></div></div>'+
    '</main></div>'+
   '</div></div>';
   document.body.appendChild(el);
 };
 try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){ }
 setTimeout(function(){if(document.getElementById('rolePortal'))window.rtBuildRolePortal();},60);
})();

// extracted from rev608-scroll-controls-script
(function(){
 window.p608ScrollFlow=function(dir){var w=document.querySelector('.p607-flow-wrap');if(!w)return;var amount=Math.max(420,Math.round(w.clientWidth*.72));w.scrollBy({left:Number(dir||1)*amount,behavior:'smooth'});};
 function enhance(){var note=document.querySelector('.p607-scroll-note');if(note&&!note.querySelector('.p607-scroll-tools')){var old=note.lastElementChild;if(old)old.remove();var tools=document.createElement('div');tools.className='p607-scroll-tools';tools.innerHTML='<button type="button" onclick="p608ScrollFlow(-1)">← Back</button><span>Horizontal flow</span><button type="button" onclick="p608ScrollFlow(1)">Next →</button>';note.appendChild(tools)}}
 var prev=window.rtBuildRolePortal;if(typeof prev==='function'){window.rtBuildRolePortal=function(){var r=prev.apply(this,arguments);setTimeout(enhance,0);return r};try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){}}
 setTimeout(enhance,80);
})();
