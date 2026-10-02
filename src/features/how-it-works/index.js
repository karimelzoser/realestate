// extracted from rev615-flow-page-audit-script
(function(){
 if(typeof P==='undefined')return;
 var PRODUCT=window.PRENEURA&&window.PRENEURA.model?window.PRENEURA.model:null;
 function box(k,title,text,badge){return '<section class="p615-role-example"><div><small>'+k+'</small><b>'+title+'</b><span>'+text+'</span></div><em>'+badge+'</em></section>'}
 var defs={
  'm-home':['MANAGER EXAMPLE','Live launch-day overview','Monitor buyer demand, queue pressure, allocator capacity, exceptions and transactions without changing buyer priority.','Manager'],
  'm-workflow':['MANAGER EXAMPLE','Published allocation rules','See the active eligibility, queue, grace and lock rules that control every buyer channel.','Rules'],
  'm-pricing':['MANAGER EXAMPLE','Canonical price version','The demo keeps a published price snapshot attached to exact-unit transactions and every override is auditable.','Pricing'],
  'm-permissions':['MANAGER EXAMPLE','Role boundaries','Allocator can select/lock/handoff; Transaction Operator owns payment/docs; Queue Reception cannot change price or priority.','Permissions'],
  'm-replay':['MANAGER EXAMPLE','Exception & audit replay','Use the audit trail to reconstruct who changed what, when, why and the before/after state.','Audit'],
  'm-allocation-live':['LIVE EXAMPLE','#233 Offline + #234 Online','Both buyers remain in one queue. Offline gets Human Allocator assistance; Online gets the bilingual AI Allocation Advisor.','Shared Queue'],
  'a-desk':['ALLOCATOR EXAMPLE','#233 Mona Adel • Offline','The Allocator does not choose who to serve. PRENEURA assigns the buyer, then the Allocator helps choose the exact physical unit and lock it.','Human Allocator'],
  't-inbox':['TRANSACTION EXAMPLE','Locked property handoff','The Transaction Operator receives the exact locked unit after allocation and owns payment evidence, documents, finance and contract readiness.','Transaction'],
  'br-dashboard':['BROKER EXAMPLE','Broker-originated buyer','Broker registers the buyer and follows attribution/commission, while the buyer still uses the same EOI, queue and inventory truth.','Broker'],
  'b-browse':['BUYER EXAMPLE','Self-service buyer journey','Buyer can explore before login. Real workflow gates appear only when the buyer enters EOI, allocation and transaction stages.','Buyer']
 };
 Object.keys(defs).forEach(function(id){if(!P[id]||typeof P[id].render!=='function')return;var base=P[id].render,d=defs[id];P[id].render=function(){return box(d[0],d[1],d[2],d[3])+base.apply(this,arguments)}});
 window.p615FlowRouteAudit=function(){
   if(PRODUCT&&PRODUCT.flow&&Array.isArray(PRODUCT.flow.stages)){
     var rows=[];
     PRODUCT.flow.stages.forEach(function(stage){
       if(stage.page)rows.push([stage.title,stage.role,stage.page,stage.mode||'OPEN']);
       (stage.routes||[]).forEach(function(r){rows.push([r.label,r.role,r.page,r.mode||'OPEN'])});
       (stage.subroutes||[]).forEach(function(r){rows.push([r.label,stage.role,r.page,'OPEN'])});
     });
     return rows;
   }
   return [
    ['Buyer role','buyer','b-browse','ROLE'],['Broker role','broker','br-dashboard','ROLE'],['Queue Receptionist','registrar','r-checkin','ROLE'],['Manager','manager','m-home','ROLE'],['EOI & Eligibility','buyer','b-eoi','OPEN'],['Allocation Day','buyer','b-allocation-day','OPEN'],['Offline Check-in','registrar','r-checkin','OPEN'],['Shared Queue / Parallel Allocation','manager','m-allocation-live','OPEN'],['Human Allocator','operator','a-desk','ROLE'],['Online AI Advisor','buyer','b-site','OPEN'],['Master Plan','buyer','b-site','OPEN'],['Building','buyer','b-building','OPEN'],['Floor','buyer','b-floor','OPEN'],['Exact Unit','buyer','b-unit','OPEN'],['Unit Lock','operator','a-handoff','OPEN'],['Transaction Operator','finance','t-inbox','ROLE'],['Contract & Sign','buyer','b-contract','OPEN'],['My Property','buyer','b-properties','OPEN']
   ];
 };
})();

// extracted from rev616-metro-final-script
(function(){
 if(typeof app==='undefined'||typeof P==='undefined'||typeof rtEnterRole==='undefined')return;
 function openPage(role,page){
   if(typeof p612OpenFlowPage==='function'){p612OpenFlowPage(role,page);return;}
   if(typeof p607OpenPage==='function'){p607OpenPage(role,page);return;}
   if(!P[page]){if(typeof toast==='function')toast('Page not available');return;}
   document.getElementById('rolePortal')?.remove();app.role=role;app.page=page;if(typeof go==='function')go(page);else if(typeof render==='function')render();
 }
 window.p616Open=openPage;
 window.p616Scroll=function(dir){var v=document.querySelector('.p616-viewport');if(!v)return;v.scrollBy({left:Number(dir||1)*Math.max(520,Math.round(v.clientWidth*.76)),behavior:'smooth'});};
 function node(cls,title,text,action,tags){
   return '<article class="p616-node '+cls+'" '+action+'><div class="meta"><span class="p616-kind">'+(cls.indexOf('role')>-1?'ROLE':cls.indexOf('ai')>-1?'AI ASSISTANCE':cls.indexOf('rule')>-1?'RULE':cls.indexOf('outcome')>-1?'AFTER SALE':'SYSTEM')+'</span><span class="p616-action">'+(cls.indexOf('role')>-1?'ROLE ↗':'OPEN ↗')+'</span></div><h3>'+title+'</h3><p>'+text+'</p>'+(tags&&tags.length?'<div class="p616-tags">'+tags.map(function(t){return '<span>'+t+'</span>';}).join('')+'</div>':'')+'</article>';
 }
 window.rtBuildRolePortal=function(){
   var old=document.getElementById('rolePortal');if(old)old.remove();
   var launch=(app.fx&&app.fx.launch&&app.fx.launch.id)||'EV-2026-01';
   var phase=(app.fx&&app.fx.launch&&app.fx.launch.phase)||'PH-01';
   var seats=(app.fx&&app.fx.p59&&app.fx.p59.physicalSeats)||10;
   var online=(app.fx&&app.fx.p59&&app.fx.p59.onlineSlots)||3;
   var el=document.createElement('div');el.id='rolePortal';
   el.innerHTML=''+
   '<div class="p616-portal"><div class="p616-shell">'+
    '<header class="p616-head"><div><small>SYSTEM OVERVIEW</small><h1>How PRENEURA Works</h1><p>Three entry channels merge into one buyer record, split by attendance, merge into one shared queue, then branch only for assistance: a Human Allocator helps Sales Center buyers while the bilingual AI Allocation Advisor helps Online buyers. Both use the same live inventory, exact-unit lock and transaction process.</p></div><div class="p616-head-actions"><span class="p616-chip">'+launch+'</span><span class="p616-chip">'+phase+'</span><span class="p616-chip live">● SHARED REALTIME STATE</span></div></header>'+
    '<div class="p616-truth"><i></i><b>ONE SHARED SOURCE OF TRUTH</b><span>Buyer • EOI • Queue • Exact Unit • Payment • Contract • Installments • Audit</span></div>'+
    '<section class="p616-manager"><button class="p616-manager-main" onclick="rtEnterRole(\'manager\')"><b>MANAGER CONTROL →</b><span>Real Manager role • workflow restrictions apply</span></button><div class="p616-manager-grid"><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-workflow\')">Rules</button><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-pricing\')">Pricing</button><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-allocation-live\')">Capacity</button><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-permissions\')">Permissions</button><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-home\')">Monitoring</button><button onclick="event.stopPropagation();p616Open(\'manager\',\'m-replay\')">Audit / Exceptions</button></div></section>'+
    '<div class="p616-guide"><div><b>Read left → right.</b> Branches are real choices; merged lines return to the same shared transaction. Scroll horizontally without shrinking the content.</div><div class="p616-guide-actions"><button onclick="p616Scroll(-1)">← Back</button><span>Horizontal metro flow</span><button onclick="p616Scroll(1)">Next →</button></div></div>'+
    '<div class="p616-viewport"><main class="p616-map">'+
      '<div class="p616-zone p616-z-entry">ENTRY CHANNELS</div><div class="p616-zone p616-z-qualify">REGISTER & QUALIFY</div><div class="p616-zone p616-z-attend">ATTENDANCE</div><div class="p616-zone p616-z-queue">SHARED QUEUE</div><div class="p616-zone p616-z-assist">ALLOCATION ASSISTANCE</div><div class="p616-zone p616-z-select">SELECT & RESERVE</div><div class="p616-zone p616-z-complete">COMPLETE & AFTER SALE</div>'+
      '<svg viewBox="0 0 3340 500" aria-hidden="true"><defs><marker id="p616a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#91a6be"/></marker></defs><g fill="none" stroke="#91a6be" stroke-width="2" marker-end="url(#p616a)">'+
        '<path d="M230 130 H248 Q262 130 262 244 H282"/><path d="M230 267 H282"/><path d="M230 404 H248 Q262 404 262 291 H282"/>'+
        '<path d="M512 264 H548"/><path d="M658 263 H708"/>'+
        '<path d="M818 263 H856 Q902 263 902 136"/><path d="M818 263 H856 Q902 263 902 388"/>'+
        '<path d="M1122 136 H1140 Q1160 136 1160 238"/><path d="M1122 388 H1140 Q1160 388 1160 290"/>'+
        '<path d="M1388 264 H1428"/>'+
        '<path d="M1658 264 H1676 Q1700 264 1700 136"/><path d="M1658 264 H1676 Q1700 264 1700 388"/>'+
        '<path d="M1938 136 H1955 Q1980 136 1980 238"/><path d="M1938 388 H1955 Q1980 388 1980 290"/>'+
        '<path d="M2250 264 H2290"/><path d="M2510 264 H2550"/><path d="M2785 264 H2825"/><path d="M3045 264 H3080"/>'+
        '<path d="M603 318 V360"/><path d="M525 388 H510 V263 H548"/>'+
      '</g><g font-size="7" font-weight="850" fill="#6f8196"><text x="665" y="253">YES</text><text x="607" y="349">NO</text><text x="858" y="135">ONLINE</text><text x="844" y="402">SALES CENTER</text><text x="1650" y="135">ONLINE</text><text x="1643" y="402">OFFLINE</text></g></svg>'+
      node('role p616-entry1','BUYER DIRECT','Explore and register online. Buyer role uses the real Buyer workflow and restrictions.','onclick="rtEnterRole(\'buyer\')"',['Buyer role'])+
      node('role p616-entry2','BROKER','Registers a buyer, follows the journey and owns broker attribution / commission context.','onclick="rtEnterRole(\'broker\')"',['Broker role'])+
      node('role p616-entry3','SALES CENTER / RECEPTION','Find or register the buyer, verify identity, check in and issue / load the queue token.','onclick="rtEnterRole(\'registrar\')"',['Queue Receptionist'])+
      node('system p616-record','ONE BUYER RECORD + EOI','Every channel uses the same buyer identity and EOI record. No duplicate online / offline customer truth.','onclick="p616Open(\'buyer\',\'b-eoi\')"',['Identity','EOI','Eligible unit types'])+
      '<div class="p616-decision p616-elig" onclick="p616Open(\'buyer\',\'b-eoi\')"><div class="diamond"><div class="copy"><b>Ready for allocation?</b><span>Identity • EOI • Docs • Eligible unit type</span></div></div></div>'+
      '<div class="p616-loop" onclick="p616Open(\'buyer\',\'b-eoi\')"><b>NO → Complete requirements</b><span>Fix missing eligibility items, then re-check.</span></div>'+
      '<div class="p616-decision p616-att" onclick="p616Open(\'buyer\',\'b-allocation-day\')"><div class="diamond"><div class="copy"><b>How will the buyer join?</b><span>Online • Sales Center</span></div></div></div>'+
      node('system p616-online','ONLINE ATTENDANCE','Buyer enters Allocation Day digitally. Attendance does not create a separate queue.','onclick="p616Open(\'buyer\',\'b-allocation-day\')"',['Online'])+
      node('system p616-offline','SALES CENTER ATTENDANCE','Reception verifies attendance and checks the buyer into the same Allocation Day.','onclick="p616Open(\'registrar\',\'r-checkin\')"',['Offline','Check-in'])+
      node('rule p616-queue','ONE SHARED QUEUE','#233 Offline and #234 Online stay in one ordered queue with the same priority rules.','onclick="p616Open(\'manager\',\'m-allocation-live\')"',['#233 Offline','#234 Online','Same priority'])+
      node('system p616-capacity','PARALLEL ALLOCATION','One queue feeds compatible capacity: '+seats+' Sales Center desks + '+online+' Online slots.','onclick="p616Open(\'manager\',\'m-allocation-live\')"',['Same queue','Parallel service'])+
      '<div class="p616-merge-note"><b>Attendance changes how the buyer is served — not queue priority.</b><br>#233 remains ahead of #234; free compatible capacity serves each buyer when their turn and channel are ready.</div>'+
      node('ai p616-ai','AI ALLOCATION ADVISOR • ONLINE','Professional bilingual advisor (English + Egyptian Arabic) talks to the buyer, explains choices, compares options, highlights controls and takes safe navigation actions.','onclick="p616Open(\'buyer\',\'b-site\')"',['Voice','مصري + English','Guided actions'])+
      node('role p616-human','HUMAN ALLOCATOR • OFFLINE','The Sales Center Allocator works with the buyer in person and helps choose Master Plan → Building → Floor → Exact Unit.','onclick="rtEnterRole(\'operator\')"',['Human assistance','Exact-unit help'])+
      '<div class="p616-assist-note">Same queue → different assistance → same live inventory and exact-unit lock</div>'+
      '<article class="p616-node system p616-unit" onclick="p616Open(\'buyer\',\'b-site\')"><div class="meta"><span class="p616-kind">SYSTEM</span><span class="p616-action">OPEN ↗</span></div><h3>EXACT UNIT SELECTION</h3><p>The buyer makes the decision. Human Allocator / AI Advisor helps. PRENEURA keeps live inventory authoritative.</p><div class="p616-tags"><button onclick="event.stopPropagation();p616Open(\'buyer\',\'b-site\')">Master Plan</button><button onclick="event.stopPropagation();p616Open(\'buyer\',\'b-building\')">Building</button><button onclick="event.stopPropagation();p616Open(\'buyer\',\'b-floor\')">Floor</button><button onclick="event.stopPropagation();p616Open(\'buyer\',\'b-unit\')">Exact Unit</button></div></article>'+
      node('rule p616-lock','UNIT LOCK','Only the successful exact-unit lock reserves inventory and prevents double booking.','onclick="p616Open(\'operator\',\'a-handoff\')"',['Lock','Handoff'])+
      node('role p616-transaction','TRANSACTION OPERATOR','Payment & Contract Specialist: verifies payment, documents and finance, then prepares contract readiness.','onclick="rtEnterRole(\'finance\')"',['Payment','Documents','Finance'])+
      node('system p616-contract','CONTRACT & SIGN','Buyer reviews the exact contract, verifies OTP, signs and completes biometric verification.','onclick="p616Open(\'buyer\',\'b-contract\')"',['OTP','Signature','Biometric'])+
      node('outcome p616-property','MY PROPERTY','Open the owned property with installments, signed contract, documents, receipts, updates and support.','onclick="p616Open(\'buyer\',\'b-properties\')"',['Installments','Contract','Documents'])+
      ''+
    '</main></div>'+
    '<div class="p616-legend"><span><i style="background:#edf4ff;border:1px solid #c7d7f7"></i> Role</span><span><i style="background:#f8fafc;border:1px solid #dde5ee"></i> System</span><span><i style="background:#fff6e6;border:1px solid #f0d29a"></i> Rule / merge</span><span><i style="background:#eef8f1;border:1px solid #c9e4d1"></i> AI / outcome</span><span><b>OPEN ↗</b> direct page preview</span><span><b>ROLE ↗</b> real role workflow + restrictions</span></div>'+
   '</div></div>';
   document.body.appendChild(el);
 };
 try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){ }
 setTimeout(function(){if(document.getElementById('rolePortal'))window.rtBuildRolePortal();},60);
})();
