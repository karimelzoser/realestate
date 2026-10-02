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
 var roleBase=window.rtEnterRole;if(typeof roleBase==='function'){window.rtEnterRole=function(){var r=roleBase.apply(this,arguments);setTimeout(mount,70);return r};try{rtEnterRole=window.rtEnterRole}catch(_){}}
 setTimeout(function(){enhanceFlow();mount();},120);
})();
