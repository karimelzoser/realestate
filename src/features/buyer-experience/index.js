// Extracted active Buyer experience, My Property and AI advisor behavior from Rev 6.1.3 and 6.1.4.
(function(){
 if(typeof app==='undefined'||typeof P==='undefined')return;
 app.fx=app.fx||{};
 app.fx.aiAdvisor=app.fx.aiAdvisor||{voiceEnabled:false,minimized:false,greeted:{},lastMessage:'',listening:false};
 var A=app.fx.aiAdvisor;
 var allocationPages=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit'];
 function esc(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c;});}
 function currentBuyer(){
   try{var sid=app.fx&&app.fx.final6&&app.fx.final6.buyerSession&&app.fx.final6.buyerSession.customerId;return (app.fx.rt&&app.fx.rt.registry||[]).find(function(r){return r.customerId===sid})||null}catch(_){return null}
 }
 function onlineContext(){
   if(!allocationPages.includes(app.page))return false;
   if(app.__flowDirectPreview)return true;
   if(app.role!=='buyer')return false;
   var r=currentBuyer();
   return !!(r&&String(r.attendanceMode||'').toUpperCase()==='ONLINE');
 }
 function guidance(page){
   var r=currentBuyer(),eligible=(r&&r.eligible||[]).join(', ');
   var g={
    'b-allocation-day':'Welcome to Online Allocation Day. I can explain the process, take you to the shared queue, and guide you when your turn starts.',
    'b-queue':'You are in the same priority queue as Sales Center buyers. I can explain your position and move with you to unit selection when your turn begins.',
    'b-site':'Your allocation session is active. I will guide you through Master Plan, Building, Floor, and Exact Unit without changing your queue priority.',
    'b-building':'Choose the building that best matches your preferences. I can highlight the available choice or take you forward when you decide.',
    'b-floor':'Now choose the floor. I can highlight the relevant controls and explain what the next step will do.',
    'b-unit':'This is the final selection step. I can highlight available units and explain choices. You remain the decision maker; I will not lock a unit without your explicit confirmation.'
   };
   return (g[page]||'I am your PRENEURA AI Allocation Advisor.')+(eligible?' Eligible unit types: '+eligible+'.':'');
 }
 function speak(text){
   A.lastMessage=text;
   var msg=document.querySelector('.p613-advisor-msg');if(msg)msg.textContent=text;
   if(!A.voiceEnabled||!('speechSynthesis' in window))return;
   try{window.speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);u.rate=.98;u.pitch=1;u.volume=1;u.lang='en-US';window.speechSynthesis.speak(u)}catch(_){ }
 }
 function clearHighlights(){document.querySelectorAll('.p613-ai-highlight').forEach(function(x){x.classList.remove('p613-ai-highlight')})}
 function visible(el){var s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
 function findAction(words){
   var candidates=[].slice.call(document.querySelectorAll('#pageRoot button,#pageRoot a,#pageRoot [onclick]'));
   var ws=words.map(function(x){return String(x).toLowerCase()});
   return candidates.find(function(el){if(!visible(el))return false;var t=(el.textContent||'').trim().toLowerCase();return ws.some(function(w){return t.includes(w)})})||null;
 }
 function highlight(words,label){
   clearHighlights();var el=findAction(words);
   if(el){el.classList.add('p613-ai-highlight');try{el.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})}catch(_){ }speak(label||'I highlighted the control I am referring to.');return true}
   speak('I could not find that control on the current screen. I can take you to the correct step instead.');return false;
 }
 function nav(page,msg){
   clearHighlights();speak(msg||'Opening the next step.');
   setTimeout(function(){
     if(app.__flowDirectPreview&&typeof p612OpenFlowPage==='function')p612OpenFlowPage('buyer',page);
     else if(typeof go==='function')go(page);
   },180);
 }
 function safeContinue(){
   var candidates=[].slice.call(document.querySelectorAll('#pageRoot button,#pageRoot a'));
   var el=candidates.find(function(x){if(!visible(x))return false;var t=(x.textContent||'').trim().toLowerCase();return /(continue|next|start|open|choose|view)/.test(t)&&!/(lock|reserve|pay|sign|submit|confirm|cancel|delete)/.test(t)});
   if(el){clearHighlights();el.classList.add('p613-ai-highlight');speak('I highlighted the safest next action. You can choose it, or ask me to open a specific step.');return}
   speak('There is no safe automatic next action on this screen. Tell me which step you want to open.');
 }
 function act(raw){
   var q=String(raw||'').trim().toLowerCase();if(!q)return;
   if(/queue|position|waiting/.test(q)){nav('b-queue','Opening your shared queue. Online and Sales Center buyers remain in the same priority order.');return}
   if(/allocation day|join online|start allocation/.test(q)){nav('b-allocation-day','Opening Online Allocation Day.');return}
   if(/master plan|site|project plan/.test(q)){nav('b-site','Opening the Master Plan. I will guide you from here to the exact unit.');return}
   if(/building/.test(q)){nav('b-building','Opening building selection.');return}
   if(/floor/.test(q)){nav('b-floor','Opening floor selection.');return}
   if(/exact unit|unit selection|show units|available units|unit$/.test(q)){nav('b-unit','Opening Exact Unit Selection. I will help you compare the available choices.');return}
   if(/payment|documents|finance/.test(q)){nav('b-paymentdocs','Opening payment and documents. The Transaction Operator owns this stage.');return}
   if(/contract|sign/.test(q)){nav('b-contract','Opening Contract and Sign.');return}
   if(/property|properties/.test(q)){nav('b-properties','Opening My Property.');return}
   if(/lock|reserve|book/.test(q)){highlight(['lock','reserve','hold'],'I highlighted the reservation control. Because this commits the exact unit, I need you to make the final confirmation yourself.');return}
   if(/highlight|what next|next step|help me choose|help choose/.test(q)){safeContinue();return}
   if(/stop talking|mute|stop voice/.test(q)){A.voiceEnabled=false;try{speechSynthesis.cancel()}catch(_){ }speak('Voice is off. I will continue helping with text and actions.');mount();return}
   if(/start voice|talk to me|voice on/.test(q)){A.voiceEnabled=true;speak('Voice guidance is on. '+guidance(app.page));mount();return}
   speak('I can guide the shared queue, Master Plan, Building, Floor, Exact Unit, payment, contract, and My Property. I can navigate and highlight controls, while final reservation and signing remain your decision.');
 }
 function recognition(){
   var R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R)return null;
   try{var r=new R();r.lang='en-US';r.interimResults=false;r.maxAlternatives=1;return r}catch(_){return null}
 }
 function startListen(){
   var rec=recognition();if(!rec){speak('Voice input is not available in this browser. You can type your request below.');return}
   A.listening=true;mount();
   rec.onresult=function(e){A.listening=false;var t=e.results&&e.results[0]&&e.results[0][0]?e.results[0][0].transcript:'';mount();act(t)};
   rec.onerror=function(){A.listening=false;mount();speak('I could not hear that clearly. Please try again or type your request.');};
   rec.onend=function(){A.listening=false;mount();};
   try{rec.start()}catch(_){A.listening=false;mount()}
 }
 function mount(){
   document.querySelectorAll('.p613-advisor').forEach(function(x){x.remove()});
   if(!onlineContext())return;
   var box=document.createElement('section');box.className='p613-advisor'+(A.minimized?' p613-advisor-min':'');
   var msg=A.lastMessage||guidance(app.page);
   box.innerHTML='<div class="p613-advisor-head"><div class="p613-avatar">AI</div><div><b>PRENEURA AI Allocation Advisor</b><span>Online buyer • Voice + guided actions</span></div><button type="button" class="p613-minimize" title="Minimize">'+(A.minimized?'▢':'—')+'</button></div><div class="p613-advisor-body"><div class="p613-advisor-msg">'+esc(msg)+'</div><div class="p613-advisor-actions"><button type="button" class="voice p613-voice">'+(A.voiceEnabled?'🔊 Voice On':'▶ Start Voice')+'</button><button type="button" class="p613-talk">'+(A.listening?'Listening…':'🎙 Talk')+'</button><button type="button" class="primary p613-next">Highlight Next</button><button type="button" class="p613-units">Exact Units</button></div><form class="p613-advisor-input"><input aria-label="Ask AI Allocation Advisor" placeholder="Ask: show units, building, queue…"><button type="submit">Send</button></form><div class="p613-advisor-foot"><span>Can navigate, explain and highlight.</span><b>Lock/sign require buyer confirmation.</b></div></div>';
   document.body.appendChild(box);
   box.querySelector('.p613-minimize').addEventListener('click',function(){A.minimized=!A.minimized;mount()});
   if(A.minimized)return;
   box.querySelector('.p613-voice').addEventListener('click',function(){A.voiceEnabled=!A.voiceEnabled;if(!A.voiceEnabled){try{speechSynthesis.cancel()}catch(_){ }A.lastMessage='Voice is off. I will continue with text guidance.';mount()}else{speak('Voice guidance is on. '+guidance(app.page));mount()}});
   box.querySelector('.p613-talk').addEventListener('click',startListen);
   box.querySelector('.p613-next').addEventListener('click',safeContinue);
   box.querySelector('.p613-units').addEventListener('click',function(){act('exact unit')});
   box.querySelector('form').addEventListener('submit',function(e){e.preventDefault();var i=box.querySelector('input');var v=i.value;i.value='';act(v)});
   if(!A.greeted[app.page]){A.greeted[app.page]=true;A.lastMessage=guidance(app.page);if(A.voiceEnabled)setTimeout(function(){speak(A.lastMessage)},120)}
 }
 window.p613AdvisorAct=act;window.p613MountAdvisor=mount;
 /* Make role meaning explicit in the horizontal flow without changing the core logic. */
 function enhanceFlow(){
   var root=document.getElementById('rolePortal');if(!root)return;
   var entry=[].slice.call(root.querySelectorAll('.p607-entry-card'));
   entry.forEach(function(card){var b=(card.querySelector('b')||{}).textContent||'';var s=card.querySelector('span:last-child');if(!s)return;
     if(/Buyer Direct/i.test(b))s.innerHTML='Self-service buyer: explores, registers and buys online.';
     if(/^Broker$/i.test(b))s.innerHTML='Partner sales role: registers buyer, follows journey and commission.';
     if(/Sales Center/i.test(b))s.innerHTML='Queue Receptionist: registers/finds buyer, verifies check-in and issues queue.';
   });
   var allocation=root.querySelector('.p607-allocation');
   if(allocation){
     allocation.innerHTML='<h3>Allocation Assistance</h3><p>One shared queue, but the assistance changes by attendance mode.</p><div class="p613-assist-grid"><div class="p613-assist-card human" onclick="rtEnterRole(\'operator\')"><span class="p607-open">ROLE ↗</span><h4>HUMAN ALLOCATOR • OFFLINE</h4><p>Helps the Sales Center buyer understand the options and choose the exact physical unit: Master Plan → Building → Floor → Unit.</p><span class="who">Human assistance at allocator seat</span></div><div class="p613-assist-card ai" onclick="p612OpenFlowPage(\'buyer\',\'b-site\')"><span class="p607-open">OPEN ↗</span><h4>AI VOICE ADVISOR • ONLINE</h4><p>Talks to the online buyer, explains choices, highlights controls and can navigate the selection journey. The buyer confirms the final unit lock.</p><span class="who">Voice + guided actions</span></div></div><div class="p613-merge-note"><b>Both paths use the same shared queue, live inventory, exact-unit selection and lock engine.</b></div>';
   }
   var fin=root.querySelector('.p607-complete .p607-sub.role h4');if(fin){fin.textContent='Transaction Operator';var p=fin.parentElement.querySelector('p');if(p)p.textContent='Payment & Contract Specialist: verifies payment, documents and finance, then prepares contract readiness.';}
   var footer=root.querySelector('.p607-flow-footer span');if(footer)footer.textContent='3 entry channels → eligibility → attendance → one shared queue → Offline: Human Allocator / Online: AI Voice Advisor → exact unit → lock → transaction → contract → property.';
 }
 /* Replace the Allocation Day explainer to make human-vs-AI assistance obvious. */
 function allocationDay(){
   var q=(app.fx.queue&&app.fx.queue.waiting||[]).filter(function(t){return ['WAITING','CALLED','CALL_GRACE','IN_ALLOCATION'].includes(t.state)}).slice().sort(function(a,b){return String(a.registeredAt||'').localeCompare(String(b.registeredAt||''))||Number(a.token)-Number(b.token)});
   var p233=q.find(function(x){return Number(x.token)===233})||{token:233,buyer:'Mona Adel',attendanceMode:'SALES_CENTER',state:'WAITING'};
   var p234=q.find(function(x){return Number(x.token)===234})||{token:234,buyer:'Youssef Nabil',attendanceMode:'ONLINE',state:'WAITING'};
   return '<div class="p607-live"><section class="p607-live-head"><div class="p607-live-card"><small style="font-size:7px;font-weight:950;color:#235fde;letter-spacing:.12em">LIVE ALLOCATION DAY</small><h3>One shared queue. Two assistance modes.</h3><p>#233 and #234 remain in one fair queue. When their turns arrive, Offline buyers receive a Human Allocator; Online buyers receive the AI Voice Allocation Advisor. Both work on the same live inventory and exact-unit lock engine.</p></div><div class="p607-live-rule"><b>Important</b><br>Attendance changes the assistance channel—not queue priority, inventory truth or reservation rules.</div></section><section class="p607-live-card"><h4>Same queue order</h4><div class="p607-queue-demo"><div class="p607-token offline"><strong>#233</strong><span>'+esc(p233.buyer)+'</span><span class="p607-mode offline">OFFLINE / SALES CENTER</span></div><div class="p607-token online"><strong>#234</strong><span>'+esc(p234.buyer)+'</span><span class="p607-mode online">ONLINE</span></div></div><div class="p607-shared-arrow">↓</div><div class="p607-shared-queue"><h4>ONE SHARED QUEUE</h4><p>#233 stays before #234. No separate online queue exists.</p></div></section><section class="p607-live-card"><h4>Service assignment after the shared queue</h4><div class="p607-flow-explain"><div><b>#233 OFFLINE</b><span>Sales Center buyer</span></div><i>→</i><div><b>HUMAN ALLOCATOR</b><span>Helps choose exact unit in person</span></div><i>→</i><div><b>EXACT UNIT</b><span>Same live inventory + lock</span></div></div><div class="p607-flow-explain" style="margin-top:8px"><div><b>#234 ONLINE</b><span>Remote buyer</span></div><i>→</i><div><b>AI VOICE ADVISOR</b><span>Talks, highlights and takes safe actions</span></div><i>→</i><div><b>EXACT UNIT</b><span>Same live inventory + lock</span></div></div></section><section class="p607-live-card"><h4>Role responsibilities</h4><div class="p613-assist-grid"><div class="p613-assist-card human" onclick="rtEnterRole(\'operator\')"><h4>Human Allocator — Offline</h4><p>Works with the buyer at the Sales Center. Explains eligible options and helps choose Master Plan → Building → Floor → Exact Unit. Can hold the selected unit and hand off to Transaction Operator.</p><span class="who">Human role</span></div><div class="p613-assist-card ai" onclick="p612OpenFlowPage(\'buyer\',\'b-site\')"><h4>AI Voice Allocation Advisor — Online</h4><p>Speaks to the buyer, explains the queue and choices, highlights relevant buttons, navigates pages and can take reversible actions. Unit lock and signature still require buyer confirmation.</p><span class="who">AI guided experience</span></div></div></section></div>';
 }
 if(P['m-allocation-live']){P['m-allocation-live'].title='Live Allocation Day';P['m-allocation-live'].nav='Live Allocation Day';P['m-allocation-live'].guide='One shared queue. Offline buyers get a Human Allocator; Online buyers get the AI Voice Allocation Advisor.';P['m-allocation-live'].render=allocationDay;}
 /* Wrap portal/page navigation to keep enhancements mounted. */
 var build=window.rtBuildRolePortal;if(typeof build==='function'){window.rtBuildRolePortal=function(){var r=build.apply(this,arguments);setTimeout(enhanceFlow,0);return r};try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){}}
 var goBase=window.go;if(typeof goBase==='function'){window.go=function(){var r=goBase.apply(this,arguments);setTimeout(mount,40);return r};try{go=window.go}catch(_){}}
 var openBase=window.p612OpenFlowPage;if(typeof openBase==='function'){window.p612OpenFlowPage=function(){var r=openBase.apply(this,arguments);setTimeout(mount,70);return r};window.p607OpenPage=window.p612OpenFlowPage;}
 var roleBase=window.rtEnterRole;if(typeof roleBase==='function'){window.rtEnterRole=function(){var r=roleBase.apply(this,arguments);setTimeout(mount,70);return r};try{rtEnterRole=window.rtEnterRole}catch(_){}}
 setTimeout(function(){enhanceFlow();mount();},120);
})();

(function(){
 if(typeof app==='undefined'||typeof P==='undefined')return;
 function E(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c;});}
 function ar(){return app.lang==='ar'}
 function T(en,egy){return ar()?egy:en}
 function money(n){try{return typeof euro==='function'?euro(n):Number(n||0).toLocaleString()+' EGP'}catch(_){return String(n||0)}}
 function flowExample(title,text,chips){return '<section class="p614-example"><div><small>FLOW EXAMPLE • مثال حي</small><b>'+title+'</b><p>'+text+'</p></div><div class="chips">'+(chips||[]).map(function(x){return '<span>'+x+'</span>'}).join('')+'</div></section>'}
 /* ---------- Flow-linked pages: concrete examples, not empty explanations ---------- */
 var examples={
  'b-eoi':function(){return flowExample('Youssef Nabil • EOI-234','This demo buyer is already identity-verified, EOI-confirmed and eligible for R2-STD / R3-MID. Use the page below to see exactly what makes a buyer ready for allocation.',['Identity ✓','EOI ✓','Docs ✓','R2 / R3 eligible'])},
  'b-allocation-day':function(){return flowExample('#234 ONLINE • Allocation Day','Youssef joins remotely. #233 Mona Adel joins from the Sales Center. Both will enter the same shared queue; attendance changes the assistance channel, not priority.',['#233 Offline','#234 Online','Same queue'])},
  'r-checkin':function(){return flowExample('#233 OFFLINE • Queue Reception','Mona Adel arrives at the Sales Center. Reception finds her buyer record, verifies identity/EOI, checks her into Allocation Day and issues the authoritative queue number.',['Mona Adel','#233','Sales Center'])},
  'b-site':function(){return flowExample('Online selection example • #234','The AI Advisor helps Youssef start from the Master Plan and narrows only to inventory allowed by his EOI. Nothing is reserved until the exact-unit lock succeeds.',['R2-STD','R3-MID','Live inventory'])},
  'b-building':function(){return flowExample('Building choice example','Youssef is comparing eligible buildings using availability, orientation, view and price. The next click should move to a floor—not directly reserve anything.',['Compare','Availability','Price'])},
  'b-floor':function(){return flowExample('Floor choice example','The selected building is now filtered to exact physical options. Sold/held inventory remains unavailable and only eligible choices can continue.',['Floor','Eligible only','Exact inventory'])},
  'b-unit':function(){return flowExample('Exact unit decision','This is where the buyer reviews the actual physical unit, price version, plan, views and specifications before explicitly confirming the lock.',['Exact ID','Price version','Buyer confirms'])},
  'a-handoff':function(){return flowExample('Human Allocator handoff • #233','The offline Allocator has helped Mona choose the exact unit. This page shows the atomic unit lock and the handoff to the Transaction Operator.',['Offline buyer','Exact unit','Lock → handoff'])},
  'b-contract':function(){return flowExample('Exact contract signing','The contract is tied to the selected exact unit and transaction snapshot. Demo sequence: review → OTP → drawn signature → biometric verification → final signature.',['OTP','Signature','Biometric'])}
 };
 Object.keys(examples).forEach(function(id){if(!P[id]||typeof P[id].render!=='function')return;var base=P[id].render;P[id].render=function(){return examples[id]()+base.apply(this,arguments)}});
 /* ---------- My Property: fully working portfolio + detail + installments ---------- */
 app.fx=app.fx||{};app.fx.final6=app.fx.final6||{};
 app.fx.final6.p614PropertyView=app.fx.final6.p614PropertyView||{id:null,tab:'overview'};
 function portfolio(){
   var hist=app.fx.final6.portfolioHistory||[];
   var live=(app.fx.final6.buyerProperties||[]).map(function(p){return Object.assign({},p,{id:p.id||('LIVE-'+(p.tx||p.unit)),segment:typeof p.unit==='number'?'residential':'commercial',label:p.label||(typeof p.unit==='number'?'Uus-Volta 10/3 • Home #'+p.unit:'Commercial • '+p.unit),contract:p.contract||app.fx.contract&&app.fx.contract.id||'CTR-LIVE',nextDue:p.nextDue||'2027-03-01',installment:p.installment||0})});
   var m=new Map();hist.concat(live).forEach(function(p){m.set(String(p.id||p.unit),p)});return Array.from(m.values());
 }
 function propById(id){return portfolio().find(function(p){return String(p.id||p.unit)===String(id)})||portfolio()[0]||null}
 function residentialMeta(p){var u=null;try{if(typeof unit==='function'&&typeof p.unit==='number')u=unit(p.unit)}catch(_){ }return {building:(u&&u.building)||'Uus-Volta 10/3',floor:(u&&u.floor)||4,size:(u&&u.size)||96,terrace:(u&&u.terrace)||12,rooms:(u&&u.rooms)||3,view:(u&&u.view)||'Courtyard / landscape',orientation:(u&&u.orientation)||'South-East'}}
 function commercialMeta(p){var c=null;try{if(typeof commercialById==='function')c=commercialById(String(p.unit))}catch(_){ }return {building:(c&&c.building)||'Mootori 2',floor:(c&&c.floor)||2,size:(c&&c.size)||78.4,use:(c&&c.function)||'Office',frontage:(c&&c.frontage)||'Main circulation',licence:(c&&c.license)||'Office / professional use'}}
 function addMonths(dateStr,m){var d=new Date(dateStr+'T00:00:00');if(isNaN(d))d=new Date(2027,0,1);d.setMonth(d.getMonth()+m);return d.toISOString().slice(0,10)}
 function schedule(p){
   var inst=Number(p.installment||0);if(!inst)inst=Math.max(1,Math.round((Number(p.total||0)-Number(p.paid||0))/12));
   var total=Number(p.total||0),paid=Number(p.paid||0),count=Math.max(6,Math.min(18,Math.ceil(Math.max(0,total-paid)/inst)+3));
   var base=p.nextDue&&p.nextDue!=='—'?p.nextDue:'2027-01-01',rows=[];
   for(var i=0;i<count;i++){var past=i<3,status=past?'PAID':i===3?'NEXT':'UPCOMING',amt=Math.min(inst,total||inst);rows.push({no:i+1,due:addMonths(base,i-3),amount:amt,status:status,receipt:past?'RCT-'+String(p.unit).replace(/\W/g,'')+'-'+String(i+1).padStart(2,'0'):''})}
   return rows;
 }
 function modal(title,body){document.querySelectorAll('.p614-modal').forEach(function(x){x.remove()});var m=document.createElement('div');m.className='p614-modal';m.innerHTML='<div class="p614-modal-card"><div class="p614-modal-head"><b>'+E(title)+'</b><button type="button" aria-label="Close">×</button></div><div class="p614-modal-body">'+body+'</div></div>';document.body.appendChild(m);m.querySelector('button').addEventListener('click',function(){m.remove()});m.addEventListener('click',function(e){if(e.target===m)m.remove()})}
 window.p614ShowDoc=function(id,type){var p=propById(id);if(!p)return;var copy={contract:'Signed Contract '+(p.contract||'CTR-DEMO'),receipt:'Payment Receipt / Proof',id:'Buyer Identity Record',plan:'Unit Plan & Specifications',reservation:'Reservation Confirmation'};modal(copy[type]||'Document','<b>'+E(p.label||p.unit)+'</b><br><br>This is a functional demo document viewer. In production this opens the stored signed PDF / evidence file for this exact property record.<br><br><b>Reference:</b> '+E((p.contract||'CTR-DEMO')+' • '+(p.id||p.unit)))};
 window.p614OpenProperty=function(id,tab){app.fx.final6.p614PropertyView={id:String(id),tab:tab||'overview'};if(typeof render==='function')render()};
 window.p614BackProperties=function(){app.fx.final6.p614PropertyView={id:null,tab:'overview'};if(typeof render==='function')render()};
 window.p614PropertyTab=function(tab){app.fx.final6.p614PropertyView.tab=tab;if(typeof render==='function')render()};
 function propertyCard(p){var id=String(p.id||p.unit),pct=p.total?Math.min(100,Math.round((p.paid||0)/p.total*100)):0,isC=p.segment==='commercial',meta=isC?commercialMeta(p):residentialMeta(p);return '<article class="p614-prop-card" onclick="p614OpenProperty(\''+E(id)+'\',\'overview\')"><span class="p614-prop-status">'+E(p.status||'ACTIVE')+'</span><div class="p614-prop-top"><small>'+(isC?'COMMERCIAL':'RESIDENTIAL')+' PROPERTY</small><h4>'+E(p.label||String(p.unit))+'</h4><p>'+E(meta.building)+' • '+(isC?E(meta.use)+' • '+E(meta.size)+'m²':'Floor '+E(meta.floor)+' • '+E(meta.rooms)+' rooms • '+E(meta.size)+'m²')+'</p></div><div class="p614-prop-body"><div class="payment-progress"><i style="width:'+pct+'%"></i></div><div class="p614-prop-kpis"><div><b>'+money(p.total||0)+'</b><span>Contract value</span></div><div><b>'+pct+'%</b><span>Paid</span></div><div><b>'+E(p.nextDue||'—')+'</b><span>Next due</span></div><div><b>'+money(p.installment||0)+'</b><span>Installment</span></div></div><div class="p614-prop-actions"><button class="primary" onclick="event.stopPropagation();p614OpenProperty(\''+E(id)+'\',\'overview\')">Open Property</button><button onclick="event.stopPropagation();p614OpenProperty(\''+E(id)+'\',\'installments\')">Installments</button><button onclick="event.stopPropagation();p614OpenProperty(\''+E(id)+'\',\'contract\')">Contract</button><button onclick="event.stopPropagation();p614OpenProperty(\''+E(id)+'\',\'documents\')">Documents</button></div></div></article>'}
 function tabs(id,active){return '<div class="p614-tabs">'+[['overview','Overview'],['installments','Installments'],['contract','Contract'],['documents','Documents'],['updates','Updates & Support']].map(function(x){return '<button class="'+(active===x[0]?'active':'')+'" onclick="p614PropertyTab(\''+x[0]+'\')">'+x[1]+'</button>'}).join('')+'</div>'}
 function detail(p,tab){var id=String(p.id||p.unit),isC=p.segment==='commercial',m=isC?commercialMeta(p):residentialMeta(p),pct=p.total?Math.min(100,Math.round((p.paid||0)/p.total*100)):0,rows=schedule(p);var body='';
   if(tab==='overview')body='<div class="p614-detail-grid"><section class="p614-panel"><h4>Property details</h4><div class="p614-facts">'+(isC?'<div class="p614-fact"><span>Building</span><b>'+E(m.building)+'</b></div><div class="p614-fact"><span>Space</span><b>'+E(p.unit)+'</b></div><div class="p614-fact"><span>Use</span><b>'+E(m.use)+'</b></div><div class="p614-fact"><span>Area</span><b>'+E(m.size)+'m²</b></div><div class="p614-fact"><span>Floor</span><b>'+E(m.floor)+'</b></div><div class="p614-fact"><span>Licence</span><b>'+E(m.licence)+'</b></div>':'<div class="p614-fact"><span>Building</span><b>'+E(m.building)+'</b></div><div class="p614-fact"><span>Exact unit</span><b>#'+E(p.unit)+'</b></div><div class="p614-fact"><span>Floor</span><b>'+E(m.floor)+'</b></div><div class="p614-fact"><span>Rooms</span><b>'+E(m.rooms)+'</b></div><div class="p614-fact"><span>Internal area</span><b>'+E(m.size)+'m²</b></div><div class="p614-fact"><span>Terrace</span><b>'+E(m.terrace)+'m²</b></div><div class="p614-fact"><span>View</span><b>'+E(m.view)+'</b></div><div class="p614-fact"><span>Orientation</span><b>'+E(m.orientation)+'</b></div>')+'</div></section><aside class="p614-panel"><h4>Financial snapshot</h4><div class="p614-facts"><div class="p614-fact"><span>Contract value</span><b>'+money(p.total||0)+'</b></div><div class="p614-fact"><span>Paid</span><b>'+money(p.paid||0)+' • '+pct+'%</b></div><div class="p614-fact"><span>Next due</span><b>'+E(p.nextDue||'—')+'</b></div><div class="p614-fact"><span>Next installment</span><b>'+money(p.installment||0)+'</b></div><div class="p614-fact"><span>Contract</span><b>'+E(p.contract||'CTR-DEMO')+'</b></div><div class="p614-fact"><span>Status</span><b>'+E(p.status||'ACTIVE')+'</b></div></div><div class="p614-prop-actions"><button onclick="p614PropertyTab(\'installments\')">View all installments</button><button onclick="p614PropertyTab(\'contract\')">Open signed contract</button></div></aside></div>';
   if(tab==='installments')body='<section class="p614-panel"><h4>Full installment schedule</h4><p style="font-size:7px;color:#667386">Past payments, next due installment and future schedule for this exact property.</p><div style="overflow:auto"><table class="p614-table"><tr><th>#</th><th>Due date</th><th>Amount</th><th>Status</th><th>Receipt</th></tr>'+rows.map(function(r){return '<tr><td>'+r.no+'</td><td>'+r.due+'</td><td>'+money(r.amount)+'</td><td class="'+(r.status==='PAID'?'p614-pay-paid':r.status==='NEXT'?'p614-pay-next':'p614-pay-future')+'">'+r.status+'</td><td>'+(r.receipt?'<button class="p614-back" onclick="p614ShowDoc(\''+E(id)+'\',\'receipt\')">'+E(r.receipt)+'</button>':'—')+'</td></tr>'}).join('')+'</table></div></section>';
   if(tab==='contract')body='<div class="p614-detail-grid"><section class="p614-panel"><h4>Signed contract</h4><div class="p614-facts"><div class="p614-fact"><span>Contract ID</span><b>'+E(p.contract||'CTR-DEMO')+'</b></div><div class="p614-fact"><span>Property</span><b>'+E(p.label||p.unit)+'</b></div><div class="p614-fact"><span>Status</span><b>SIGNED / ACTIVE</b></div><div class="p614-fact"><span>Contract value</span><b>'+money(p.total||0)+'</b></div><div class="p614-fact"><span>Buyer evidence</span><b>OTP + Signature + Biometric receipt</b></div><div class="p614-fact"><span>Audit</span><b>Immutable transaction record</b></div></div><div class="p614-prop-actions"><button class="primary" onclick="p614ShowDoc(\''+E(id)+'\',\'contract\')">View Signed Contract</button></div></section><aside class="p614-panel"><h4>Contract relationship</h4><p style="font-size:7.4px;color:#667386;line-height:1.5">This contract remains linked to the exact physical unit, the price snapshot, payment schedule, signing evidence and future property updates.</p></aside></div>';
   if(tab==='documents')body='<section class="p614-panel"><h4>Property documents</h4><div class="p614-docs">'+[['contract','Signed Contract','Signed and verified'],['reservation','Reservation Confirmation','Booking evidence'],['receipt','Payment Receipts','3 receipts available'],['id','Buyer Identity','Verified at transaction'],['plan','Unit Plan & Specifications','Exact physical unit plan']].map(function(d){return '<div class="p614-doc"><div><b>'+d[1]+'</b><span>'+d[2]+'</span></div><button onclick="p614ShowDoc(\''+E(id)+'\',\''+d[0]+'\')">Open</button></div>'}).join('')+'</div></section>';
   if(tab==='updates')body='<div class="p614-detail-grid"><section class="p614-panel"><h4>Property updates</h4><div class="p614-timeline"><div class="p614-event"><b>Reservation & contract completed</b><span>Exact unit booked and signed contract stored.</span></div><div class="p614-event"><b>Construction progress • 64%</b><span>Structure complete. Current works: MEP and internal finishes.</span></div><div class="p614-event"><b>Next developer update</b><span>Scheduled progress update: 15 Nov 2026.</span></div><div class="p614-event"><b>Estimated handover</b><span>Q4 2027 • subject to developer progress certification.</span></div></div></section><aside class="p614-panel"><h4>Support</h4><p style="font-size:7.3px;color:#667386">Create a property-specific request without losing the property, contract or payment context.</p><div class="p614-prop-actions"><button onclick="typeof toast===\'function\'&&toast(\'Support ticket demo created for '+E(p.label||p.unit).replace(/'/g,"\\'")+'\')">Create Support Ticket</button><button onclick="p614ShowDoc(\''+E(id)+'\',\'plan\')">Open Unit Plan</button></div></aside></div>';
   return '<div class="p614-detail-head"><div><small style="font-size:7px;color:#235fde;font-weight:950;letter-spacing:.1em">MY PROPERTY</small><h3>'+E(p.label||String(p.unit))+'</h3><p>'+(isC?'Commercial property':'Residential property')+' • '+E(p.status||'ACTIVE')+' • Contract '+E(p.contract||'CTR-DEMO')+'</p></div><button class="p614-back" onclick="p614BackProperties()">← All Properties</button></div>'+tabs(id,tab)+body;
 }
 function propertiesPage(){var ps=portfolio(),view=app.fx.final6.p614PropertyView||{id:null,tab:'overview'};if(view.id){var p=propById(view.id);if(p)return detail(p,view.tab||'overview')}
   var total=ps.reduce(function(a,p){return a+Number(p.total||0)},0),paid=ps.reduce(function(a,p){return a+Number(p.paid||0)},0);
   return flowExample('My Property is fully interactive','Open any property to see its exact details, full installment schedule, signed contract, documents, receipts and property updates. Every button below is connected to a working demo view.',['Open property','Installments','Contract','Documents'])+'<div class="section"><h3>'+T('My Properties','عقاراتي')+'</h3><p>'+T('Your residential and commercial purchases stay in one portfolio, but each property keeps its own contract, installments and documents.','كل مشترياتك السكنية والتجارية في مكان واحد، وكل عقار ليه عقده وأقساطه ومستنداته لوحده.')+'</p></div><div class="p614-prop-grid">'+ps.map(propertyCard).join('')+'</div><div class="section"><h3>'+T('Upcoming installments','الأقساط الجاية')+'</h3></div><div class="p614-panel"><table class="p614-table"><tr><th>Property</th><th>Next due</th><th>Amount</th><th>Action</th></tr>'+ps.map(function(p){var id=String(p.id||p.unit);return '<tr><td><b>'+E(p.label||p.unit)+'</b></td><td>'+E(p.nextDue||'—')+'</td><td>'+money(p.installment||0)+'</td><td><button class="p614-back" onclick="p614OpenProperty(\''+E(id)+'\',\'installments\')">View schedule</button></td></tr>'}).join('')+'</table></div><div class="p614-panel" style="margin-top:10px"><b style="font-size:9px">Portfolio summary</b><div class="p614-prop-kpis"><div><b>'+ps.length+'</b><span>Properties</span></div><div><b>'+money(total)+'</b><span>Portfolio value</span></div><div><b>'+money(paid)+'</b><span>Total paid</span></div><div><b>'+(total?Math.round(paid/total*100):0)+'%</b><span>Portfolio paid</span></div></div></div>';
 }
 if(P['b-properties'])P['b-properties'].render=propertiesPage;
 /* ---------- Flow clarity: preserve logic, clarify role ownership ---------- */
 function enhanceFlow(){var root=document.getElementById('rolePortal');if(!root)return;
   var allocation=root.querySelector('.p607-allocation');if(allocation){allocation.innerHTML='<h3>Allocation Assistance</h3><p>Both buyers stay in the same queue. The assistance channel changes only after the turn is called.</p><div class="p613-assist-grid"><div class="p613-assist-card human" onclick="rtEnterRole(\'operator\')"><span class="p607-open">ROLE ↗</span><h4>HUMAN ALLOCATOR • OFFLINE</h4><p>Sales Center buyer: the Allocator explains eligible inventory and helps choose Master Plan → Building → Floor → Exact Unit.</p><span class="who">Human exact-unit assistance</span></div><div class="p613-assist-card ai" onclick="p612OpenFlowPage(\'buyer\',\'b-site\')"><span class="p607-open">OPEN ↗</span><h4>AI ALLOCATION ADVISOR • ONLINE</h4><p>Online buyer: bilingual voice advisor explains options, compares choices, highlights controls and navigates the same exact-unit journey.</p><span class="who">English + Egyptian Arabic • guided actions</span></div></div><div class="p613-merge-note"><b>Same queue → different assistance → same live inventory → same exact-unit lock → same Transaction Operator.</b></div>'}
   var sel=root.querySelector('.p607-select');if(sel&&!sel.querySelector('.p614-flow-owner'))sel.insertAdjacentHTML('beforeend','<span class="p614-flow-owner"><b>Who decides?</b> Buyer chooses the exact unit. Human Allocator / AI Advisor assists. PRENEURA validates and locks inventory.</span>');
   var comp=root.querySelector('.p607-complete');if(comp&&!comp.querySelector('.p614-flow-owner'))comp.insertAdjacentHTML('beforeend','<span class="p614-flow-owner"><b>Who completes?</b> Transaction Operator owns payment, documents and finance readiness. Buyer reviews and signs the exact contract.</span>');
 }
 /* ---------- Bilingual fast advisor: Egyptian Arabic + English, AI-backend ready ---------- */
 app.fx.aiAdvisor614=app.fx.aiAdvisor614||{lang:'auto',voice:false,min:false,listening:false,last:'',greeted:{}};var A=app.fx.aiAdvisor614;
 var advisorPages=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit'];
 function buyer(){try{var id=app.fx.final6.buyerSession.customerId;return (app.fx.rt.registry||[]).find(function(x){return x.customerId===id})||null}catch(_){return null}}
 function advisorContext(){if(!advisorPages.includes(app.page))return false;if(app.__flowDirectPreview)return true;if(app.role!=='buyer')return false;var r=buyer();return !!(r&&String(r.attendanceMode||'').toUpperCase()==='ONLINE')}
 function detectLang(s){if(A.lang==='ar'||A.lang==='en')return A.lang;if(/[\u0600-\u06ff]/.test(String(s||'')))return'ar';if(app.lang==='ar')return'ar';return'en'}
 function guide(page,lang){var r=buyer(),name=r&&r.name?r.name.split(' ')[0]:'',arx={
  'b-allocation-day':'أهلاً '+(name||'بيك')+'، أنا مساعد التخصيص من PRENEURA. إنت داخل أونلاين، وهفضل معاك لحد ما تختار الوحدة المناسبة. أقدر أوضحلك الخطوات وأفتحلك أي جزء من غير ما أغيّر دورك في الطابور.',
  'b-queue':'إنت دلوقتي في نفس الطابور مع عملاء مقر المبيعات. رقمك وترتيبك ثابتين بنفس قواعد الأولوية. لما ييجي دورك هنبدأ اختيار الوحدة سوا.',
  'b-site':'بدأنا الاختيار. بص على الماستر بلان، وأنا أقدر أساعدك تضيق الاختيارات حسب نوع الوحدة والسعر والمكان، وبعدها نفتح المبنى المناسب.',
  'b-building':'اختار المبنى اللي يناسبك. لو محتار قولي مثلاً: «رشحلي الأنسب» أو «ورّيني الأرخص» وأنا أوضح الفرق وأظلل الاختيار على الشاشة.',
  'b-floor':'دلوقتي بنختار الدور. أقدر أوضحلك المتاح والفرق بين الأدوار، وبعد قرارك نروح للوحدة الفعلية.',
  'b-unit':'دي أهم خطوة: الوحدة الفعلية. أقدر أقارنلك الاختيارات وأظلل زر الحجز، لكن قرار قفل الوحدة النهائي لازم يكون منك إنت.'};var enx={
  'b-allocation-day':'Welcome '+(name||'')+'. I am your PRENEURA Allocation Advisor. You are joining online, and I can guide you all the way to the exact unit without changing your queue priority.',
  'b-queue':'You are in the same shared queue as Sales Center buyers. I can explain your position and guide you into unit selection when your turn starts.',
  'b-site':'Selection has started. I can help narrow the Master Plan by eligible type, budget and location, then take you to the best building options.',
  'b-building':'Choose a building. Ask me to compare options, show the lowest price, or highlight the next relevant control.',
  'b-floor':'Now choose the floor. I can explain the trade-offs, highlight available options and take you to exact units.',
  'b-unit':'This is the exact physical unit decision. I can compare and highlight options, but the final unit lock always requires your confirmation.'};return (lang==='ar'?arx[page]:enx[page])||(lang==='ar'?'أنا معاك في خطوة التخصيص دي.':'I am with you on this allocation step.')}
 function updateMessage(text,lang){A.last=text;var el=document.querySelector('.p614-ai-message');if(el){el.textContent=text;el.classList.toggle('ar',lang==='ar')}}
 function voiceFor(lang){var vs=[];try{vs=speechSynthesis.getVoices()}catch(_){ }var pref=lang==='ar'?['ar-EG','ar-SA','ar']:['en-US','en-GB','en'];for(var i=0;i<pref.length;i++){var v=vs.find(function(x){return String(x.lang||'').toLowerCase().startsWith(pref[i].toLowerCase())});if(v)return v}return null}
 function say(text,lang){updateMessage(text,lang);if(!A.voice||!('speechSynthesis'in window))return;try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);u.lang=lang==='ar'?'ar-EG':'en-US';u.rate=lang==='ar'?1.03:1.02;u.pitch=1;var v=voiceFor(lang);if(v)u.voice=v;speechSynthesis.speak(u)}catch(_){}}
 function clearHi(){document.querySelectorAll('.p614-ai-highlight').forEach(function(x){x.classList.remove('p614-ai-highlight')})}
 function visible(el){if(!el)return false;var s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}
 function findAction(words){var c=[].slice.call(document.querySelectorAll('#pageRoot button,#pageRoot a,#pageRoot [onclick]'));return c.find(function(el){if(!visible(el))return false;var t=(el.textContent||'').trim().toLowerCase();return words.some(function(w){return t.includes(w.toLowerCase())})})}
 function hi(words,msg,lang){clearHi();var el=findAction(words);if(el){el.classList.add('p614-ai-highlight');try{el.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})}catch(_){ }say(msg,lang);return true}say(lang==='ar'?'الزر ده مش ظاهر في الشاشة الحالية. أقدر أفتحلك الخطوة الصح بدل كده.':'That control is not visible on this screen. I can open the correct step instead.',lang);return false}
 function nav(page,msg,lang){clearHi();say(msg,lang);setTimeout(function(){if(app.__flowDirectPreview&&typeof p612OpenFlowPage==='function')p612OpenFlowPage('buyer',page);else if(typeof go==='function')go(page)},120)}
 function localAct(raw){var q=String(raw||'').trim(),lang=detectLang(q),l=q.toLowerCase();if(!q)return;
   if(/طابور|رقمي|قدامي|استن|queue|position|waiting/.test(l)){nav('b-queue',lang==='ar'?'هفتحلك الطابور المشترك دلوقتي، وهشرحلك ترتيبك.':'Opening the shared queue and your live position.',lang);return}
   if(/ماستر|مخطط|خريطة|master plan|site plan/.test(l)){nav('b-site',lang==='ar'?'هفتحلك الماستر بلان ونبدأ نضيّق الاختيارات.':'Opening the Master Plan so we can narrow the choices.',lang);return}
   if(/مبنى|عمارة|building/.test(l)){nav('b-building',lang==='ar'?'تمام، هفتح اختيار المبنى.':'Opening building selection.',lang);return}
   if(/طابق|دور العمارة|floor/.test(l)){nav('b-floor',lang==='ar'?'هفتحلك اختيار الدور ونقارن المتاح.':'Opening floor selection so we can compare available options.',lang);return}
   if(/وحدة|شقة|الوحدات|الشقق|exact unit|show units|available units/.test(l)){nav('b-unit',lang==='ar'?'هفتحلك الوحدات الفعلية المتاحة ونقدر نقارنهم واحدة واحدة.':'Opening the available exact units so we can compare them.',lang);return}
   if(/قارن|الفرق|compare|difference/.test(l)){var ok=hi(['compare','details','view','option','unit'],lang==='ar'?'ظللّتلك الجزء اللي نقدر نقارن منه. قولي أهم حاجة عندك: السعر، المساحة، الدور ولا الإطلالة؟':'I highlighted the comparison area. Tell me what matters most: price, area, floor or view?',lang);if(!ok&&app.page!=='b-unit')nav('b-unit',lang==='ar'?'خلينا نروح للوحدات الفعلية عشان المقارنة تبقى مفيدة.':'Let’s open exact units so the comparison is meaningful.',lang);return}
   if(/رشح|أنسب|افضل|أفضل|recommend|best for me/.test(l)){say(lang==='ar'?'أقدر أساعدك تختار من غير ما أقرر مكانك. بالنسبة لملفك الحالي، هنقارن الاختيارات المؤهلة حسب السعر والمساحة والدور والإطلالة. قولي إيه أهم حاجتين بالنسبة لك؟':'I can help you decide without deciding for you. We can compare eligible choices by price, area, floor and view. Tell me your top two priorities.',lang);hi(['compare','unit','details','view'],lang==='ar'?'هظلللك مكان الاختيارات عشان نبدأ.':'I highlighted where we can start comparing.',lang);return}
   if(/احجز|قفل|lock|reserve|book/.test(l)){hi(['lock','reserve','hold'],lang==='ar'?'ظللّتلك زر قفل الوحدة. راجع الوحدة والسعر الأول، وبعدها إنت بنفسك أكد الحجز.':'I highlighted the unit-lock control. Review the unit and price first, then confirm it yourself.',lang);return}
   if(/دفع|سداد|مستند|تمويل|payment|documents|finance/.test(l)){nav('b-paymentdocs',lang==='ar'?'دي مرحلة ما بعد اختيار وقفل الوحدة. هفتحلك الدفع والمستندات.':'Opening Payment & Documents. This stage starts after the exact unit is locked.',lang);return}
   if(/عقد|توقيع|امضي|contract|sign/.test(l)){nav('b-contract',lang==='ar'?'هفتحلك العقد والتوقيع.':'Opening Contract & Sign.',lang);return}
   if(/عقاري|عقاراتي|property|properties|installment|قسط|اقساط|أقساط/.test(l)){nav('b-properties',lang==='ar'?'هفتحلك عقاراتك، وهناك تقدر تشوف كل الأقساط والعقود والمستندات.':'Opening My Properties, including full installment schedules, contracts and documents.',lang);return}
   if(/التالي|next|continue|كمل|كمّل/.test(l)){var el=findAction(['continue','next','open','choose','view','التالي','اختار','افتح']);if(el&&!/lock|reserve|pay|sign|confirm|حجز|دفع|توقيع/.test((el.textContent||'').toLowerCase())){clearHi();el.classList.add('p614-ai-highlight');say(lang==='ar'?'ده أنسب إجراء آمن بعد الخطوة الحالية. ظللتهولك عشان تقرر.':'I highlighted the safest next action. You can decide whether to take it.',lang)}else say(lang==='ar'?'مفيش إجراء تلقائي آمن هنا. قولي عايز تروح لأنهي خطوة.':'There is no safe automatic next action here. Tell me which step you want.',lang);return}
   say(lang==='ar'?'فاهم إنك محتاج مساعدة في الاختيار. قولي ببساطة: «ورّيني الوحدات»، «قارنلي»، «روح للمبنى»، «إيه دوري؟» أو «رشحلي حسب السعر والمساحة».':'I can help with the queue, building, floor, exact units, comparisons, payments, contract and My Property. Try “show units”, “compare options”, or “what should I do next?”.',lang)
 }
 async function smartAct(raw){var q=String(raw||'').trim();if(!q)return;var lang=detectLang(q),endpoint=window.PRENEURA_AI_ENDPOINT;
   if(endpoint&&location.protocol!=='file:'){try{var payload={message:q,language:lang,page:app.page,buyer:buyer(),allowedActions:['navigate','highlight','explain','compare'],pages:advisorPages};var res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(res.ok){var d=await res.json();if(d&&d.reply)say(d.reply,lang);if(d&&d.action){if(d.action.type==='navigate'&&advisorPages.concat(['b-paymentdocs','b-contract','b-properties']).includes(d.action.page))nav(d.action.page,d.reply||'',lang);if(d.action.type==='highlight'&&Array.isArray(d.action.keywords))hi(d.action.keywords,d.reply||'',lang)}return}}catch(_){}}
   localAct(q)
 }
 function rec(){var R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R)return null;var r=new R();r.lang=detectLang('')==='ar'?'ar-EG':'en-US';r.interimResults=false;r.maxAlternatives=1;return r}
 function listen(){var r=rec(),lang=detectLang('');if(!r){say(lang==='ar'?'التعرف على الصوت مش متاح في المتصفح ده. اكتبلي طلبك تحت وأنا هساعدك فوراً.':'Voice recognition is not available in this browser. Type your request below and I will help immediately.',lang);return}A.listening=true;mountAI();r.onresult=function(e){A.listening=false;var t=e.results&&e.results[0]&&e.results[0][0]?e.results[0][0].transcript:'';mountAI();smartAct(t)};r.onerror=function(){A.listening=false;mountAI();say(lang==='ar'?'مسمعتكش بوضوح. جرّب تاني أو اكتبلي.':'I could not hear that clearly. Try again or type your request.',lang)};r.onend=function(){A.listening=false;mountAI()};try{r.start()}catch(_){A.listening=false;mountAI()}}
 function mountAI(){document.querySelectorAll('.p614-advisor').forEach(function(x){x.remove()});if(!advisorContext())return;var lang=detectLang(''),msg=A.last||guide(app.page,lang),box=document.createElement('section');box.className='p614-advisor'+(A.min?' min':'');var backend=!!window.PRENEURA_AI_ENDPOINT&&location.protocol!=='file:';box.innerHTML='<div class="p614-ai-head"><div class="p614-ai-avatar">AI</div><div class="p614-ai-title"><b>PRENEURA Allocation Advisor</b><span>English + مصري • Voice • Guided actions</span><span class="p614-ai-status">'+(backend?'PRO AI BACKEND CONNECTED':'FAST DEMO MODE')+'</span></div><button type="button" class="p614-min">'+(A.min?'▢':'—')+'</button></div><div class="p614-ai-body"><div class="p614-ai-lang"><button data-l="auto" class="'+(A.lang==='auto'?'active':'')+'">Auto</button><button data-l="ar" class="'+(A.lang==='ar'?'active':'')+'">مصري</button><button data-l="en" class="'+(A.lang==='en'?'active':'')+'">English</button></div><div class="p614-ai-message '+(lang==='ar'?'ar':'')+'">'+E(msg)+'</div><div class="p614-ai-actions"><button class="voice p614-voice">'+(A.voice?'🔊 Voice On':'▶ Voice')+'</button><button class="p614-talk">'+(A.listening?'Listening…':'🎙 Talk')+'</button><button class="primary p614-next">'+(lang==='ar'?'إيه الخطوة الجاية؟':'Highlight Next')+'</button><button class="p614-compare">'+(lang==='ar'?'قارنلي':'Compare')+'</button><button class="p614-units">'+(lang==='ar'?'الوحدات':'Exact Units')+'</button></div><form class="p614-ai-form"><input placeholder="'+(lang==='ar'?'قولّي عايز تعمل إيه…':'Ask me what you want to do…')+'"><button type="submit">'+(lang==='ar'?'ابعت':'Send')+'</button></form><div class="p614-ai-foot"><span>'+(backend?'Professional AI model via secure backend':'Fast local intent engine for this standalone demo')+'</span><b>'+(lang==='ar'?'القرار النهائي ليك':'You make the final decision')+'</b></div></div>';document.body.appendChild(box);
   box.querySelector('.p614-min').addEventListener('click',function(){A.min=!A.min;mountAI()});if(A.min)return;
   box.querySelectorAll('.p614-ai-lang button').forEach(function(b){b.addEventListener('click',function(){A.lang=b.dataset.l;A.last='';mountAI();var l=detectLang('');say(guide(app.page,l),l)})});
   box.querySelector('.p614-voice').addEventListener('click',function(){A.voice=!A.voice;if(!A.voice){try{speechSynthesis.cancel()}catch(_){}mountAI()}else{mountAI();var l=detectLang('');say(guide(app.page,l),l)}});box.querySelector('.p614-talk').addEventListener('click',listen);box.querySelector('.p614-next').addEventListener('click',function(){smartAct(lang==='ar'?'إيه الخطوة الجاية؟':'what should I do next')});box.querySelector('.p614-compare').addEventListener('click',function(){smartAct(lang==='ar'?'قارنلي الاختيارات':'compare options')});box.querySelector('.p614-units').addEventListener('click',function(){smartAct(lang==='ar'?'ورّيني الوحدات':'show units')});box.querySelector('form').addEventListener('submit',function(e){e.preventDefault();var i=box.querySelector('input'),v=i.value;i.value='';smartAct(v)});
   if(!A.greeted[app.page]){A.greeted[app.page]=true;A.last=guide(app.page,lang);if(A.voice)setTimeout(function(){say(A.last,lang)},100)}
 }
 window.p614AdvisorAct=smartAct;window.p614MountAdvisor=mountAI;
 /* navigation wrappers keep examples/AI mounted */
 var bld=window.rtBuildRolePortal;if(typeof bld==='function'){window.rtBuildRolePortal=function(){var r=bld.apply(this,arguments);setTimeout(enhanceFlow,0);return r};try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){}}
 var go0=window.go;if(typeof go0==='function'){window.go=function(){var r=go0.apply(this,arguments);setTimeout(mountAI,35);return r};try{go=window.go}catch(_){}}
 var op0=window.p612OpenFlowPage;if(typeof op0==='function'){window.p612OpenFlowPage=function(){var r=op0.apply(this,arguments);setTimeout(mountAI,55);return r};window.p607OpenPage=window.p612OpenFlowPage}
 var role0=window.rtEnterRole;if(typeof role0==='function'){window.rtEnterRole=function(){var r=role0.apply(this,arguments);setTimeout(mountAI,55);return r};try{rtEnterRole=window.rtEnterRole}catch(_){}}
 setTimeout(function(){enhanceFlow();mountAI()},120);
})();
