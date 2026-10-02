// PRENEURA router / direct-preview service.
(function(){
 if(typeof app==='undefined'||typeof P==='undefined')return;
 var directOpenBase=typeof window.p604OpenPage==='function'?window.p604OpenPage:null;
 var state={active:false,snapshot:null};
 window.__p612FlowPreviewState=state;

 function cloneSession(){
   var s=app.fx&&app.fx.final6&&app.fx.final6.buyerSession;
   return s?{customerId:s.customerId,loggedIn:!!s.loggedIn}:null;
 }
 function beginSnapshot(){
   if(state.snapshot)return;
   state.snapshot={
     buyerSession:cloneSession(),
     p581PurchaseMode:app.p581PurchaseMode,
     eventOpen:app.fx&&app.fx.final6?app.fx.final6.eventOpen:undefined
   };
 }
 function restoreSnapshot(){
   if(!state.snapshot)return;
   var snap=state.snapshot,s=app.fx&&app.fx.final6&&app.fx.final6.buyerSession;
   if(s&&snap.buyerSession){s.customerId=snap.buyerSession.customerId;s.loggedIn=snap.buyerSession.loggedIn;}
   if(typeof snap.p581PurchaseMode==='undefined')delete app.p581PurchaseMode;else app.p581PurchaseMode=snap.p581PurchaseMode;
   if(app.fx&&app.fx.final6&&typeof snap.eventOpen!=='undefined')app.fx.final6.eventOpen=snap.eventOpen;
   state.snapshot=null;state.active=false;app.__flowDirectPreview=false;
 }
 window.p612ExitFlowPreview=restoreSnapshot;

 function ensurePreviewBuyer(page){
   if(!app.fx||!app.fx.rt||!Array.isArray(app.fx.rt.registry)||!app.fx.final6)return;
   var id='P607-234';
   var r=app.fx.rt.registry.find(function(x){return x.customerId===id});
   if(!r){
     r={customerId:id,name:'Youssef Nabil',nationalId:'29601011223444',phone:'+201000000234',eoi:'EOI-234',eoiState:'ELIGIBLE',eoiPaid:true,docs:'VERIFIED',eligible:['R2-STD','R3-MID'],allocationEntered:true,attendanceMode:'ONLINE',priorityTier:'A'};
     app.fx.rt.registry.push(r);
   }
   r.eoi=r.eoi||'EOI-234';r.eoiState='ELIGIBLE';r.eoiPaid=true;r.docs='VERIFIED';r.eligible=r.eligible&&r.eligible.length?r.eligible:['R2-STD','R3-MID'];
   r.allocationEntered=true;r.attendanceMode='ONLINE';r.allocationDate=app.fx.final6.eventClockDate;
   var s=app.fx.final6.buyerSession;if(s){s.customerId=id;s.loggedIn=true;}
   app.fx.final6.eventOpen=true;app.p581PurchaseMode=true;
   if(app.fx.queue&&Array.isArray(app.fx.queue.waiting)){
     var q=app.fx.queue.waiting.find(function(x){return Number(x.token)===234});
     if(!q){app.fx.queue.waiting.push({token:234,buyer:r.name,customerId:id,eoi:'ELIGIBLE',eligible:r.eligible.slice(),preferred:['R2-STD'],state:'WAITING',attendanceMode:'ONLINE',priorityTier:'A',registeredAt:new Date(Date.now()-95*60000).toISOString()});}
     else{q.customerId=id;q.buyer=r.name;q.attendanceMode='ONLINE';q.eligible=q.eligible&&q.eligible.length?q.eligible:r.eligible.slice();}
   }
 }
 function addPreviewBanner(role,page){
   var root=document.getElementById('pageRoot');if(!root||root.querySelector('.p612-preview-banner'))return;
   var title=P[page]?(P[page].title||P[page].nav||page):page;
   root.insertAdjacentHTML('afterbegin','<div class="p612-preview-banner"><div><b>FLOWCHART PAGE PREVIEW</b><span>Opened directly from How PRENEURA Works: '+String(title).replace(/[<>]/g,'')+'. Navigation prerequisites such as buyer login are bypassed for this preview. Role entry still uses the real workflow rules.</span></div><button type="button" onclick="p611ShowHowItWorks()">← How It Works</button></div>');
 }
 function openDirect(role,page){
   if(!P[page]){if(typeof toast==='function')toast('This page is not available');return;}
   beginSnapshot();state.active=true;app.__flowDirectPreview=true;
   if(role==='buyer'||String(page).indexOf('b-')===0)ensurePreviewBuyer(page);
   if(directOpenBase)directOpenBase(role,page);
   else{
     document.getElementById('rolePortal')?.remove();document.body.classList.remove('public-mode');document.body.classList.add('platform-mode');
     document.getElementById('landing')?.classList.add('hidden');document.getElementById('app')?.classList.remove('hidden');document.getElementById('guide')?.classList.add('hidden');
     app.role=role;app.page=page;if(typeof go==='function')go(page);else if(typeof render==='function')render();
   }
   setTimeout(function(){addPreviewBanner(role,page);},30);
 }
 window.p612OpenFlowPage=openDirect;
 window.p607OpenPage=openDirect;

 /* ROLE clicks keep the genuine role journey: restore any preview-only session first. */
 var roleEnterBase=window.rtEnterRole;
 if(typeof roleEnterBase==='function'){
   window.rtEnterRole=function(role){restoreSnapshot();return roleEnterBase.apply(this,arguments);};
   try{rtEnterRole=window.rtEnterRole}catch(_){ }
 }

 /* Returning to the overview also clears preview-only authentication state. */
 var portalBase=window.rtShowPortal;
 if(typeof portalBase==='function'){
   window.rtShowPortal=function(){restoreSnapshot();return portalBase.apply(this,arguments);};
   try{rtShowPortal=window.rtShowPortal}catch(_){ }
 }
 var howBase=window.p611ShowHowItWorks||window.showProjectHomepage;
 if(typeof howBase==='function'){
   window.p611ShowHowItWorks=function(){restoreSnapshot();return howBase.apply(this,arguments);};
   window.showProjectHomepage=window.p611ShowHowItWorks;
 }

 function enhanceFlowKey(){
   var note=document.querySelector('.p607-scroll-note');if(!note||note.querySelector('.p612-flow-key'))return;
   var key=document.createElement('div');key.className='p612-flow-key';key.innerHTML='<em class="open">OPEN ↗ = direct page preview</em><em class="role">ROLE ↗ = real role workflow + restrictions</em>';note.appendChild(key);
 }
 var buildBase=window.rtBuildRolePortal;
 if(typeof buildBase==='function'){
   window.rtBuildRolePortal=function(){var r=buildBase.apply(this,arguments);setTimeout(enhanceFlowKey,0);return r;};
   try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){ }
 }
 setTimeout(enhanceFlowKey,80);
})();
