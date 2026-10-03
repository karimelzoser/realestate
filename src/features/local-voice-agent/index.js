/* PRENEURA 6.3.0 — Egyptian Arabic live allocation agent controller. */
(function(){
  'use strict';
  var PRE=window.PRENEURA=window.PRENEURA||{},E=PRE.localVoiceEngine,A=PRE.localVoiceAudio;
  if(!E||!A)return;
  function appRef(){try{return typeof app!=='undefined'?app:window.app}catch(_){return window.app}}
  var APP=appRef();if(!APP)return;APP.fx=APP.fx||{};
  var cfg=Object.assign({autoTour:true,autoAdvanceSafeChoices:true,maxContextUnits:12},window.PRENEURA_LOCAL_VOICE_CONFIG||{});
  var S=APP.fx.localVoiceAgent=Object.assign({enabled:true,minimized:false,lastMessage:'',lastTranscript:'',history:[],greeted:{},autoTour:cfg.autoTour!==false,userTouched:false,recommendationMode:'balanced',recommendations:[],pendingFocusUnit:null,sessionId:'va-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)},APP.fx.localVoiceAgent||{});
  var allocationPages=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit'];

  function currentPage(){return (appRef()||{}).page||null}
  function onlineContext(){
    var a=appRef();if(!a||!allocationPages.includes(a.page))return false;if(a.__flowDirectPreview)return true;if(a.role!=='buyer')return false;
    var b=E.currentBuyer();if(!b)return true;var mode=String(b.attendanceMode||b.attendance||b.channel||'ONLINE').toUpperCase();return mode==='ONLINE'||mode==='REMOTE'||mode==='DIGITAL';
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c})}
  function addHistory(role,text){S.history.push({role:role,text:String(text||'').slice(0,1000),at:new Date().toISOString()});if(S.history.length>30)S.history.splice(0,S.history.length-30)}
  function setMessage(text){S.lastMessage=String(text||'');var el=document.querySelector('.p621-message');if(el)el.textContent=S.lastMessage}
  function stateClass(){return A.state.listening?'listening':A.state.waiting?'thinking':A.state.speaking?'speaking':'ready'}
  function backendLabel(){if(A.state.backend==='checking')return 'بفحص الـ Local AI…';if(A.state.backend==='online')return 'LOCAL AI • متصل';return 'DEMO FALLBACK • شغّل Local AI للجودة الكاملة'}
  function rank(mode){S.recommendationMode=mode||S.recommendationMode||'balanced';S.recommendations=E.rank(S.recommendationMode).slice(0,3);return S.recommendations}
  function context(){var c=E.context(S.recommendationMode,cfg.maxContextUnits);c.session_id=S.sessionId;c.recent_dialogue=S.history.slice(-8);return c}

  function recHtml(){
    rank();if(!S.recommendations.length)return '<div class="p621-rec-empty">لما بيانات الوحدات المتاحة تبقى ظاهرة هرتبهالك هنا حسب ملفك وميزانيتك.</div>';
    return S.recommendations.map(function(u,i){return '<button type="button" class="p621-rec" data-unit="'+esc(u.id)+'"><span class="rank">#'+(i+1)+'</span><span class="copy"><b>'+esc(u.label)+'</b><small>'+esc([u.building,u.floor!==''?'الدور '+u.floor:'',u.area!=null?u.area+' م²':''].filter(Boolean).join(' • '))+'</small><em>'+esc(u.price!=null?E.money(u.price):'السعر عند الاختيار')+'</em><i>'+esc(u.reasons.join(' • ')||'متاح ومؤهل للمقارنة')+'</i></span></button>'}).join('');
  }
  function renderRecsOnly(){rank();var host=document.querySelector('.p621-rec-list');if(host)host.innerHTML=recHtml()}
  function mount(){
    document.body.classList.add('p621-local-voice-enabled');document.querySelectorAll('.p621-agent').forEach(function(x){x.remove()});if(!onlineContext())return;
    rank();var box=document.createElement('section');box.className='p621-agent '+stateClass()+(S.minimized?' min':'');box.dir='rtl';
    box.innerHTML='<header class="p621-head"><div class="p621-orb"><span></span><span></span><span></span></div><div class="p621-title"><b>مساعد التخصيص الصوتي</b><span>مصري طبيعي • Live guidance • Local models</span><small class="'+(A.state.backend==='online'?'ok':'')+'">'+esc(backendLabel())+'</small></div><button type="button" class="p621-min" aria-label="Minimize">'+(S.minimized?'▢':'—')+'</button></header><div class="p621-body"><div class="p621-message">'+esc(S.lastMessage||'أنا معاك خطوة بخطوة. هنبدأ من الماستر بلان ونوصل لأفضل الوحدات المتاحة ليك.')+'</div><div class="p621-livebar"><span class="dot"></span><b>'+(A.state.listening?'سامعك…':A.state.waiting?'بفكر وبراجع المتاح…':A.state.speaking?'بتكلم معاك…':'جاهز أساعدك')+'</b><small>'+(S.lastTranscript?'آخر حاجة سمعتها: '+esc(S.lastTranscript):'المساعد بيتنقل، يعمل scroll، ويظلل الحاجة اللي بيشرحها')+'</small></div><div class="p621-actions"><button class="primary p621-live">'+(A.state.handsFree?'■ اقفل Live':'◉ ابدأ Live')+'</button><button class="p621-talk">'+(A.state.listening?'■ خلّص كلامك':'🎙 اتكلم')+'</button><button class="p621-best">★ رشحلي</button><button class="p621-plan">الماستر بلان</button><button class="p621-voice">'+(A.state.voiceOn?'🔊 الصوت':'🔇 بدون صوت')+'</button></div><section class="p621-recommendations"><div class="p621-rec-head"><b>أفضل المتاح ليك دلوقتي</b><div><button data-mode="balanced" class="'+(S.recommendationMode==='balanced'?'active':'')+'">أنسب</button><button data-mode="price" class="'+(S.recommendationMode==='price'?'active':'')+'">سعر</button><button data-mode="area" class="'+(S.recommendationMode==='area'?'active':'')+'">مساحة</button></div></div><div class="p621-rec-list">'+recHtml()+'</div></section><form class="p621-form"><input aria-label="اكتب للمساعد" placeholder="مثلاً: وريني أرخص 3 شقق مناسبة ليا"><button type="submit">ابعت</button></form><footer><span>ASR عربي محلي + Agent محلي + صوت مصري محلي</span><b>الحجز والتوقيع النهائي بإيدك</b></footer></div>';
    document.body.appendChild(box);
    box.querySelector('.p621-min').addEventListener('click',function(){S.minimized=!S.minimized;mount()});if(S.minimized)return;
    box.querySelector('.p621-live').addEventListener('click',toggleLive);box.querySelector('.p621-talk').addEventListener('click',pushTalk);box.querySelector('.p621-best').addEventListener('click',function(){ask('رشحلي أفضل الوحدات المتاحة المناسبة ليا')});box.querySelector('.p621-plan').addEventListener('click',function(){ask('خدني للماستر بلان')});
    box.querySelector('.p621-voice').addEventListener('click',function(){A.setVoice(!A.state.voiceOn);mount();if(A.state.voiceOn)say('تمام، الصوت رجع شغال.')});
    box.querySelectorAll('.p621-rec-head button').forEach(function(b){b.addEventListener('click',function(){rank(b.dataset.mode);mount();ask(b.dataset.mode==='price'?'رتبلي المتاح حسب السعر':b.dataset.mode==='area'?'رتبلي المتاح حسب المساحة':'رشحلي الأنسب')})});
    box.querySelectorAll('.p621-rec').forEach(function(b){b.addEventListener('click',function(){openRecommendation(b.dataset.unit)})});
    box.querySelector('.p621-form').addEventListener('submit',function(e){e.preventDefault();var i=box.querySelector('input'),v=i.value.trim();if(!v)return;i.value='';ask(v)});
  }

  async function say(text,opts){text=String(text||'').trim();if(!text)return;setMessage(text);addHistory('assistant',text);if(opts&&opts.terms){var el=E.findByTerms(opts.terms);if(el)E.focusElement(el,true)}mount();await A.speak(text);mount()}
  function recommendSpeech(){
    rank();if(!S.recommendations.length)return 'أنا جاهز أرتبلك الاختيارات، بس بيانات الوحدات المتاحة لسه مش ظاهرة في الحالة الحالية. هنروح للوحدات الفعلية وأنا هقرأ المتاح هناك.';
    var u=S.recommendations[0],two=S.recommendations[1],why=u.reasons.length?' لأنها '+u.reasons.join(' و '):'';
    return 'أقوى اختيار ظاهر لملفك دلوقتي هو '+E.summary(u)+why+'.'+(two?' والبديل اللي بعده '+E.summary(two)+'.':'')+' هظلللك الاختيار الأول وأسيب قرار الحجز النهائي ليك.';
  }
  function applyActions(actions){
    (Array.isArray(actions)?actions:[]).forEach(function(x){if(!x||typeof x!=='object')return;var t=String(x.type||'').toLowerCase();
      if(t==='navigate'&&E.SAFE_PAGES.includes(x.page)){E.navigate(x.page);return}
      if(t==='highlight_keywords'&&Array.isArray(x.keywords)){var h=E.findByTerms(x.keywords);if(h)E.focusElement(h,true);return}
      if(t==='scroll_to'&&Array.isArray(x.keywords)){var s=E.findByTerms(x.keywords);if(s)E.focusElement(s,false);return}
      if(t==='focus_unit'&&x.unit_id){S.pendingFocusUnit=String(x.unit_id);if(currentPage()==='b-unit')E.focusUnit(x.unit_id);else E.navigate('b-unit');return}
      if(t==='show_recommendations'){rank(x.mode||'balanced');renderRecsOnly();return}
      if(t==='request_lock_confirmation'){var l=E.findByTerms(['lock','reserve','hold','حجز','تأكيد']);if(l)E.focusElement(l,true);return}
    });
  }
  function onTranscript(text){S.lastTranscript=String(text||'');if(S.lastTranscript)addHistory('user',S.lastTranscript);mount()}
  function onAgent(msg){var reply=String(msg.reply_ar||msg.reply||'').trim();if(reply){setMessage(reply);addHistory('assistant',reply)}applyActions(msg.actions);mount()}
  function onAudioError(){setMessage('الخدمة الصوتية المحلية وقفت لحظة. هكمل معاك بالوضع السريع من غير ما رحلة التخصيص تقف.');mount()}

  async function ask(text){
    text=String(text||'').trim();if(!text)return;S.lastTranscript=text;addHistory('user',text);mount();
    if(A.state.backend==='online'){var sent=await A.sendText(text);if(sent)return}
    await localIntent(text);
  }
  async function localIntent(q){
    var l=String(q||'').toLowerCase();
    if(/وقف|اسكت|mute|stop voice/.test(l)){A.setVoice(false);setMessage('تمام، هكمل معاك كتابة من غير صوت.');mount();return}
    if(/شغل الصوت|voice on/.test(l)){A.setVoice(true);await say('تمام، الصوت شغال وأنا معاك خطوة بخطوة.');return}
    if(/ماستر|مخطط|خريطة|master plan|site plan/.test(l)){await say('تمام، هنروح للماستر بلان ونبدأ نشوف المتاح المناسب ليك.');E.navigate('b-site');return}
    if(/طابور|رقمي|قدامي|queue|position/.test(l)){await say('هفتحلك الطابور المشترك. ترتيبك واحد سواء أونلاين أو في السيلز سنتر.');E.navigate('b-queue');return}
    if(/مبنى|عمارة|building/.test(l)){await say('هنفتح اختيار المبنى، وأنا هظلللك الأنسب حسب الوحدات المتاحة.');E.navigate('b-building');return}
    if(/دور|طابق|floor/.test(l)){await say('هنشوف الأدوار المتاحة ونقارنهم حسب ملفك.');E.navigate('b-floor');return}
    if(/ارخص|أرخص|سعر|ميزانية|cheap|price|budget/.test(l)){rank('price');renderRecsOnly();await say(recommendSpeech());focusTop();return}
    if(/مساحة|اكبر|أكبر|area|size|large/.test(l)){rank('area');renderRecsOnly();await say(recommendSpeech());focusTop();return}
    if(/وحدة|شقة|الوحدات|الشقق|رشح|أنسب|افضل|أفضل|units|apartment|recommend|best/.test(l)){rank('balanced');renderRecsOnly();await say(recommendSpeech());if(currentPage()!=='b-unit')E.navigate('b-unit');else focusTop();return}
    if(/قارن|الفرق|compare/.test(l)){rank();renderRecsOnly();if(S.recommendations.length>=2){await say('خليني أقارنلك أول اختيارين. الأول '+E.summary(S.recommendations[0])+'. والتاني '+E.summary(S.recommendations[1])+'. ركز معايا في فرق السعر والمساحة والدور.');E.focusUnit(S.recommendations[0].id)}else await say('لازم الوحدات الفعلية تبقى ظاهرة الأول عشان المقارنة تعتمد على بيانات حقيقية.');return}
    if(/احجز|حجز|قفل|lock|reserve|book/.test(l)){var lock=E.findByTerms(['lock','reserve','hold','حجز','تأكيد']);if(lock)E.focusElement(lock,true);await say('أنا أوصلك لخطوة الحجز وأشرحها، لكن قفل الوحدة النهائي لازم إنت تأكده بنفسك بعد مراجعة الوحدة والسعر.');return}
    if(/دفع|سداد|مستند|تمويل|payment|documents|finance/.test(l)){await say('دي مرحلة ما بعد قفل الوحدة. هفتحلك الدفع والمستندات.');E.navigate('b-paymentdocs');return}
    if(/عقد|توقيع|contract|sign/.test(l)){await say('هفتحلك العقد والتوقيع. التوقيع النهائي دايماً بإيدك إنت.');E.navigate('b-contract');return}
    await say('أنا معاك في التخصيص. أقدر أفتح الماستر بلان، أقرأ المتاح، أرشحلك الأنسب، أقارن السعر والمساحة والدور، وأظلللك الحاجة اللي بشرحها. قولي مثلاً: وريني أحسن الوحدات ليا.');
  }
  function focusTop(){if(!S.recommendations.length)return;if(currentPage()==='b-unit')E.focusUnit(S.recommendations[0].id);else{S.pendingFocusUnit=S.recommendations[0].id;E.navigate('b-unit')}}
  async function openRecommendation(id){S.pendingFocusUnit=String(id);if(currentPage()!=='b-unit'){await say('هفتحلك الوحدة دي وأظللها قدامك.');E.navigate('b-unit')}else{E.focusUnit(id);var u=E.units().find(function(x){return x.id===String(id)});if(u)await say('دي '+E.summary(u)+'. بص على التفاصيل اللي ظللتها، ولو تحب أقارنها بالاختيار اللي بعدها قولي قارن.')}}
  async function toggleLive(){if(A.state.handsFree){A.stopLive();mount();return}try{var ok=await A.startLive();mount();if(ok)await say('تمام، وضع المحادثة المباشرة شغال. اتكلم طبيعي، ولو قاطعتني وأنا بتكلم هسكت وأسمعك.')}catch(_){await say('محتاج تسمح للمايك عشان أشغل المحادثة المباشرة. لحد ما تسمح تقدر تكتبلي أو تستخدم زر اتكلم.')}}
  async function pushTalk(){try{await A.pushToTalk();mount()}catch(_){await say('محتاج تسمح للمايك الأول عشان أسمعك.')}}

  function greeting(page){
    rank();var top=S.recommendations[0],g={
      'b-allocation-day':'أهلاً بيك في التخصيص الأونلاين. أنا مساعدك الصوتي، وهفضل معاك لحد ما توصل للوحدة اللي تناسبك. هنبدأ بالماستر بلان، وبعدها هوريك المتاح وأرشحلك أحسن الاختيارات حسب ملفك. أنا أقدر أتنقل في الصفحة وأعمل scroll وأظلل وأشرح، لكن قفل الوحدة النهائي لازم تأكده إنت.',
      'b-queue':'إنت جوه نفس الطابور المشترك مع عملاء السيلز سنتر. فرق القناة بس في المساعدة؛ ترتيبك ومخزون الوحدات واحد.',
      'b-site':'ده الماستر بلان. هراجع الوحدات المتاحة والمؤهلة ليك، وبعدها هنركز على أنسب مبنى ونكمل للدور والوحدة الفعلية.',
      'b-building':top&&top.building?'بناءً على المتاح الحالي، المبنى اللي فيه أقوى اختيار ليك هو '+top.building+'. هظلللك مكانه ونكمل من هناك.':'دلوقتي بنختار المبنى. هركزلك على المباني اللي فيها وحدات مناسبة لملفك.',
      'b-floor':top&&top.floor!==''?'أفضل اختيار حالي عندك موجود في الدور '+top.floor+'. هظلللك الدور ونكمل للوحدة.':'دلوقتي هنقارن الأدوار المتاحة ونوصل للوحدات الفعلية.',
      'b-unit':recommendSpeech()
    };return g[page]||'أنا معاك في رحلة التخصيص.';
  }
  async function autoAdvance(page){
    if(!S.autoTour||!cfg.autoAdvanceSafeChoices||S.userTouched||A.state.listening||A.state.waiting)return;rank();var top=S.recommendations[0];if(!top)return;
    await new Promise(function(r){setTimeout(r,700)});if(currentPage()!==page||S.userTouched)return;
    if(page==='b-building'&&top.building){var b=E.findByTerms([top.building]);if(b){E.focusElement(b,true);await say('ده المبنى اللي فيه الاختيار الأقوى لملفك. هفتحه عشان نكمل للدور.',{terms:[top.building]});await new Promise(function(r){setTimeout(r,350)});E.safeClick(b)}}
    if(page==='b-floor'&&top.floor!==''){var f=E.findByTerms(['floor '+top.floor,'الدور '+top.floor,String(top.floor)]);if(f){E.focusElement(f,true);await say('ده الدور المرتبط بأفضل اختيار حالي. هفتحه عشان نشوف الوحدة نفسها.');await new Promise(function(r){setTimeout(r,350)});E.safeClick(f)}}
  }
  async function onPage(page){
    if(!onlineContext()){mount();return}mount();rank();if(S.pendingFocusUnit&&page==='b-unit')setTimeout(function(){E.focusUnit(S.pendingFocusUnit);S.pendingFocusUnit=null},320);if(S.greeted[page])return;S.greeted[page]=true;
    var text=greeting(page),top=S.recommendations[0];if(page==='b-building'&&top&&top.building)setTimeout(function(){var e=E.findByTerms([top.building]);if(e)E.focusElement(e,true)},300);if(page==='b-floor'&&top&&top.floor!=='')setTimeout(function(){var f=E.findByTerms(['floor '+top.floor,'الدور '+top.floor,String(top.floor)]);if(f)E.focusElement(f,true)},300);if(page==='b-unit'&&top)setTimeout(function(){E.focusUnit(top.id)},380);
    await say(text);
    if(page==='b-allocation-day'&&S.autoTour&&currentPage()===page){await new Promise(function(r){setTimeout(r,600)});if(currentPage()===page&&!S.userTouched){setMessage('هبدأ معاك من الماستر بلان دلوقتي.');mount();E.navigate('b-site')}}else autoAdvance(page);
  }
  function wrap(name,delay){var fn=window[name];if(typeof fn!=='function'||fn.__p621Wrapped)return;function wrapped(){A.prime();var r=fn.apply(this,arguments);setTimeout(function(){mount();onPage(currentPage())},delay||80);return r}wrapped.__p621Wrapped=true;wrapped.__p621Base=fn;window[name]=wrapped;try{if(name==='go')go=wrapped;if(name==='p612OpenFlowPage')p612OpenFlowPage=wrapped;if(name==='rtEnterRole')rtEnterRole=wrapped}catch(_){}}
  function touch(e){if(!e||!e.isTrusted)return;if(e.target&&e.target.closest&&e.target.closest('.p621-agent'))return;S.userTouched=true}
  document.addEventListener('pointerdown',touch,true);

  A.setHandlers({contextProvider:context,onState:mount,onTranscript:onTranscript,onAgent:onAgent,onError:onAudioError});
  PRE.voiceAgent={state:S,audio:A.state,mount:mount,startLive:A.startLive,stopLive:A.stopLive,ask:ask,speak:say,navigate:E.navigate,recommend:function(mode){rank(mode||'balanced');mount();return S.recommendations.slice()},context:context,health:A.health};
  window.p621VoiceAgent=PRE.voiceAgent;
  wrap('go',70);wrap('p612OpenFlowPage',90);wrap('rtEnterRole',90);
  setTimeout(async function(){mount();await A.health();mount();if(onlineContext())onPage(currentPage())},140);
})();
