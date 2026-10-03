/* PRENEURA 6.7.1 — presentation-safe English advisor labels. */
(function(){
  'use strict';
  if(window.__PRENEURA671_VOICE_POLISH)return;window.__PRENEURA671_VOICE_POLISH=true;

  function polish(){
    try{
      /* Active 6.7 advisor labels. */
      var badge=document.querySelector('.p67-title small');
      if(badge&&/BROWSER VOICE/i.test(badge.textContent||'')){
        badge.textContent='BROWSER VOICE • READY';
        badge.title='The English browser voice fallback keeps the guided allocation journey available when the private local AI runtime is offline.';
      }

      /* The Metro source predates 6.7 and may still contain the old bilingual
         description. Keep the visible presentation consistent with the active
         English-only release without changing flow geometry. */
      var ai=document.querySelector('.p616-ai');
      if(ai){
        var copy=ai.querySelector('p');
        if(copy)copy.textContent='English live allocation advisor guides the Online buyer, explains choices, compares available units, highlights controls and performs safe navigation actions.';
        var tags=ai.querySelector('.p616-tags');
        if(tags)tags.innerHTML='<span>Voice</span><span>English live</span><span>Guided actions</span>';
      }
    }catch(_){ }
  }

  polish();
  setInterval(polish,800);
})();
