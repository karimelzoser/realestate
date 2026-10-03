/* PRENEURA 6.6 — presentation-safe voice fallback labels. */
(function(){
  'use strict';
  if(window.__PRENEURA66_VOICE_POLISH)return;window.__PRENEURA66_VOICE_POLISH=true;
  function polish(){
    try{
      var badge=document.querySelector('.p621-title small');
      if(badge&&/DEMO FALLBACK/i.test(badge.textContent||'')){badge.textContent='BROWSER VOICE • جاهز للعرض';badge.title='Local Egyptian AI automatically takes over when the private inference service is connected.'}
      var footer=document.querySelector('.p621-agent footer span');
      if(footer&&badge&&/BROWSER VOICE/.test(badge.textContent||''))footer.textContent='إرشاد مباشر + صوت المتصفح • Local Egyptian AI عند الاتصال';
    }catch(_){ }
  }
  polish();setInterval(polish,800);
})();
