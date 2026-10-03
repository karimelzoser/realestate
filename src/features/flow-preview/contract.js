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

  // OPEN preview convenience: keep the real signature canvas fully interactive,
  // but also provide a deterministic demo signature action so a presentation or
  // automated QA run cannot dead-end on pointer-device differences.
  window.p620CaptureDemoSignature=function(){
    if(!app.__flowDirectPreview)return;
    var c=document.getElementById('r52SignatureCanvas');
    if(!c||!app.fx||!app.fx.final6||!app.fx.final6.signing)return;
    var ctx=c.getContext('2d');
    if(ctx){
      ctx.clearRect(0,0,c.width,c.height);
      ctx.lineWidth=3;
      ctx.lineCap='round';
      ctx.strokeStyle='#17202d';
      ctx.beginPath();
      ctx.moveTo(70,115);
      ctx.bezierCurveTo(150,40,205,150,280,88);
      ctx.bezierCurveTo(350,34,430,145,520,72);
      ctx.bezierCurveTo(565,38,610,103,660,65);
      ctx.stroke();
    }
    app.fx.final6.signing.hasStroke=true;
    app.fx.final6.signing.signatureAt=typeof fxNow==='function'?fxNow():new Date().toISOString();
    if(typeof toast==='function')toast('Demo signature captured. Continue with biometric verification.');
    if(typeof render==='function')render();
  };

  function ensurePreviewSignatureAction(){
    if(!app.__flowDirectPreview||app.page!=='b-contract'||!app.fx?.contract?.otpVerified)return;
    var canvas=document.getElementById('r52SignatureCanvas');
    if(!canvas||document.getElementById('p620DemoSignatureBtn'))return;
    var sigpad=canvas.closest('.r52-sigpad')||canvas.parentElement;
    if(!sigpad)return;
    var actions=sigpad.nextElementSibling;
    if(!actions||!actions.classList||!actions.classList.contains('fx-actions')){
      actions=document.createElement('div');
      actions.className='fx-actions';
      sigpad.insertAdjacentElement('afterend',actions);
    }
    var btn=document.createElement('button');
    btn.type='button';
    btn.id='p620DemoSignatureBtn';
    btn.className='btn';
    btn.textContent='Use Demo Signature';
    btn.addEventListener('click',window.p620CaptureDemoSignature);
    actions.appendChild(btn);
  }

  // The contract page rerenders after Generate, OTP, biometric and helper actions.
  // Observe those DOM changes and keep the preview-only helper available.
  var observer=new MutationObserver(function(){ensurePreviewSignatureAction()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(ensurePreviewSignatureAction,0);
})();
