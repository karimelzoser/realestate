// PRENEURA 6.2.1 — contract preview compatibility with the final smart-contract engine.
(function(){
  if(typeof app==='undefined')return;

  var original=window.f6GenerateBuyerContract;
  if(typeof original!=='function')return;

  window.f6GenerateBuyerContract=function(){
    // Direct flow previews must use the latest deterministic generator used by
    // the final smart-contract UI. Real ROLE workflows keep their original path.
    if(app.__flowDirectPreview&&typeof window.r54GenerateContract==='function'){
      return window.r54GenerateContract();
    }
    return original.apply(this,arguments);
  };

  // Inline onclick handlers resolve the global binding. Keep the legacy symbol
  // aligned with window.f6GenerateBuyerContract where the browser permits it.
  try{f6GenerateBuyerContract=window.f6GenerateBuyerContract}catch(_){ }
})();
