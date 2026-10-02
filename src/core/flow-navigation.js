// extracted from rev611-stable-home-navigation-script
(function(){
  function showHowItWorks(){
    try{
      if(typeof rtShowPortal==='function'){
        rtShowPortal();
        return false;
      }
      if(typeof rtBuildRolePortal==='function'){
        var appEl=document.getElementById('app');
        var landing=document.getElementById('landing');
        var guide=document.getElementById('guide');
        if(appEl)appEl.classList.add('hidden');
        if(landing)landing.classList.add('hidden');
        if(guide)guide.classList.add('hidden');
        rtBuildRolePortal();
        window.scrollTo(0,0);
      }
    }catch(e){
      console.error('How It Works navigation failed',e);
    }
    return false;
  }

  window.p611ShowHowItWorks=showHowItWorks;
  window.showProjectHomepage=showHowItWorks;

  function relabelHomeControls(){
    var buttons=document.querySelectorAll('button');
    for(var i=0;i<buttons.length;i++){
      var btn=buttons[i];
      var txt=(btn.textContent||'').trim();
      var lower=txt.toLowerCase();
      if(lower==='project home' || lower==='← back to project homepage' || lower==='← back to project website'){
        btn.textContent='How It Works';
        btn.title='Back to How PRENEURA Works';
        btn.setAttribute('data-how-it-works','1');
        btn.onclick=function(e){if(e){e.preventDefault();e.stopPropagation();}return showHowItWorks();};
      }
    }
    var back=document.getElementById('backLanding');
    if(back){
      if((back.textContent||'').trim()!=='← How It Works') back.textContent='← How It Works';
      back.title='Back to How PRENEURA Works';
      back.onclick=function(e){if(e)e.preventDefault();return showHowItWorks();};
    }
  }

  /* Relabel only after known app navigation events. No DOM observer, so there is no render loop. */
  var portal=window.rtBuildRolePortal;
  if(typeof portal==='function'){
    window.rtBuildRolePortal=function(){
      var r=portal.apply(this,arguments);
      setTimeout(relabelHomeControls,0);
      return r;
    };
    try{rtBuildRolePortal=window.rtBuildRolePortal}catch(_){ }
  }

  var enter=window.rtEnterRole;
  if(typeof enter==='function'){
    window.rtEnterRole=function(){
      var r=enter.apply(this,arguments);
      setTimeout(relabelHomeControls,0);
      return r;
    };
    try{rtEnterRole=window.rtEnterRole}catch(_){ }
  }

  if(typeof window.go==='function'){
    var goBase=window.go;
    window.go=function(){
      var r=goBase.apply(this,arguments);
      setTimeout(relabelHomeControls,0);
      return r;
    };
    try{go=window.go}catch(_){ }
  }

  setTimeout(relabelHomeControls,60);
})();
