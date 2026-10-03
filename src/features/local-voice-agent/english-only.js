/* PRENEURA 6.7.1 — English-only live allocation advisor controller. */
(function(){
  'use strict';

  var PRE=window.PRENEURA=window.PRENEURA||{};
  var E=PRE.localVoiceEngine;
  var A=PRE.localVoiceAudio;
  if(!E||!A||typeof app==='undefined')return;

  var S=app.fx.englishVoice67=app.fx.englishVoice67||{
    minimized:false,
    lastMessage:'',
    lastTranscript:'',
    history:[],
    recommendationMode:'balanced',
    recommendations:[],
    guided:{},
    userTouched:false,
    lastPage:null
  };

  /* The retained 6.3 multilingual controller supplies transport/foundation only.
     6.7 owns the active buyer-facing experience. */
  if(app.fx.localVoiceAgent){
    app.fx.localVoiceAgent.autoTour=false;
    app.fx.localVoiceAgent.userTouched=true;
  }
  try{A.stopAudio&&A.stopAudio()}catch(_){ }

  var allocationPages=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit'];

  function page(){return app.page||null}
  function inDirectPreview(){return !!app.__flowDirectPreview}
  function online(){
    if(!allocationPages.includes(page()))return false;
    if(inDirectPreview())return true;
    if(app.role!=='buyer')return false;
    var b=E.currentBuyer&&E.currentBuyer();
    if(!b)return true;
    var m=String(b.attendanceMode||b.attendance||b.channel||'ONLINE').toUpperCase();
    return ['ONLINE','REMOTE','DIGITAL'].includes(m);
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c})}
  function stateClass(){return A.state.listening?'listening':A.state.waiting?'thinking':A.state.speaking?'speaking':'ready'}
  function backend(){
    if(A.state.backend==='checking')return 'Checking local AI…';
    if(A.state.backend==='online')return 'LOCAL AI • CONNECTED';
    return 'BROWSER VOICE • READY';
  }
  function add(role,text){
    S.history.push({role:role,text:String(text||'').slice(0,1200),at:new Date().toISOString()});
    if(S.history.length>30)S.history.splice(0,S.history.length-30);
  }
  function rank(mode){
    S.recommendationMode=mode||S.recommendationMode||'balanced';
    S.recommendations=(E.rank?E.rank(S.recommendationMode):[]).slice(0,3);
    return S.recommendations;
  }
  function context(){
    var c=E.context?E.context(S.recommendationMode,12):{};
    c.language='en-US';
    c.session_id=c.session_id||('en-'+Date.now().toString(36));
    c.recent_dialogue=S.history.slice(-8);
    return c;
  }
  function englishReason(r){
    var x=String(r||'').toLowerCase();
    if(x.includes('ميزان'))return 'within your budget';
    if(x.includes('غرف'))return 'matches your bedroom preference';
    if(x.includes('مساح'))return 'matches your area preference';
    if(x.includes('دور'))return 'matches your preferred floor';
    if(x.includes('إطلال'))return 'matches your preferred view';
    if(x.includes('مبنى'))return 'matches your preferred building';
    if(x.includes('مؤهل'))return 'matches your eligible unit type';
    return String(r||'').replace(/[\u0600-\u06ff]+/g,'').trim()||'strong fit for your profile';
  }
  function summary(u){
    if(!u)return '';
    var x=[u.label||('Unit '+u.id)];
    if(u.building)x.push(String(u.building));
    if(u.floor!==''&&u.floor!=null)x.push('Floor '+u.floor);
    if(u.area!=null)x.push(u.area+' m²');
    if(u.price!=null)x.push(E.money?E.money(u.price):Math.round(u.price).toLocaleString('en-US')+' EGP');
    return x.join(' • ');
  }
  function recHtml(){
    rank();
    if(!S.recommendations.length)return '<div class="p67-message">Available-unit data is not visible yet. I will guide you to the live inventory first.</div>';
    return S.recommendations.map(function(u,i){
      var reasons=(u.reasons||[]).map(englishReason).join(' • ')||'Available and eligible for comparison';
      return '<button type="button" class="p67-rec" data-unit="'+esc(u.id)+'"><span class="p67-rank">'+(i+1)+'</span><span><b>'+esc(u.label||('Unit '+u.id))+'</b><small>'+esc([u.building,u.floor!==''?'Floor '+u.floor:'',u.area!=null?u.area+' m²':''].filter(Boolean).join(' • '))+'</small><em>'+esc(u.price!=null?(E.money?E.money(u.price):u.price+' EGP'):'Price shown on selection')+'</em><i>'+esc(reasons)+'</i></span></button>';
    }).join('');
  }

  function browserSpeak(text){
    return new Promise(function(resolve){
      if(!A.state.voiceOn||!('speechSynthesis' in window)){resolve(false);return}
      try{
        speechSynthesis.cancel();
        var u=new SpeechSynthesisUtterance(text);
        u.lang='en-US';u.rate=.98;u.pitch=1;u.volume=1;
        var vs=speechSynthesis.getVoices();
        var v=vs.find(function(x){return /^en-US$/i.test(x.lang)})||vs.find(function(x){return /^en/i.test(x.lang)});
        if(v)u.voice=v;
        u.onend=function(){A.state.speaking=false;resolve(true)};
        u.onerror=function(){A.state.speaking=false;resolve(false)};
        A.state.speaking=true;
        speechSynthesis.speak(u);
      }catch(_){resolve(false)}
    });
  }
  async function speak(text){
    if(!text)return false;
    if(A.state.backend==='online'){
      try{return await A.speak(text)}catch(_){ }
    }
    return browserSpeak(text);
  }
  function setMessage(text){
    S.lastMessage=String(text||'');
    var el=document.querySelector('.p67-message');
    if(el)el.textContent=S.lastMessage;
  }
  async function say(text,terms){
    setMessage(text);add('assistant',text);mount();
    if(terms&&E.findByTerms){var el=E.findByTerms(terms);if(el)E.focusElement(el,true)}
    await speak(text);mount();
  }
  function focusTop(){rank();if(S.recommendations[0]&&E.focusUnit)E.focusUnit(S.recommendations[0].id)}
  function recommendText(){
    rank();
    if(!S.recommendations.length)return 'I do not have the live unit list on screen yet. I will take you to the exact available units first.';
    var a=S.recommendations[0],b=S.recommendations[1],why=(a.reasons||[]).map(englishReason);
    return 'My strongest current option is '+summary(a)+(why.length?' because it is '+why.join(' and '):'')+'.'+(b?' The next alternative is '+summary(b)+'.':'')+' I will highlight the first option so you can review it before you decide.';
  }

  function applyActions(actions){
    (Array.isArray(actions)?actions:[]).forEach(function(x){
      if(!x||typeof x!=='object')return;
      var t=String(x.type||'').toLowerCase();
      if(t==='navigate'&&E.SAFE_PAGES.includes(x.page)){E.navigate(x.page);return}
      if(t==='highlight_keywords'&&Array.isArray(x.keywords)){var h=E.findByTerms(x.keywords);if(h)E.focusElement(h,true);return}
      if(t==='scroll_to'&&Array.isArray(x.keywords)){var s=E.findByTerms(x.keywords);if(s)E.focusElement(s,false);return}
      if(t==='focus_unit'&&x.unit_id){if(page()==='b-unit')E.focusUnit(x.unit_id);else E.navigate('b-unit');return}
      if(t==='show_recommendations'){rank(x.mode||'balanced');mount();return}
      if(t==='request_lock_confirmation'){var l=E.findByTerms(['lock','reserve','hold','confirm unit']);if(l)E.focusElement(l,true)}
    });
  }

  async function localIntent(q){
    var l=String(q||'').toLowerCase();
    if(/stop voice|mute/.test(l)){A.setVoice(false);setMessage('Voice is off. I can continue with text.');mount();return}
    if(/voice on|turn on voice/.test(l)){A.setVoice(true);await say('Voice is back on. I am with you.');return}
    if(/master plan|site plan|map/.test(l)){await say('I will open the master plan so we can start from the project layout and the currently available buildings.');E.navigate('b-site');return}
    if(/queue|position|turn/.test(l)){await say('I will show your position in the shared allocation queue. Online and Sales Center buyers follow the same priority order.');E.navigate('b-queue');return}
    if(/building/.test(l)){await say('Let us open the building selection. I will focus on the buildings that contain the strongest available options for your profile.');E.navigate('b-building');return}
    if(/floor/.test(l)){await say('I will open the floor selection and compare the available floors against your preferences.');E.navigate('b-floor');return}
    if(/cheap|cheapest|price|budget/.test(l)){rank('price');mount();await say(recommendText());focusTop();return}
    if(/area|size|largest|bigger/.test(l)){rank('area');mount();await say(recommendText());focusTop();return}
    if(/unit|apartment|recommend|best|option/.test(l)){rank('balanced');mount();await say(recommendText());if(page()!=='b-unit')E.navigate('b-unit');else focusTop();return}
    if(/compare|difference/.test(l)){
      rank();
      if(S.recommendations.length>=2){await say('Let me compare the first two options. The first is '+summary(S.recommendations[0])+'. The second is '+summary(S.recommendations[1])+'. Focus on the price, area, floor and view differences before you decide.');E.focusUnit(S.recommendations[0].id)}
      else await say('I need the live unit list first so the comparison is based on actual inventory.');
      return;
    }
    if(/book|reserve|lock|take this/.test(l)){
      var lock=E.findByTerms(['lock','reserve','hold','confirm unit']);
      if(lock)E.focusElement(lock,true);
      await say('I can take you to the reservation step and explain it, but the final unit lock requires your explicit confirmation.');
      return;
    }
    await say('I can guide you through the master plan, buildings, floors and exact available units, then compare the best options by price, area, floor and view. Tell me what matters most to you.');
  }
  async function ask(text){
    text=String(text||'').trim();if(!text)return;
    S.userTouched=true;S.lastTranscript=text;add('user',text);mount();
    if(A.state.backend==='online'){
      try{if(await A.sendText(text))return}catch(_){ }
    }
    await localIntent(text);
  }
  function onTranscript(text){S.lastTranscript=String(text||'');if(S.lastTranscript)add('user',S.lastTranscript);mount()}
  async function onAgent(msg){
    var reply=String(msg.reply||msg.reply_en||msg.reply_ar||'').trim();
    if(reply){setMessage(reply);add('assistant',reply)}
    applyActions(msg.actions);mount();
  }
  function onError(){setMessage('The private local AI is unavailable right now. I will continue with the built-in English guidance so the allocation journey does not stop.');mount()}
  function toggleLive(){
    S.userTouched=true;
    if(A.state.handsFree){A.stopLive();mount();return}
    A.startLive().then(function(){mount()}).catch(function(){setMessage('Microphone permission is required for hands-free voice. You can still type to me.');mount()});
  }
  function pushTalk(){
    S.userTouched=true;
    A.pushToTalk().then(function(){mount()}).catch(function(){setMessage('Microphone permission is required. You can continue by typing.');mount()});
  }
  function openRec(id){
    S.userTouched=true;
    if(page()!=='b-unit'){E.navigate('b-unit');setTimeout(function(){E.focusUnit(id)},500)}
    else E.focusUnit(id);
  }

  function mount(){
    document.querySelectorAll('.p621-agent,.p67-agent').forEach(function(x){x.remove()});
    if(!online())return;
    rank();
    var box=document.createElement('section');
    box.className='p67-agent '+stateClass()+(S.minimized?' min':'');
    box.dir='ltr';
    box.innerHTML='<header class="p67-head"><div class="p67-orb">AI</div><div class="p67-title"><b>Live Allocation Advisor</b><span>English live guidance • inventory-aware</span><small class="'+(A.state.backend==='online'?'ok':'')+'">'+esc(backend())+'</small></div><button class="p67-min" aria-label="Minimize">'+(S.minimized?'▢':'—')+'</button></header><div class="p67-body"><div class="p67-message">'+esc(S.lastMessage||'I will guide you from the master plan to the best available exact unit for your profile.')+'</div><div class="p67-livebar"><span class="p67-dot"></span><div><b>'+(A.state.listening?'Listening…':A.state.waiting?'Reviewing live inventory…':A.state.speaking?'Speaking…':'Ready to help')+'</b><small>'+(S.lastTranscript?'Last heard: '+esc(S.lastTranscript):'I can navigate, scroll, highlight and compare while we talk.')+'</small></div></div><div class="p67-actions"><button class="primary p67-live">'+(A.state.handsFree?'■ Stop Live':'◉ Start Live')+'</button><button class="p67-talk">'+(A.state.listening?'■ Finish':'🎙 Talk')+'</button><button class="p67-best">★ Recommend</button><button class="p67-plan">Master Plan</button><button class="p67-voice">'+(A.state.voiceOn?'🔊 Voice On':'🔇 Voice Off')+'</button></div><section class="p67-recs"><div class="p67-rec-head"><b>Best available now</b><div class="p67-mode"><button data-mode="balanced" class="'+(S.recommendationMode==='balanced'?'active':'')+'">Best fit</button><button data-mode="price" class="'+(S.recommendationMode==='price'?'active':'')+'">Price</button><button data-mode="area" class="'+(S.recommendationMode==='area'?'active':'')+'">Area</button></div></div><div class="p67-rec-list">'+recHtml()+'</div></section><form class="p67-form"><input aria-label="Message the allocation advisor" placeholder="e.g. Show me the best 3 units under my budget"><button type="submit">Send</button></form><div class="p67-footer"><span>Live voice + guided UI</span><b>Final lock and signing stay under your control</b></div></div>';
    document.body.appendChild(box);
    box.querySelector('.p67-min').onclick=function(){S.minimized=!S.minimized;mount()};
    if(S.minimized)return;
    box.querySelector('.p67-live').onclick=toggleLive;
    box.querySelector('.p67-talk').onclick=pushTalk;
    box.querySelector('.p67-best').onclick=function(){ask('Recommend the best available units for me')};
    box.querySelector('.p67-plan').onclick=function(){ask('Take me to the master plan')};
    box.querySelector('.p67-voice').onclick=function(){A.setVoice(!A.state.voiceOn);mount();if(A.state.voiceOn)say('Voice is on. I am ready.')};
    box.querySelectorAll('.p67-mode button').forEach(function(b){
      b.onclick=function(){
        S.recommendationMode=b.dataset.mode;mount();
        ask(b.dataset.mode==='price'?'Sort the best options by price':b.dataset.mode==='area'?'Sort the best options by area':'Show me the best overall fit');
      };
    });
    box.querySelectorAll('.p67-rec').forEach(function(b){b.onclick=function(){openRec(b.dataset.unit)}});
    box.querySelector('.p67-form').onsubmit=function(e){e.preventDefault();var i=box.querySelector('input'),v=i.value.trim();if(!v)return;i.value='';ask(v)};
  }

  function canAutoAdvance(p){
    return !inDirectPreview()&&online()&&!S.userTouched&&page()===p;
  }
  function laterNavigate(from,to,delay){
    setTimeout(function(){if(canAutoAdvance(from))E.navigate(to)},delay);
  }
  function autoGuide(p){
    /* Direct OPEN previews must remain pinned to the exact page selected in
       How It Works. The advisor still renders and can navigate when the user
       explicitly asks, but automatic tour navigation is disabled in preview. */
    if(inDirectPreview()||!online()||S.userTouched||S.guided[p])return;
    S.guided[p]=true;
    if(p==='b-allocation-day'){
      say('Welcome to online allocation. I will stay with you through the full selection journey. I will start with the master plan, then narrow the available buildings, floors and exact units based on your profile. You will always make the final reservation decision.').then(function(){laterNavigate('b-allocation-day','b-site',650)});
    }else if(p==='b-site'){
      say('This is the master plan. I am checking where your strongest eligible options are located. I will take you to the relevant building next.',['building']).then(function(){laterNavigate('b-site','b-building',700)});
    }else if(p==='b-building'){
      rank();var u=S.recommendations[0];
      say(u&&u.building?'The strongest current option is in '+u.building+'. I will open the floor selection for that building.':'I will open the building options that contain eligible inventory.',['building']).then(function(){laterNavigate('b-building','b-floor',700)});
    }else if(p==='b-floor'){
      rank();var f=S.recommendations[0];
      say(f&&f.floor!==''?'The strongest current option is on floor '+f.floor+'. I will now show the exact available units so we can compare them.':'I will now show the exact available units so we can compare them.',['floor']).then(function(){laterNavigate('b-floor','b-unit',700)});
    }else if(p==='b-unit'){
      rank();say(recommendText()).then(function(){if(canAutoAdvance('b-unit'))focusTop()});
    }
  }

  A.setHandlers({onTranscript:onTranscript,onAgent:onAgent,onError:onError,contextProvider:context});
  try{A.health&&A.health()}catch(_){ }

  var oldRender=typeof render==='function'?render:null;
  if(oldRender&&!oldRender.__p67English){
    var wrapped=function(){var r=oldRender.apply(this,arguments);setTimeout(function(){mount();autoGuide(page())},0);return r};
    wrapped.__p67English=true;
    window.render=wrapped;
    try{render=wrapped}catch(_){ }
  }

  setInterval(function(){
    var p=page();
    if(p!==S.lastPage){S.lastPage=p;mount();setTimeout(function(){autoGuide(p)},220)}
    else if(online()&&!document.querySelector('.p67-agent'))mount();
  },500);

  mount();
  setTimeout(function(){autoGuide(page())},250);
  PRE.englishVoice67={state:S,ask:ask,mount:mount,autoGuide:autoGuide};
})();
