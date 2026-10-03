/* PRENEURA 6.3.0 — authoritative local allocation recommendation/navigation engine. */
(function(){
  'use strict';
  var PRE=window.PRENEURA=window.PRENEURA||{};
  function appRef(){try{return typeof app!=='undefined'?app:window.app}catch(_){return window.app}}
  function state(){return PRE.state||{}}
  function first(o,keys){for(var i=0;i<keys.length;i++){if(o&&o[keys[i]]!=null&&o[keys[i]]!=='')return o[keys[i]]}return null}
  function num(v){if(v==null||v==='')return null;if(typeof v==='number'&&isFinite(v))return v;var n=Number(String(v).replace(/[^0-9.\-]/g,''));return isFinite(n)?n:null}
  function currentBuyer(){try{return state().currentBuyer?state().currentBuyer():null}catch(_){return null}}
  function buyerSession(){try{return state().buyerSession?state().buyerSession():null}catch(_){return null}}

  var SAFE_PAGES=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit','b-paymentdocs','b-contract','b-properties'];
  var IRREVERSIBLE=/\b(lock|reserve|book|pay|sign|submit|confirm|cancel|delete)\b|احجز|حجز|قفل|ادفع|دفع|وقّع|وقع|تأكيد|الغاء|إلغاء/i;

  function normalizeUnit(u,index){
    if(!u||typeof u!=='object')return null;
    var id=first(u,['id','unitId','unit_id','code','unitCode','number','unit','name'])||('unit-'+index);
    var label=first(u,['label','name','code','unitCode','unit_code','number'])||('Unit '+id);
    var status=String(first(u,['status','availability','state','inventoryStatus'])||'AVAILABLE').toUpperCase();
    var explicit=first(u,['available','isAvailable','is_available']);
    return {
      raw:u,id:String(id),label:String(label),
      building:String(first(u,['building','buildingName','building_name','block','tower','phase'])||''),
      floor:first(u,['floor','floorNo','floor_no','level'])==null?'':String(first(u,['floor','floorNo','floor_no','level'])),
      area:num(first(u,['area','size','sqm','netArea','grossArea','builtUpArea'])),
      price:num(first(u,['price','currentPrice','current_price','totalPrice','listPrice','amount'])),
      rooms:num(first(u,['bedrooms','beds','rooms','roomCount'])),
      view:String(first(u,['view','orientation','exposure','vista'])||''),
      type:String(first(u,['type','unitType','unit_type','productType','product_type','category'])||''),
      status:status,
      available:explicit===false?false:!/(SOLD|RESERVED|LOCKED|UNAVAILABLE|CANCELLED|BLOCKED)/.test(status),
      score:0,reasons:[]
    };
  }
  function units(){
    var raw=[];try{raw=state().units?state().units():[]}catch(_){raw=[]}
    return (raw||[]).map(normalizeUnit).filter(Boolean);
  }
  function preferences(){
    var b=currentBuyer()||{},s=buyerSession()||{},p=b.preferences||b.preference||s.preferences||{};
    var eligible=b.eligible||b.eligibleTypes||s.eligible||[];if(typeof eligible==='string')eligible=[eligible];
    return {
      budgetMax:num(first(p,['budgetMax','maxBudget','budget','priceMax'])||first(b,['budgetMax','maxBudget','budget'])||first(s,['budgetMax','maxBudget','budget'])),
      budgetMin:num(first(p,['budgetMin','minBudget','priceMin'])),
      rooms:num(first(p,['bedrooms','rooms','beds'])||first(b,['bedrooms','rooms'])),
      minArea:num(first(p,['minArea','areaMin','sizeMin'])),maxArea:num(first(p,['maxArea','areaMax','sizeMax'])),
      preferredFloor:num(first(p,['floor','preferredFloor','floorPreference'])),
      preferredView:String(first(p,['view','preferredView','orientation'])||''),
      preferredBuilding:String(first(p,['building','preferredBuilding'])||''),
      eligible:(eligible||[]).map(function(x){return String(x).toLowerCase()})
    };
  }
  function rank(mode){
    var pref=preferences(),list=units().filter(function(u){return u.available});
    list.forEach(function(u){
      var s=10,r=[];
      if(pref.eligible.length){var hay=(u.type+' '+u.label).toLowerCase();if(pref.eligible.some(function(x){return hay.includes(x)})){s+=26;r.push('مطابقة لنوع الوحدة المؤهل ليك')}else{s-=18}}
      if(pref.budgetMax&&u.price!=null){if(u.price<=pref.budgetMax){s+=22;r.push('داخل ميزانيتك')}else{s-=Math.min(30,Math.round((u.price-pref.budgetMax)/Math.max(pref.budgetMax,1)*100))}}
      if(pref.budgetMin&&u.price!=null&&u.price>=pref.budgetMin)s+=3;
      if(pref.rooms&&u.rooms!=null){var d=Math.abs(u.rooms-pref.rooms);s+=Math.max(0,16-d*8);if(d===0)r.push('عدد الغرف مناسب')}
      if(pref.minArea&&u.area!=null){if(u.area>=pref.minArea){s+=10;r.push('المساحة مناسبة')}else{s-=10}}
      if(pref.maxArea&&u.area!=null&&u.area<=pref.maxArea)s+=4;
      if(pref.preferredFloor!=null&&u.floor!==''){var fd=Math.abs(Number(u.floor)-pref.preferredFloor);if(isFinite(fd)){s+=Math.max(0,9-fd*3);if(fd===0)r.push('الدور المفضل')}}
      if(pref.preferredView&&u.view.toLowerCase().includes(pref.preferredView.toLowerCase())){s+=9;r.push('الإطلالة اللي طلبتها')}
      if(pref.preferredBuilding&&u.building.toLowerCase().includes(pref.preferredBuilding.toLowerCase())){s+=8;r.push('المبنى المفضل')}
      if(mode==='price'&&u.price!=null)s+=Math.max(0,24-Math.round(u.price/1000000));
      if(mode==='area'&&u.area!=null)s+=Math.min(24,Math.round(u.area/8));
      if(mode==='floor'&&u.floor!=='')s+=Math.max(0,12-Number(u.floor));
      u.score=s;u.reasons=r.slice(0,3);
    });
    list.sort(function(a,b){if(b.score!==a.score)return b.score-a.score;if(a.price!=null&&b.price!=null)return a.price-b.price;return String(a.id).localeCompare(String(b.id))});
    return list;
  }
  function money(v){return v==null?'—':Math.round(v).toLocaleString('en-US')+' EGP'}
  function summary(u){if(!u)return '';var x=[u.label];if(u.building)x.push(u.building);if(u.floor!=='')x.push('الدور '+u.floor);if(u.area!=null)x.push(u.area+' م²');if(u.price!=null)x.push(money(u.price));return x.join(' • ')}

  function visible(el){if(!el)return false;try{var st=getComputedStyle(el),r=el.getBoundingClientRect();return st.display!=='none'&&st.visibility!=='hidden'&&r.width>0&&r.height>0}catch(_){return false}}
  function controls(){return [].slice.call(document.querySelectorAll('#pageRoot button,#pageRoot a,#pageRoot [onclick],#pageRoot article,#pageRoot .card,#pageRoot [data-unit-id],#pageRoot [data-unit],#pageRoot [data-id]')).filter(visible)}
  function findByTerms(terms){
    var ts=(terms||[]).map(function(x){return String(x||'').trim().toLowerCase()}).filter(Boolean),best=null,bestScore=0;
    if(!ts.length)return null;
    controls().forEach(function(el){var text=(el.textContent||'').trim().toLowerCase(),score=0;ts.forEach(function(t){if(text===t)score+=7;else if(text.includes(t))score+=2});if(score>bestScore){best=el;bestScore=score}});
    return best;
  }
  function clearHighlight(){document.querySelectorAll('.p621-highlight,.p621-speaking-about').forEach(function(el){el.classList.remove('p621-highlight','p621-speaking-about')})}
  function focusElement(el,speaking){if(!el)return false;clearHighlight();el.classList.add('p621-highlight');if(speaking)el.classList.add('p621-speaking-about');try{el.scrollIntoView({behavior:'smooth',block:'center',inline:'center'})}catch(_){try{el.scrollIntoView()}catch(__){}}return true}
  function focusUnit(id){var u=units().find(function(x){return String(x.id)===String(id)||String(x.label).toLowerCase()===String(id).toLowerCase()});if(!u)return false;var el=findByTerms([u.label,u.id,u.building&&u.building+' '+u.floor]);return el?focusElement(el,true):false}
  function safeClick(el){if(!el||!visible(el)||IRREVERSIBLE.test((el.textContent||'').trim()))return false;try{el.click();return true}catch(_){return false}}
  function navigate(page){
    if(!SAFE_PAGES.includes(page))return false;
    var a=appRef();try{if(a&&a.__flowDirectPreview&&typeof window.p612OpenFlowPage==='function')window.p612OpenFlowPage('buyer',page);else if(typeof window.go==='function')window.go(page);else return false;return true}catch(_){return false}
  }
  function visibleLabels(){return controls().map(function(el){return (el.textContent||'').trim().replace(/\s+/g,' ').slice(0,100)}).filter(Boolean).slice(0,30)}
  function context(mode,maxUnits){
    var pref=preferences(),b=currentBuyer()||{},s=buyerSession()||{},token=first(b,['queueToken','token','queueNo','queueNumber'])||first(s,['queueToken','token','queueNo']);
    return {
      page:(appRef()||{}).page||null,role:(appRef()||{}).role||null,language:'ar-EG',attendance:'ONLINE',
      buyer:{queue_token:token||null,eligible_types:pref.eligible,budget_max:pref.budgetMax,rooms:pref.rooms,min_area:pref.minArea,max_area:pref.maxArea,preferred_floor:pref.preferredFloor,preferred_view:pref.preferredView,preferred_building:pref.preferredBuilding},
      available_units:rank(mode||'balanced').slice(0,maxUnits||12).map(function(u){return {id:u.id,label:u.label,building:u.building,floor:u.floor,area:u.area,price:u.price,rooms:u.rooms,view:u.view,type:u.type,status:u.status,score:u.score,reasons:u.reasons}}),
      visible_controls:visibleLabels()
    };
  }

  PRE.localVoiceEngine={SAFE_PAGES:SAFE_PAGES,IRREVERSIBLE:IRREVERSIBLE,units:units,preferences:preferences,rank:rank,summary:summary,money:money,findByTerms:findByTerms,focusElement:focusElement,focusUnit:focusUnit,clearHighlight:clearHighlight,safeClick:safeClick,navigate:navigate,context:context,currentBuyer:currentBuyer,buyerSession:buyerSession};
})();
