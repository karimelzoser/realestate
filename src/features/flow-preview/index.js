// PRENEURA 6.2.1 — functional How It Works previews + contract demo readiness.
(function(){
  if(typeof app==='undefined'||typeof P==='undefined')return;

  var fixtureSnapshot=null;
  function clone(v){try{return JSON.parse(JSON.stringify(v))}catch(_){return v}}
  function units(){try{return typeof UNITS!=='undefined'?UNITS:(window.UNITS||[])}catch(_){return window.UNITS||[]}}
  function currentUnit(id){try{return typeof unit==='function'?unit(Number(id)):units().find(function(u){return Number(u.id)===Number(id)})}catch(_){return units().find(function(u){return Number(u.id)===Number(id)})}}
  function activeLock(id){try{return typeof fxLockById==='function'?fxLockById(id):(app.fx.locks||[]).find(function(x){return x.id===id})}catch(_){return (app.fx.locks||[]).find(function(x){return x.id===id})}}

  function saveFixtures(){
    if(fixtureSnapshot)return;
    fixtureSnapshot={
      physicalSelection:clone(app.physicalSelection),
      buyerSegment:app.buyerSegment,
      selectedBuilding:app.selectedBuilding,
      floor:app.floor,
      selected:app.selected,
      selectedType:app.selectedType,
      transaction:clone(app.fx&&app.fx.transaction),
      contract:clone(app.fx&&app.fx.contract),
      locks:clone(app.fx&&app.fx.locks||[]),
      docs:clone(app.fx&&app.fx.final6&&app.fx.final6.transactionDocs||[]),
      allocatorSession:clone(app.fx&&app.fx.final6&&app.fx.final6.allocatorSession),
      rtSearch:app.fx&&app.fx.rt?app.fx.rt.search:undefined,
      rtSearchResult:clone(app.fx&&app.fx.rt&&app.fx.rt.searchResult),
      queueWaiting:clone(app.fx&&app.fx.queue&&app.fx.queue.waiting||[]),
      queueStations:clone(app.fx&&app.fx.queue&&app.fx.queue.stations||[]),
      unitStatuses:units().map(function(u){return [u.id,u.status]})
    };
  }

  function restoreFixtures(){
    if(!fixtureSnapshot)return;
    var s=fixtureSnapshot;
    app.physicalSelection=clone(s.physicalSelection);
    app.buyerSegment=s.buyerSegment;
    app.selectedBuilding=s.selectedBuilding;
    app.floor=s.floor;
    app.selected=s.selected;
    app.selectedType=s.selectedType;
    if(app.fx){
      app.fx.transaction=clone(s.transaction);
      app.fx.contract=clone(s.contract);
      app.fx.locks=clone(s.locks||[]);
      if(app.fx.final6){
        app.fx.final6.transactionDocs=clone(s.docs||[]);
        app.fx.final6.allocatorSession=clone(s.allocatorSession);
      }
      if(app.fx.rt){app.fx.rt.search=s.rtSearch;app.fx.rt.searchResult=clone(s.rtSearchResult)}
      if(app.fx.queue){app.fx.queue.waiting=clone(s.queueWaiting||[]);app.fx.queue.stations=clone(s.queueStations||[])}
    }
    (s.unitStatuses||[]).forEach(function(x){var u=currentUnit(x[0]);if(u)u.status=x[1]});
    fixtureSnapshot=null;
  }
  window.p620RestorePreviewFixtures=restoreFixtures;

  function pickDemoUnit(){
    var list=units();
    return list.find(function(u){return Number(u.id)===17&&u.status!=='sold'&&u.status!=='booked'})||
           list.find(function(u){return u.status==='available'})||list[0]||null;
  }

  function ensureSelection(){
    var u=pickDemoUnit();if(!u)return null;
    app.buyerSegment='residential';
    app.selectedBuilding='UV10-3';
    app.floor=Number(u.floor||4);
    app.selected=Number(u.id);
    try{if(typeof UNIT_TYPES!=='undefined'){var t=UNIT_TYPES.find(function(x){return (x.instanceIds||[]).includes(Number(u.id))});if(t)app.selectedType=t.id}}catch(_){ }
    if(!app.selectedType)app.selectedType='R2-STD';
    app.physicalSelection={
      key:String(u.id),unitId:Number(u.id),status:u.status||'available',rooms:Number(u.rooms||2),
      size:Number(u.size||96),outdoor:Number(u.terrace||12),price:Number(u.price||319900),
      orientation:u.orientation||'South-East',view:u.view||'Courtyard',sun:u.sun||'Balanced daylight',
      privacy:u.privacy||'Good',building:'Uus‑Volta 10/3',floor:Number(u.floor||4),segment:'residential'
    };
    return u;
  }

  function ensureLock(opts){
    opts=opts||{};
    var u=ensureSelection();if(!u)return null;
    app.fx.locks=app.fx.locks||[];
    var id=opts.id||('LOCK-PREVIEW-'+u.id),tx=opts.tx||('TX-PREVIEW-'+u.id);
    var l=app.fx.locks.find(function(x){return x.id===id&&x.state==='ACTIVE'});
    if(!l){
      l={id:id,unit:Number(u.id),buyer:opts.buyer||'Youssef Nabil',customerId:opts.customerId||'P607-234',tx:tx,type:opts.type||'HANDOFF',state:'ACTIVE',createdAt:Date.now(),expiresAt:Date.now()+45*60000,channel:opts.channel||'FLOW_PREVIEW'};
      app.fx.locks.push(l);
    }
    if(u.status==='available')u.status='hold';
    return l;
  }

  function ensureRegistrar(){
    if(!app.fx||!app.fx.rt)return;
    var r=(app.fx.rt.registry||[]).find(function(x){return x.customerId==='P607-233'||x.name==='Mona Adel'})||
          (app.fx.rt.registry||[]).find(function(x){return x.eoiPaid&&x.eoiState==='ELIGIBLE'})||null;
    if(r){app.fx.rt.search=r.nationalId||r.passport||'';app.fx.rt.searchResult=r}
  }

  function ensureAllocatorHandoff(){
    var l=ensureLock({id:'LOCK-PREVIEW-233',tx:'TX-PREVIEW-233',buyer:'Mona Adel',customerId:'P607-233',type:'SELECTION',channel:'SALES_CENTER'});if(!l)return;
    var stations=app.fx&&app.fx.queue&&app.fx.queue.stations||[];
    var st=stations.find(function(x){return x.id==='S01'})||stations[0];
    if(st){
      st.token=233;st.buyer='Mona Adel';st.eoi='EOI-233';st.eligible=['R2-STD','R3-MID'];st.preferred=['R2-STD'];st.state='UNIT_LOCKED';st.unit=l.unit;st.tx=l.tx;
      app.fx.queue.focusStation=st.id;
      app.fx.final6.allocatorSession={station:st.id,token:233,buyer:'Mona Adel',customerId:'P607-233'};
    }
  }

  function resetContractForPreview(){
    var c=app.fx.contract;if(!c)return;
    if(c.generated||c.status==='SIGNED'){
      c.generated=false;c.status='DRAFT';c.hash='';c.snapshot=null;c.otpSent=false;c.otpVerified=false;c.consent=false;c.fingerprint=false;c.signedAt=null;c.evidence=[];
      if(app.fx.final6&&app.fx.final6.signing){app.fx.final6.signing.hasStroke=false;app.fx.final6.signing.signatureAt=null;app.fx.final6.signing.biometricVerified=false;app.fx.final6.signing.biometricMethod='';app.fx.final6.signing.biometricReceipt=''}
    }
  }

  function ensureTransactionBase(){
    var l=ensureLock({id:'LOCK-PREVIEW-234',tx:'TX-PREVIEW-234',buyer:'Youssef Nabil',customerId:'P607-234',type:'HANDOFF',channel:'ONLINE'});if(!l)return null;
    var t=app.fx.transaction;
    t.id=l.tx;t.buyer=l.buyer;t.unit=l.unit;t.lockId=l.id;t.priceVersion=app.priceVersion;t.scheme=app.fx.pricing&&app.fx.pricing.selected||'INSTALLMENT';
    t.payment={state:'PENDING',amount:0,reference:''};t.state='PAYMENT_DOCUMENTS';t.approved=false;
    app.fx.final6.transactionDocs.forEach(function(d){d.file='';d.uploadedBy='';d.verified=false});
    resetContractForPreview();
    return t;
  }

  function preparePage(role,page){
    if(['b-building','b-floor','b-unit','a-handoff','t-inbox','b-contract'].includes(page))saveFixtures();
    if(page==='b-building'){app.buyerSegment='residential';app.selectedBuilding='UV10-3'}
    if(page==='b-floor'){app.buyerSegment='residential';app.selectedBuilding='UV10-3';var u=pickDemoUnit();app.floor=Number(u&&u.floor||4)}
    if(page==='b-unit')ensureSelection();
    if(page==='r-checkin')ensureRegistrar();
    if(page==='a-handoff')ensureAllocatorHandoff();
    if(page==='t-inbox'||page==='b-contract')ensureTransactionBase();
  }
  window.p620PrepareFlowPreview=preparePage;

  /* The contract preview is intentionally demo-ready without weakening real ROLE rules. */
  window.p620CompleteContractRequirements=function(){
    if(!app.__flowDirectPreview){if(typeof toast==='function')toast('Use the Transaction Operator workflow to complete real requirements.');return}
    if(!app.fx.transaction.lockId||!activeLock(app.fx.transaction.lockId)||activeLock(app.fx.transaction.lockId).state!=='ACTIVE')ensureTransactionBase();
    var t=app.fx.transaction;
    t.payment={state:'CONFIRMED',amount:500000,reference:'PREVIEW-RECON-'+Date.now().toString().slice(-5)};
    app.fx.final6.transactionDocs.forEach(function(d,i){d.file=['national-id-verified.pdf','reservation-form-signed.pdf','payment-evidence-reconciled.pdf'][i]||('verified-'+i+'.pdf');d.uploadedBy='TRANSACTION_OPERATOR';d.verified=true});
    t.state='CONTRACT_READY';t.approved=true;
    if(typeof fxAudit==='function')fxAudit('PREVIEW_TRANSACTION_READY',t.id,'Preview payment confirmed + documents verified + approval ready','FLOW_PREVIEW');
    if(typeof toast==='function')toast('Demo requirements completed. Generate the exact contract next.');
    if(typeof render==='function')render();
  };

  function contractReady(){try{return typeof f6ContractReadyChecks==='function'&&f6ContractReadyChecks().every(function(x){return x.ok})}catch(_){return false}}
  function contractHelper(){
    if(!app.__flowDirectPreview||app.page!=='b-contract'||app.fx.contract&&app.fx.contract.generated)return '';
    var ready=contractReady();
    return '<section class="p620-preview-helper '+(ready?'ready':'')+'"><div><small>DIRECT PREVIEW HELPER</small><b>'+(ready?'Transaction requirements are ready':'Prepare a complete contract demo')+'</b><p>'+(ready?'The selected-unit lock, payment, documents and approval gates are ready. Generate the exact contract, then continue OTP → drawn signature → biometric verification → final signature.':'This flow preview can prepare the active unit lock, confirmed payment and verified demo documents so every signing control can be tested. This helper exists only in OPEN preview mode.')+'</p></div><button type="button" onclick="'+(ready?'f6GenerateBuyerContract()':'p620CompleteContractRequirements()')+'">'+(ready?'Generate Exact Contract':'Complete Demo Requirements')+'</button></section>';
  }

  if(P['b-contract']&&typeof P['b-contract'].render==='function'){
    var contractBase=P['b-contract'].render;
    P['b-contract'].render=function(){
      var html=contractBase.apply(this,arguments),helper=contractHelper();
      if(!helper)return html;
      var end=html.indexOf('</section>');
      return end>=0?html.slice(0,end+10)+helper+html.slice(end+10):helper+html;
    };
  }

  /* Make the sticky Complete requirements CTA actually prepare the preview transaction. */
  var contractNextBase=window.p581ContractNext;
  if(typeof contractNextBase==='function'){
    window.p581ContractNext=function(){
      if(app.page==='b-contract'&&app.__flowDirectPreview&&!app.fx.contract.generated&&!contractReady()){p620CompleteContractRequirements();return}
      return contractNextBase.apply(this,arguments);
    };
  }

  /* Prepare every direct flow destination before the existing router renders it. */
  var openBase=window.p612OpenFlowPage;
  if(typeof openBase==='function'){
    window.p612OpenFlowPage=function(role,page){preparePage(role,page);var out=openBase.apply(this,arguments);setTimeout(updatePageClass,0);return out};
    window.p607OpenPage=window.p612OpenFlowPage;
  }

  function updatePageClass(){document.body.classList.toggle('p620-contract-active',app.page==='b-contract')}
  var goBase=window.go;
  if(typeof goBase==='function'){
    window.go=function(){var out=goBase.apply(this,arguments);setTimeout(updatePageClass,0);return out};
    try{go=window.go}catch(_){ }
  }
  updatePageClass();

  /* Restore preview-only fixtures before entering a real role or returning to the system map. */
  var roleBase=window.rtEnterRole;
  if(typeof roleBase==='function'){
    window.rtEnterRole=function(){restoreFixtures();document.body.classList.remove('p620-contract-active');return roleBase.apply(this,arguments)};
    try{rtEnterRole=window.rtEnterRole}catch(_){ }
  }
  var howBase=window.p611ShowHowItWorks||window.showProjectHomepage;
  if(typeof howBase==='function'){
    window.p611ShowHowItWorks=function(){restoreFixtures();document.body.classList.remove('p620-contract-active');return howBase.apply(this,arguments)};
    window.showProjectHomepage=window.p611ShowHowItWorks;
  }

  /* Remove explanatory chrome the user no longer wants on the How It Works page. */
  function simplifyPortal(){
    var portal=document.querySelector('.p616-portal');if(!portal)return;
    portal.classList.add('p620-flow-clean');
    var selectors=['.p616-head p','.p616-head-actions','.p616-truth','.p616-guide','.p616-legend'];
    selectors.forEach(function(sel){portal.querySelectorAll(sel).forEach(function(el){el.remove()})});
  }
  var buildBase=window.rtBuildRolePortal;
  if(typeof buildBase==='function'){
    window.rtBuildRolePortal=function(){var out=buildBase.apply(this,arguments);setTimeout(simplifyPortal,0);return out};
    try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){ }
  }
  setTimeout(simplifyPortal,60);

  window.p620FlowPreviewAudit=function(){
    var routes=window.p615FlowRouteAudit?window.p615FlowRouteAudit():[];
    return routes.map(function(r){return {label:r[0],role:r[1],page:r[2],mode:r[3],exists:!!P[r[2]],renderable:!!(P[r[2]]&&typeof P[r[2]].render==='function')};});
  };
})();
