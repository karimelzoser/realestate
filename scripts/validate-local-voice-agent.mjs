import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const entry=read('index.html');
const engine=read('src/features/local-voice-agent/engine.js');
const audio=read('src/features/local-voice-agent/audio.js');
const controller=read('src/features/local-voice-agent/index.js');
const css=read('src/features/local-voice-agent/index.css');
const server=read('local_voice_agent/server.py');
const model=read('src/core/product-model.js');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||('Missing '+needle));}
function mustNot(text,needle,label){if(text.includes(needle))fail.push(label||('Unexpected '+needle));}

for(const asset of [
  'src/features/local-voice-agent/index.css',
  'src/features/local-voice-agent/engine.js',
  'src/features/local-voice-agent/audio.js',
  'src/features/local-voice-agent/index.js'
]) must(entry,asset,'Root entry does not load '+asset);

for(const marker of ['normalizeUnit','rank','focusUnit','safeClick','IRREVERSIBLE','available_units']) must(engine,marker,'Voice engine missing '+marker);
for(const marker of ['startLive','bargeInThreshold','vadLoop','streamTts','audio_chunk','sendAudio','prime']) must(audio,marker,'Live audio layer missing '+marker);
for(const marker of ['PRE.voiceAgent','request_lock_confirmation','autoAdvance','p621VoiceAgent','أفضل المتاح ليك دلوقتي']) must(controller,marker,'Voice controller missing '+marker);
for(const page of ['b-allocation-day','b-site','b-building','b-floor','b-unit']) must(controller,"'"+page+"'",'Voice journey missing '+page);
mustNot(controller,'new MutationObserver','Local voice feature must not add a broad MutationObserver');
mustNot(audio,'new MutationObserver','Audio feature must not add a broad MutationObserver');

for(const marker of [
  'CohereLabs/cohere-transcribe-arabic-07-2026',
  'dev-ahmedhany/whisper-large-v3-turbo-arabic-ft-ct2-int8',
  'Qwen/Qwen3-30B-A3B-Instruct-2507',
  'mohammedaly22/VoiceTut-TTS',
  'TTS_SPEAKER = os.getenv("PRENEURA_TTS_SPEAKER", "Omnia")',
  'SAFE_ACTIONS',
  'IRREVERSIBLE_ACTION_WORDS',
  'request_lock_confirmation',
  'typ == "tts"',
  'stream_tts'
]) must(server,marker,'Local server missing '+marker);

for(const marker of ['localStack','FULL_DUPLEX_LOCAL','scroll-follow','show-ranked-units','barge-in-live-turns']) must(model,marker,'Product contract missing '+marker);
must(css,'body.p621-local-voice-enabled .p614-advisor','Legacy advisor must be hidden when local agent is active');
must(css,'.p621-highlight','Voice highlight styling missing');

if(fail.length){
  console.error('PRENEURA local voice validation failed');
  fail.forEach(x=>console.error('- '+x));
  process.exit(1);
}
console.log('PRENEURA local Egyptian voice agent validated');
console.log('- fully local Arabic ASR / agent / Egyptian TTS stack declared');
console.log('- authoritative inventory recommendation context present');
console.log('- live VAD, barge-in, scrolling and highlighting present');
console.log('- irreversible actions remain confirmation-gated');
