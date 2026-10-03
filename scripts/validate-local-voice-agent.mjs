import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const entry=read('index.html');
const engine=read('src/features/local-voice-agent/engine.js');
const audio=read('src/features/local-voice-agent/audio.js');
const controller=read('src/features/local-voice-agent/index.js');
const lifecycle=read('src/features/local-voice-agent/lifecycle.js');
const css=read('src/features/local-voice-agent/index.css');
const legacyServer=read('local_voice_agent/server.py');
const englishController=read('src/features/local-voice-agent/english-only.js');
const englishServer=read('local_voice_agent/server67.py');
const model=read('src/core/product-model.js');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}
function mustNot(text,needle,label){if(text.includes(needle))fail.push(label||('Unexpected '+needle));}

for(const asset of [
  'src/features/local-voice-agent/index.css',
  'src/features/local-voice-agent/engine.js',
  'src/features/local-voice-agent/audio.js',
  'src/features/local-voice-agent/index.js',
  'src/features/local-voice-agent/lifecycle.js',
  'src/features/local-voice-agent/english-only.js'
]) must(entry,asset,'Root entry does not load '+asset);

// Shared local-voice foundation retained for inventory-aware navigation, VAD,
// barge-in, streaming transport and future multilingual re-enablement.
for(const marker of ['normalizeUnit','rank','focusUnit','safeClick','IRREVERSIBLE','available_units']) must(engine,marker,'Voice engine missing '+marker);
for(const marker of ['startLive','bargeInThreshold','vadLoop','streamTts','audio_chunk','sendAudio','prime']) must(audio,marker,'Live audio layer missing '+marker);
for(const page of ['b-allocation-day','b-site','b-building','b-floor','b-unit']) must(controller,"'"+page+"'",'Voice journey foundation missing '+page);
for(const marker of ['resetOnEntry','userTouched=false','p621EntryGuard']) must(lifecycle,marker,'Voice lifecycle guard missing '+marker);
mustNot(controller,'new MutationObserver','Local voice foundation must not add a broad MutationObserver');
mustNot(audio,'new MutationObserver','Audio feature must not add a broad MutationObserver');
mustNot(lifecycle,'new MutationObserver','Voice lifecycle feature must not add a broad MutationObserver');

// The legacy Egyptian stack remains intentionally available in the repository,
// but it is not the active buyer-facing conversation contract in 6.7.
for(const marker of [
  'CohereLabs/cohere-transcribe-arabic-07-2026',
  'Qwen/Qwen3-30B-A3B-Instruct-2507',
  'mohammedaly22/VoiceTut-TTS',
  'SAFE_ACTIONS',
  'IRREVERSIBLE_ACTION_WORDS',
  'request_lock_confirmation',
  'stream_tts'
]) must(legacyServer,marker,'Retained local voice foundation missing '+marker);

// Active 6.7 English layer.
for(const marker of ['Live Allocation Advisor','English live guidance',"c.language='en-US'",'Best available now','Final lock and signing stay under your control']) must(englishController,marker,'Active English voice layer missing '+marker);
for(const marker of ['English only for this release','Never answer in Arabic','Systran/faster-whisper-large-v3-turbo','_transcribe_english','_run_agent_english']) must(englishServer,marker,'Active 6.7 English runtime missing '+marker);
mustNot(englishController,'new MutationObserver','English voice layer must not add a broad MutationObserver');

for(const marker of ['localStack','FULL_DUPLEX_LOCAL','scroll-follow','show-ranked-units','barge-in-live-turns']) must(model,marker,'Product contract missing '+marker);
must(css,'body.p621-local-voice-enabled .p614-advisor','Legacy inline advisor must be hidden when the modular local agent foundation is active');
must(css,'.p621-highlight','Voice highlight styling missing');

if(fail.length){
  console.error('PRENEURA local voice foundation validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}
console.log('PRENEURA local voice foundation validated');
console.log('- inventory-aware recommendation, navigation, scrolling and highlighting are retained');
console.log('- live VAD, streaming audio and barge-in transport are retained');
console.log('- irreversible actions remain confirmation-gated');
console.log('- legacy Egyptian assets are retained only for future language re-enablement');
console.log('- active 6.7 buyer-facing advisor and local runtime are English-only');
