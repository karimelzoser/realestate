/* PRENEURA 6.3.0 — local live audio transport: ASR, streaming TTS, VAD and barge-in. */
(function(){
  'use strict';
  var PRE=window.PRENEURA=window.PRENEURA||{};
  var cfg=Object.assign({
    endpoint:window.PRENEURA_LOCAL_VOICE_URL||'http://127.0.0.1:8765',speaker:'Omnia',
    vadThreshold:.026,bargeInThreshold:.052,silenceMs:760
  },window.PRENEURA_LOCAL_VOICE_CONFIG||{});
  var S={backend:'checking',backendInfo:null,websocket:null,websocketReady:false,voiceOn:true,handsFree:false,listening:false,waiting:false,speaking:false,micStream:null,audioContext:null,analyser:null,vadRaf:0,recorder:null,recordStartedAt:0,lastVoiceAt:0,audioSources:[],nextAudioTime:0,pendingTts:[],onState:null,onTranscript:null,onAgent:null,onError:null,contextProvider:null};

  function notify(){if(typeof S.onState==='function')try{S.onState(S)}catch(_){}}
  function endpoint(path){return cfg.endpoint.replace(/\/$/,'')+path}
  function wsUrl(){return cfg.endpoint.replace(/^http:/,'ws:').replace(/^https:/,'wss:').replace(/\/$/,'')+'/ws/voice'}
  function context(){try{return typeof S.contextProvider==='function'?S.contextProvider():{}}catch(_){return {}}}
  function ensureAudioContext(){
    if(!S.audioContext){var C=window.AudioContext||window.webkitAudioContext;if(C)S.audioContext=new C()}
    if(S.audioContext&&S.audioContext.state==='suspended')S.audioContext.resume().catch(function(){});
    return S.audioContext;
  }
  function prime(){try{ensureAudioContext()}catch(_){}return !!S.audioContext}
  function stopAudio(){
    try{speechSynthesis.cancel()}catch(_){ }
    (S.audioSources||[]).forEach(function(src){try{src.stop()}catch(_){}});S.audioSources=[];S.nextAudioTime=0;S.speaking=false;
    var pending=S.pendingTts.splice(0);pending.forEach(function(fn){try{fn(false)}catch(_){}});notify();
  }
  function queuePcm(base64,sampleRate){
    if(!S.voiceOn)return;
    var ctx=ensureAudioContext();if(!ctx)return;
    try{
      var bin=atob(base64),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      var floats=new Float32Array(bytes.buffer),buf=ctx.createBuffer(1,floats.length,Number(sampleRate)||24000);buf.copyToChannel(floats,0);
      var src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);
      var start=Math.max(ctx.currentTime+.02,S.nextAudioTime||0);src.start(start);S.nextAudioTime=start+buf.duration;S.audioSources.push(src);S.speaking=true;notify();
      src.onended=function(){S.audioSources=S.audioSources.filter(function(x){return x!==src});if(!S.audioSources.length&&ctx.currentTime>=S.nextAudioTime-.06){S.speaking=false;S.nextAudioTime=0;notify()}};
    }catch(_){ }
  }
  function browserSpeak(text){
    return new Promise(function(resolve){
      if(!S.voiceOn||!('speechSynthesis'in window)){S.speaking=false;notify();resolve(false);return}
      try{
        speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);u.lang='ar-EG';u.rate=.98;u.pitch=1.01;u.volume=1;
        var vs=speechSynthesis.getVoices(),v=vs.find(function(x){return /^ar-EG$/i.test(x.lang)})||vs.find(function(x){return /^ar/i.test(x.lang)});if(v)u.voice=v;
        u.onend=function(){S.speaking=false;notify();resolve(true)};u.onerror=function(){S.speaking=false;notify();resolve(false)};S.speaking=true;notify();speechSynthesis.speak(u);
      }catch(_){S.speaking=false;notify();resolve(false)}
    });
  }
  async function restTts(text){
    if(S.backend!=='online')return false;
    try{
      var opt={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,speaker:cfg.speaker,language:'ar-EG'})};
      if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)opt.signal=AbortSignal.timeout(30000);
      var r=await fetch(endpoint('/v1/tts'),opt);if(!r.ok)return false;
      var blob=await r.blob(),url=URL.createObjectURL(blob),a=new Audio(url);S.speaking=true;notify();await a.play();
      await new Promise(function(res){a.onended=res;a.onerror=res});URL.revokeObjectURL(url);S.speaking=false;notify();return true;
    }catch(_){S.speaking=false;notify();return false}
  }
  function send(obj){try{if(S.websocketReady&&S.websocket&&S.websocket.readyState===1){S.websocket.send(JSON.stringify(obj));return true}}catch(_){ }return false}
  function handle(msg){
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='status'){S.waiting=msg.state==='thinking'||msg.state==='transcribing';if(msg.state==='speaking')S.speaking=true;notify();return}
    if(msg.type==='transcript'){S.listening=false;S.waiting=true;notify();if(typeof S.onTranscript==='function')S.onTranscript(msg.text||'');return}
    if(msg.type==='agent'){S.waiting=false;S.speaking=!!msg.audio_follows;notify();if(typeof S.onAgent==='function')S.onAgent(msg);return}
    if(msg.type==='audio_chunk'){queuePcm(msg.pcm_f32_b64,msg.sample_rate);return}
    if(msg.type==='audio_end'){S.speaking=false;S.waiting=false;var done=S.pendingTts.shift();if(done)try{done(true)}catch(_){}notify();return}
    if(msg.type==='error'){S.waiting=false;S.listening=false;notify();if(typeof S.onError==='function')S.onError(msg.message||'Local voice error')}
  }
  function connect(){
    if(S.websocketReady&&S.websocket)return Promise.resolve(true);
    return new Promise(function(resolve){
      var settled=false;try{
        var ws=new WebSocket(wsUrl());S.websocket=ws;var tm=setTimeout(function(){if(!settled){settled=true;try{ws.close()}catch(_){}resolve(false)}},2000);
        ws.onopen=function(){clearTimeout(tm);S.websocketReady=true;S.backend='online';notify();if(!settled){settled=true;resolve(true)}};
        ws.onmessage=function(e){try{handle(JSON.parse(e.data))}catch(_){}};
        ws.onclose=function(){S.websocketReady=false;if(S.backend==='online')S.backend='offline';notify()};
        ws.onerror=function(){S.websocketReady=false;if(!settled){clearTimeout(tm);settled=true;resolve(false)}};
      }catch(_){resolve(false)}
    });
  }
  async function health(){
    S.backend='checking';notify();try{var c=new AbortController(),tm=setTimeout(function(){c.abort()},1800),r=await fetch(endpoint('/health'),{cache:'no-store',signal:c.signal});clearTimeout(tm);if(!r.ok)throw 0;S.backendInfo=await r.json();S.backend='online';await connect()}catch(_){S.backend='offline';S.websocketReady=false}notify();return S.backend==='online';
  }
  function streamTts(text){
    if(!S.websocketReady)return Promise.resolve(false);
    return new Promise(function(resolve){
      var done=false,finish=function(ok){if(done)return;done=true;clearTimeout(tm);S.pendingTts=S.pendingTts.filter(function(x){return x!==finish});resolve(ok!==false)},tm=setTimeout(function(){finish(false)},30000);
      S.pendingTts.push(finish);if(!send({type:'tts',text:text,speaker:cfg.speaker}))finish(false);
    });
  }
  async function speak(text){
    text=String(text||'').trim();if(!text)return false;if(!S.voiceOn)return false;prime();
    if(S.websocketReady&&await streamTts(text))return true;
    if(S.backend==='online'&&await restTts(text))return true;
    return browserSpeak(text);
  }
  async function sendText(text){
    text=String(text||'').trim();if(!text)return false;S.waiting=true;notify();if(S.backend==='online'&&!S.websocketReady)await connect();
    if(send({type:'text',text:text,context:context(),speaker:cfg.speaker}))return true;
    return false;
  }
  function blob64(blob){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(String(r.result||'').split(',')[1]||'')};r.onerror=reject;r.readAsDataURL(blob)})}
  async function sendAudio(blob){
    if(!blob||blob.size<300)return false;S.listening=false;S.waiting=true;notify();if(S.backend==='online'&&!S.websocketReady)await connect();
    if(S.websocketReady){try{var b64=await blob64(blob);if(send({type:'audio',audio_b64:b64,mime_type:blob.type||'audio/webm',context:context(),speaker:cfg.speaker}))return true}catch(_){}}
    S.waiting=false;notify();return false;
  }
  function startRecorder(){
    if(!S.micStream||S.recorder||S.waiting)return false;try{
      var types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'],mime=types.find(function(x){return MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(x)})||'',chunks=[];
      var r=new MediaRecorder(S.micStream,mime?{mimeType:mime}:undefined);S.recorder=r;S.recordStartedAt=Date.now();S.listening=true;notify();
      r.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};r.onstop=function(){var b=new Blob(chunks,{type:r.mimeType||'audio/webm'});S.recorder=null;S.listening=false;notify();sendAudio(b)};r.start(180);return true;
    }catch(_){S.recorder=null;S.listening=false;notify();return false}
  }
  function stopRecorder(){try{if(S.recorder&&S.recorder.state!=='inactive')S.recorder.stop()}catch(_){}}
  function vadLoop(){
    if(!S.handsFree||!S.analyser)return;var data=new Uint8Array(S.analyser.fftSize);S.analyser.getByteTimeDomainData(data);var sum=0;for(var i=0;i<data.length;i++){var x=(data[i]-128)/128;sum+=x*x}
    var rms=Math.sqrt(sum/data.length),now=Date.now(),threshold=S.speaking?cfg.bargeInThreshold:cfg.vadThreshold;
    if(rms>threshold){S.lastVoiceAt=now;if(S.speaking)stopAudio();if(!S.recorder&&!S.waiting)startRecorder()}
    if(S.recorder&&now-S.lastVoiceAt>cfg.silenceMs&&now-S.recordStartedAt>420)stopRecorder();S.vadRaf=requestAnimationFrame(vadLoop);
  }
  async function mic(){if(S.micStream)return S.micStream;S.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});return S.micStream}
  async function startLive(){
    if(S.handsFree){stopLive();return false}try{var stream=await mic(),ctx=ensureAudioContext();if(!ctx)throw 0;var src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=1024;an.smoothingTimeConstant=.45;src.connect(an);S.analyser=an;S.handsFree=true;S.lastVoiceAt=Date.now();notify();vadLoop();return true}catch(e){S.handsFree=false;notify();throw e}
  }
  function stopLive(){S.handsFree=false;if(S.vadRaf)cancelAnimationFrame(S.vadRaf);S.vadRaf=0;stopRecorder();if(S.micStream){S.micStream.getTracks().forEach(function(t){t.stop()});S.micStream=null}S.analyser=null;notify()}
  async function pushToTalk(){try{await mic();if(S.listening&&S.recorder){stopRecorder();return true}startRecorder();setTimeout(function(){if(S.recorder)stopRecorder()},9000);return true}catch(e){throw e}}

  PRE.localVoiceAudio={config:cfg,state:S,prime:prime,health:health,connect:connect,speak:speak,sendText:sendText,startLive:startLive,stopLive:stopLive,pushToTalk:pushToTalk,stopAudio:stopAudio,setHandlers:function(h){h=h||{};S.onState=h.onState||S.onState;S.onTranscript=h.onTranscript||S.onTranscript;S.onAgent=h.onAgent||S.onAgent;S.onError=h.onError||S.onError;S.contextProvider=h.contextProvider||S.contextProvider},setVoice:function(on){S.voiceOn=!!on;if(!S.voiceOn)stopAudio();notify()}};
})();
