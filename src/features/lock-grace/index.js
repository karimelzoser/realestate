/* PRENEURA 6.7 — two-stage exact-unit lock grace workflow. */
(function(){
  'use strict';
  if(typeof app==='undefined'||typeof P==='undefined')return;

  var G=app.fx.lockGrace67=app.fx.lockGrace67||{shortMinutes:15,extendedHours:24,records:[]};
  G.records=Array.isArray(G.records)?G.records:[];

  function E(v){try{return typeof fxEsc==='function'?fxEsc(v):String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})}catch(_){return String(v==null?'':v)}}
  function R(){try{if(typeof render==='function')render()}catch(_){}}
  function T(v){try{if(typeof toast==='function')toast(v)}catch(_){}}
  function A(type,ref,detail,actor){try{if(typeof fxAudit==='function')fxAudit(type,ref,detail,actor)}catch(_){}}
  function units(){try{return typeof UNITS!=='undefined'?UNITS:[]}catch(_){return []}}
  function unitById(id){return units().find(function(u){return Number(u.id)===Number(id)})||null}
  function registry(){return app.fx.rt&&Array.isArray(app.fx.rt.registry)?app.fx.rt.registry:[]}
  function queue(){return app.fx.queue&&Array.isArray(app.fx.queue.waiting)?app.fx.queue.waiting:[]}
  function nowIso(){return new Date().toISOString()}
  function channelForBuyer(name,customerId){
    var b=registry().find(function(x){return (customerId&&x.customerId===customerId)||(name&&x.name===name)});
    var q=queue().find(function(x){return (customerId&&x.customerId===customerId)||(name&&x.buyer===name)});
    var m=String(q&&q.attendanceMode||b&&b.attendanceMode||'ONLINE').toUpperCase();
    return ['ONLINE','REMOTE','DIGITAL'].includes(m)?'ONLINE':'SALES_CENTER';
  }
  function heldUnit(u){return u&&['hold','held','reserved','booked','locked'].includes(String(u.status||'').toLowerCase())}
  function tx(){return app.fx.transaction||null}
  function keyFor(t){return String(t&&t.id||'')+'|'+String(t&&t.unit||'')}
  function activeStates(){return ['SHORT_ACTIVE','EXTENSION_REQUESTED','EXTENDED_24H','EXPIRED']}
  function byKey(k){return G.records.find(function(r){return r.key===k})||null}
  function byTx(t){return t?byKey(keyFor(t)):null}
  function latest(){return G.records.slice().sort(function(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''))})[0]||null}
  function current(){var t=tx(),r=t&&byTx(t);return r||latest()}
  function remaining(r){if(!r||!r.expiresAt||['COMPLETED','RELEASED','REJECTED'].includes(r.status))return 0;return Math.max(0,new Date(r.expiresAt).getTime()-Date.now())}
  function fmtDuration(v){v=Math.max(0,Math.floor(v/1000));var h=Math.floor(v/3600),m=Math.floor((v%3600)/60),s=v%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}

  function markExpired(r){
    if(!r)return false;
    if(r.status==='EXTENSION_REQUESTED'&&remaining(r)<=0){
      if(!r.shortExpiredAt)r.shortExpiredAt=nowIso();
      if(!r.pendingExpiryAudited){
        r.pendingExpiryAudited=true;
        A('UNIT_LOCK_EXTENSION_REQUEST_PENDING_AFTER_SHORT_GRACE',r.lockId||('UNIT-'+r.unit),r.buyer+' • unit #'+r.unit+' • awaiting Transaction Operator decision','SYSTEM');
      }
      return false;
    }
    if(!['SHORT_ACTIVE','EXTENDED_24H'].includes(r.status)||remaining(r)>0)return false;
    r.status='EXPIRED';
    r.expiredAt=nowIso();
    if(!r.expiryAudited){
      r.expiryAudited=true;
      A('UNIT_LOCK_GRACE_EXPIRED',r.lockId||('UNIT-'+r.unit),'Grace expired for '+r.buyer+' • unit #'+r.unit+' • '+r.type,'SYSTEM');
    }
    return true;
  }

  function sync(){
    var t=tx();
    if(!t||!t.unit)return null;
    var u=unitById(t.unit);
    var locked=!!t.lockId||heldUnit(u);
    if(!locked)return byTx(t);
    var r=byTx(t);
    if(!r){
      var buyer=t.buyer||app.fx.final6&&app.fx.final6.allocatorSession&&app.fx.final6.allocatorSession.buyer||'Buyer';
      var customerId=t.customerId||null;
      var channel=channelForBuyer(buyer,customerId);
      var start=Date.now();
      r={
        id:'GR-'+Date.now().toString(36).toUpperCase(),
        key:keyFor(t),transaction:t.id||'—',lockId:t.lockId||('LOCK-'+t.unit),unit:t.unit,
        buyer:buyer,customerId:customerId,channel:channel,type:'SHORT_HANDOFF',status:'SHORT_ACTIVE',
        createdAt:new Date(start).toISOString(),startedAt:new Date(start).toISOString(),
        expiresAt:new Date(start+G.shortMinutes*60000).toISOString(),
        shortMinutes:G.shortMinutes,extendedHours:G.extendedHours,request:null,decision:null
      };
      G.records.unshift(r);
      A('UNIT_LOCK_SHORT_GRACE_STARTED',r.lockId,r.buyer+' • unit #'+r.unit+' • '+G.shortMinutes+' minute handoff protection',channel==='ONLINE'?'BUYER':'ALLOCATOR');
    }
    markExpired(r);
    return r;
  }

  function statusLabel(r){
    if(!r)return 'NO ACTIVE LOCK';
    return {
      SHORT_ACTIVE:'SHORT HANDOFF GRACE',
      EXTENSION_REQUESTED:'24H EXTENSION REQUESTED',
      EXTENDED_24H:'24H EXTENDED GRACE',
      COMPLETED:'HANDOFF COMPLETED',
      EXPIRED:'GRACE EXPIRED',
      RELEASED:'LOCK RELEASED',
      REJECTED:'EXTENSION REJECTED'
    }[r.status]||r.status;
  }
  function badgeKind(r){
    if(!r)return '';
    if(r.status==='COMPLETED'||r.status==='EXTENDED_24H')return 'ok';
    if(r.status==='EXPIRED'||r.status==='RELEASED'||r.status==='REJECTED')return 'bad';
    return 'warn';
  }
  function ruleText(r){
    if(!r)return 'The short grace starts immediately after the exact physical unit is successfully locked.';
    if(r.status==='SHORT_ACTIVE')return 'The '+r.shortMinutes+' minute Short Handoff Grace protects the exact unit while Allocation hands the buyer to Transaction Operations. If Transaction Operations completes the initial handoff in time, the grace closes and the normal transaction continues.';
    if(r.status==='EXTENSION_REQUESTED')return 'The buyer requested 24h Extended Grace. It is not active until the Transaction Operator approves it. The request remains visible in the decision inbox even if the short timer reaches zero.';
    if(r.status==='EXTENDED_24H')return '24h Extended Grace is active from the approval time. It protects the exact unit while the approved paperwork/payment exception is completed.';
    if(r.status==='EXPIRED')return 'The grace deadline has passed. The lock is now eligible for controlled release by Transaction Operations; PRENEURA never silently changes queue priority.';
    return 'Grace processing is complete for this exact-unit lock.';
  }

  function policyTiles(){
    return '<div class="p67g-policy-grid">'+
      '<div class="p67g-policy"><b>Short Handoff Grace</b><strong>'+E(G.shortMinutes)+' min</strong><span>Starts for both Online and Sales Center buyers immediately after the exact unit is locked. It protects the unit while Allocation hands the buyer to Transaction Operations.</span></div>'+
      '<div class="p67g-policy"><b>Online buyer extension</b><strong>24h Extended Grace</strong><span>The buyer may request more time with a reason. The extension becomes active only after Transaction Operator approval.</span></div>'+
      '<div class="p67g-policy"><b>Sales Center paperwork exception</b><strong>24h Extended Grace</strong><span>The Transaction Operator may grant a 24-hour exception when the Offline buyer still needs to complete approved physical paperwork.</span></div>'+
      '<div class="p67g-policy"><b>Authority</b><strong>Transaction Operator</strong><span>Approves/rejects Online extension requests, grants Offline exceptions, closes a completed handoff, or releases an expired lock.</span></div>'+
    '</div>';
  }

  function emptyCard(mode){
    var who=mode==='buyer'?'Buyer':mode==='allocator'?'Allocator':mode==='operator'?'Transaction Operator':'Manager';
    return '<div class="p67g-shell"><section class="p67g-card"><div class="p67g-head"><div><small>'+E(who.toUpperCase())+' • UNIT LOCK GRACE</small><h4>Two-stage exact-unit protection</h4><p>No current exact-unit lock is using a grace period on this record. The policy below starts automatically after a successful unit lock.</p></div><span class="p67g-badge">POLICY READY</span></div>'+policyTiles()+'</section></div>';
  }

  function card(r,mode){
    if(!r)return emptyCard(mode);
    markExpired(r);
    var left=remaining(r),request=r.request;
    var operator=mode==='operator',buyer=mode==='buyer',allocator=mode==='allocator';
    var shortExpiredPending=r.status==='EXTENSION_REQUESTED'&&left<=0;
    return '<div class="p67g-shell"><section class="p67g-card '+(r.status==='EXPIRED'?'p67g-expired':'')+'">'+
      '<div class="p67g-head"><div><small>EXACT UNIT LOCK PROTECTION</small><h4>'+E(statusLabel(r))+'</h4><p>Two-stage lock protection: '+E(r.shortMinutes||G.shortMinutes)+' minute Short Handoff Grace, followed only when approved by 24h Extended Grace.</p></div><span class="p67g-badge '+badgeKind(r)+'">'+E(statusLabel(r))+'</span></div>'+
      '<div class="p67g-count">'+
        '<div class="p67g-stat"><b class="p67g-time '+(r.status==='EXPIRED'?'bad':'')+'" data-p67g-id="'+E(r.id)+'">'+fmtDuration(left)+'</b><span>'+(shortExpiredPending?'Short grace ended • decision pending':'Time remaining')+'</span></div>'+
        '<div class="p67g-stat"><b>#'+E(r.unit)+'</b><span>Exact unit</span></div>'+
        '<div class="p67g-stat"><b>'+E(r.buyer)+'</b><span>Buyer</span></div>'+
        '<div class="p67g-stat"><b>'+E(r.channel==='ONLINE'?'Online':'Sales Center')+'</b><span>Allocation channel</span></div>'+
        '<div class="p67g-stat"><b>'+E(r.lockId||'—')+'</b><span>Lock reference</span></div>'+
      '</div>'+policyTiles()+'<div class="p67g-rule"><b>Current rule</b><span>'+E(ruleText(r))+'</span></div>'+
      (request?'<div class="p67g-request"><b>Extended-grace request / exception</b><span>'+E(request.reason)+' • requested '+new Date(request.requestedAt).toLocaleString()+(r.decision?' • decision: '+E(r.decision.state)+' by '+E(r.decision.by):' • waiting for Transaction Operator approval')+'</span></div>':'')+
      '<div class="p67g-actions">'+
        (buyer&&r.channel==='ONLINE'&&r.status==='SHORT_ACTIVE'?'<button class="primary" onclick="p67RequestExtendedGrace()">Request 24h Extended Grace</button>':'')+
        (buyer&&r.status==='EXTENSION_REQUESTED'?'<button disabled>24h request sent — awaiting Transaction Operator</button>':'')+
        (operator&&r.status==='EXTENSION_REQUESTED'?'<button class="green" onclick="p67ApproveExtendedGrace()">Approve 24h Extension</button><button class="danger" onclick="p67RejectExtendedGrace()">Reject Extension</button>':'')+
        (operator&&r.channel==='SALES_CENTER'&&['SHORT_ACTIVE','EXPIRED'].includes(r.status)?'<button class="warn" onclick="p67GrantPaperworkException()">Grant 24h Paperwork Exception</button>':'')+
        (operator&&activeStates().includes(r.status)?'<button class="primary" onclick="p67CompleteGrace()">Mark Transaction Handoff Complete</button><button class="danger" onclick="p67ReleaseGraceLock()">Release Unit Lock</button>':'')+
        (allocator&&r.status==='SHORT_ACTIVE'?'<button onclick="go(\'t-inbox\')">Open Transaction Handoff</button>':'')+
      '</div><div class="p67g-note">Short Handoff Grace: '+E(r.shortMinutes||G.shortMinutes)+' minutes • 24h Extended Grace: '+E(r.extendedHours||G.extendedHours)+' hours from Transaction Operator approval.</div>'+
    '</section></div>';
  }

  function requestExtended(){
    var r=sync();
    if(!r||r.channel!=='ONLINE'||r.status!=='SHORT_ACTIVE'){T('A 24-hour request is available only for an active Online short-grace lock.');return}
    var reason=(prompt('Why do you need the 24-hour extended grace period?','I need more time to finish the required documents.')||'').trim();
    if(!reason)return;
    r.request={reason:reason,requestedAt:nowIso(),requestedBy:r.buyer};
    r.status='EXTENSION_REQUESTED';
    A('UNIT_LOCK_24H_EXTENSION_REQUESTED',r.lockId,reason,'BUYER');
    T('24-hour grace request sent to the Transaction Operator for approval.');
    R();
  }
  function approve(){
    var r=current();
    if(!r||r.status!=='EXTENSION_REQUESTED'){T('There is no pending 24-hour request.');return}
    var at=Date.now();
    r.status='EXTENDED_24H';r.type='EXTENDED_24H';r.approvedAt=new Date(at).toISOString();r.expiresAt=new Date(at+G.extendedHours*3600000).toISOString();
    r.decision={state:'APPROVED',by:'Transaction Operator',at:r.approvedAt};
    A('UNIT_LOCK_24H_EXTENSION_APPROVED',r.lockId,r.buyer+' • unit #'+r.unit+' • '+G.extendedHours+'h','TRANSACTION_OPERATOR');
    T('24-hour extended grace approved.');R();
  }
  function reject(){
    var r=current();
    if(!r||r.status!=='EXTENSION_REQUESTED'){T('There is no pending extension request.');return}
    var reason=(prompt('Reason for rejecting the extension','Requirements must be completed within the short grace period.')||'Rejected').trim();
    r.decision={state:'REJECTED',by:'Transaction Operator',at:nowIso(),reason:reason};
    r.status=remaining(r)>0?'SHORT_ACTIVE':'EXPIRED';
    A('UNIT_LOCK_24H_EXTENSION_REJECTED',r.lockId,reason,'TRANSACTION_OPERATOR');
    T('Extended grace request rejected.');R();
  }
  function paperwork(){
    var r=current();
    if(!r||r.channel!=='SALES_CENTER'||!['SHORT_ACTIVE','EXPIRED'].includes(r.status)){T('The paperwork exception is for an Offline / Sales Center buyer with an active or just-expired short grace.');return}
    var reason=(prompt('Reason for 24-hour paperwork exception','Buyer must complete outstanding physical paperwork.')||'').trim();
    if(!reason)return;
    var at=Date.now();
    r.status='EXTENDED_24H';r.type='EXTENDED_24H';
    r.request={reason:reason,requestedAt:new Date(at).toISOString(),requestedBy:'Transaction Operator • Offline exception'};
    r.approvedAt=new Date(at).toISOString();r.expiresAt=new Date(at+G.extendedHours*3600000).toISOString();
    r.decision={state:'APPROVED',by:'Transaction Operator',at:r.approvedAt,reason:reason};
    A('UNIT_LOCK_24H_PAPERWORK_EXCEPTION_GRANTED',r.lockId,r.buyer+' • '+reason,'TRANSACTION_OPERATOR');
    T('24-hour paperwork exception granted.');R();
  }
  function complete(){
    var r=current();
    if(!r||!activeStates().includes(r.status)){T('There is no active grace to complete.');return}
    r.status='COMPLETED';r.completedAt=nowIso();r.expiresAt=r.completedAt;
    A('UNIT_LOCK_GRACE_COMPLETED',r.lockId,r.buyer+' • transaction handoff complete','TRANSACTION_OPERATOR');
    T('Transaction handoff completed. The grace timer is closed; the transaction can continue under its normal state.');R();
  }
  function release(){
    var r=current();
    if(!r||r.status==='RELEASED'){T('No releasable grace lock is selected.');return}
    var reason=(prompt('Reason for releasing the exact-unit lock','Grace expired / transaction not completed')||'Grace lock released').trim();
    var u=unitById(r.unit);if(u&&heldUnit(u))u.status='available';
    var t=tx();if(t&&Number(t.unit)===Number(r.unit)){t.lockId=null;if(t.state&&!/SIGNED|COMPLETED/.test(String(t.state)))t.state='LOCK_RELEASED'}
    r.status='RELEASED';r.releasedAt=nowIso();r.releaseReason=reason;
    A('UNIT_LOCK_RELEASED_AFTER_GRACE',r.lockId,reason,'TRANSACTION_OPERATOR');
    T('Exact-unit lock released.');R();
  }

  window.p67RequestExtendedGrace=requestExtended;
  window.p67ApproveExtendedGrace=approve;
  window.p67RejectExtendedGrace=reject;
  window.p67GrantPaperworkException=paperwork;
  window.p67CompleteGrace=complete;
  window.p67ReleaseGraceLock=release;
  window.p67SetShortGrace=function(mins){var n=Math.max(5,Math.min(60,Number(mins)||15));G.shortMinutes=n;T('Short handoff grace set to '+n+' minutes for new locks.');R()};
  window.p67GracePolicy=function(){return {shortMinutes:G.shortMinutes,extendedHours:G.extendedHours,onlineExtension:'Buyer request + Transaction Operator approval',offlineExtension:'Transaction Operator paperwork exception'}};
  window.p67GraceSnapshot=function(){sync();return JSON.parse(JSON.stringify({shortMinutes:G.shortMinutes,extendedHours:G.extendedHours,records:G.records}))};
  window.p67DemoStartShortGrace=function(channel){
    var t=tx()||{};
    if(!t.id)t.id='TX-GRACE-DEMO';
    if(!t.unit)t.unit=(units()[0]&&units()[0].id)||17;
    if(!t.buyer)t.buyer=channel==='SALES_CENTER'?'Offline Grace Buyer':'Online Grace Buyer';
    t.lockId=t.lockId||('LOCK-DEMO-'+t.unit);app.fx.transaction=t;
    var u=unitById(t.unit);if(u)u.status='hold';
    var r=sync();if(r&&channel)r.channel=channel;R();return r;
  };

  function managerTable(){
    sync();
    var rows=G.records.slice().sort(function(a,b){return String(b.createdAt||'').localeCompare(String(a.createdAt||''))});
    return '<div class="p67g-shell"><section class="p67g-card"><div class="p67g-head"><div><small>MANAGER • UNIT LOCK GRACE CONTROL</small><h4>Short handoff protection + approved 24-hour exceptions</h4><p>See every exact physical unit protected between Allocation and Transaction Operations, including Online requests and Sales Center paperwork exceptions.</p></div><span class="p67g-badge">'+rows.filter(function(r){return activeStates().includes(r.status)}).length+' ACTIVE</span></div>'+policyTiles()+'<div class="p67g-actions"><button onclick="p67SetShortGrace(10)">10 min short grace</button><button onclick="p67SetShortGrace(15)">15 min</button><button onclick="p67SetShortGrace(20)">20 min</button></div>'+
      (rows.length?'<div class="p67g-tablewrap"><table class="p67g-table"><tr><th>Buyer</th><th>Unit / lock</th><th>Channel</th><th>Grace type</th><th>Status</th><th>Remaining</th><th>Request / exception</th><th>Decision</th></tr>'+rows.map(function(r){markExpired(r);return '<tr><td><b>'+E(r.buyer)+'</b><small>'+E(r.customerId||r.transaction||'')+'</small></td><td><b>#'+E(r.unit)+'</b><small>'+E(r.lockId)+'</small></td><td>'+E(r.channel==='ONLINE'?'Online':'Sales Center')+'</td><td>'+E(r.type==='EXTENDED_24H'?'24h Extended':'Short Handoff')+'</td><td><span class="p67g-badge '+badgeKind(r)+'">'+E(statusLabel(r))+'</span></td><td><b class="p67g-time" style="font-size:10px!important" data-p67g-id="'+E(r.id)+'">'+fmtDuration(remaining(r))+'</b></td><td>'+E(r.request&&r.request.reason||'—')+'</td><td>'+E(r.decision?r.decision.state+' • '+r.decision.by:'—')+'</td></tr>'}).join('')+'</table></div>':'<div class="p67g-empty">No active or historical grace records yet. The two-stage policy is ready and starts automatically on the next exact-unit lock.</div>')+
    '</section></div>';
  }

  function wrap(id,mode,where){
    var page=P[id];if(!page||typeof page.render!=='function'||page.render.__p67Grace)return;
    var base=page.render;
    var fn=function(){var r=sync();var html=base();var c=mode==='manager'?managerTable():card(r,mode);return where==='after'?String(html)+c:c+String(html)};
    fn.__p67Grace=true;page.render=fn;
  }
  ['b-unit','b-paymentdocs','b-contract'].forEach(function(id){wrap(id,'buyer','before')});
  ['a-desk','a-handoff'].forEach(function(id){wrap(id,'allocator','before')});
  ['t-inbox','t-readiness'].forEach(function(id){wrap(id,'operator','before')});
  wrap('m-allocation-live','manager','before');

  function updateTimers(){
    sync();G.records.forEach(markExpired);
    document.querySelectorAll('[data-p67g-id]').forEach(function(el){var r=G.records.find(function(x){return x.id===el.dataset.p67gId});if(!r)return;el.textContent=fmtDuration(remaining(r));if(r.status==='EXPIRED')el.classList.add('bad')});
  }
  if(!window.__PRENEURA67_GRACE_TIMER)window.__PRENEURA67_GRACE_TIMER=setInterval(updateTimers,1000);
  sync();
})();