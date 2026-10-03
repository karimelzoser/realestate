/* PRENEURA 6.3.0 — local voice lifecycle guard.
   A click used to enter Online Allocation must not count as buyer interaction
   inside the allocation journey itself. This keeps the first guided tour active. */
(function(){
  'use strict';
  var PRE=window.PRENEURA=window.PRENEURA||{};
  var pages=['b-allocation-day','b-queue','b-site','b-building','b-floor','b-unit'];

  function page(){try{return window.app&&app.page||null}catch(_){return null}}
  function resetOnEntry(before){
    var V=PRE.voiceAgent;if(!V||!V.state)return;
    var after=page();
    if(!pages.includes(before)&&pages.includes(after))V.state.userTouched=false;
  }
  function wrap(name){
    var fn=window[name];if(typeof fn!=='function'||fn.__p621EntryGuard)return;
    function guarded(){var before=page(),r=fn.apply(this,arguments);resetOnEntry(before);return r}
    guarded.__p621EntryGuard=true;guarded.__p621EntryGuardBase=fn;window[name]=guarded;
    try{if(name==='go')go=guarded;if(name==='p612OpenFlowPage')p612OpenFlowPage=guarded;if(name==='rtEnterRole')rtEnterRole=guarded}catch(_){ }
  }
  wrap('go');wrap('p612OpenFlowPage');wrap('rtEnterRole');
})();
