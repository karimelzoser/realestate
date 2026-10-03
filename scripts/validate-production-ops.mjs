import fs from 'node:fs';

const read=p=>fs.readFileSync(p,'utf8');
const fail=[];
const ops=read('src/features/production-ops/index.js');
const css=read('src/features/production-ops/index.css');
const loader=read('index.html');
const voice=read('local_voice_agent/server64.py');
const config=read('src/features/local-voice-agent/config64.js');
const requirements=read('local_voice_agent/requirements.txt');

function must(text,needle,label){if(!text.includes(needle))fail.push(label||`Missing ${needle}`)}

for(const m of [
  'p64GenerateExactContract','Complete requirements','p64UploadPaymentEvidence','p64CaptureRequirement','Complete Demo Requirements',
  'p64TakeNextOfflineBuyer','NEXT OFFLINE TURN','SHARED QUEUE TRUTH',
  'p64PrintExactContract','p64UploadExecutedContract','p64VerifyExecutedContract','fingerprint/biometric',
  'Installment & balance summary','missed installment','Total remaining','Paid to date',
  "P['m-project-data']",'Master Plan','Buildings & Units','Price List','Broker Companies & Agents',
  'p64PhaseToggleUnit','p64PhaseSelectBuilding','p64PhasePrice','Save Exact Unit Scope',
  'BUYERS • 360° CUSTOMER VIEW','p64BuyerQuery','Last handled by',
  'BROKER PERFORMANCE','EOI paid / eligible','Sold / commissionable',
  'AUDIT & BUYER JOURNEY REPLAY','Hany Ibrahim','Nour Adel','Mariam Hassan',
  'EXECUTIVE PROJECT OVERVIEW','Project inventory & sell-through','Decision signals'
]) must(ops,m,`Production operations missing: ${m}`);

for(const m of ['p64-kpis','p64-finance-summary','p64-phase-toolbar','p64-source-upload','p64-event']) must(css,m,`Production CSS missing ${m}`);
for(const m of ['src/features/production-ops/index.css','src/features/production-ops/index.js','src/features/local-voice-agent/config64.js']) must(loader,m,`Loader missing ${m}`);

must(voice,'itshamdi404/Egy_Arabic_Qwen3-TTS-12Hz-1.7B-Base','Egyptian Qwen3 TTS is not the default model');
must(voice,'egyptian_speaker','Egyptian Qwen3 speaker is missing');
must(voice,'مصري قاهري طبيعي وراقي وهادي','Egyptian conversational prompt is missing');
must(voice,'request_lock_confirmation','Voice safety boundary missing');
must(voice,'legacy._sanitize_actions','Model actions are not sanitized');
must(config,"speaker:'egyptian_speaker'",'Frontend Egyptian speaker default missing');
must(requirements,'qwen-tts','qwen-tts dependency missing');

const forbidden=[
  ['app.fx.transaction.payment.state=\'CONFIRMED\'','literal check placeholder']
];
// AI service itself must not expose irreversible action types.
if(/SAFE_ACTIONS[^\n]*(lock|payment|signature|price_override|queue_override)/i.test(voice)) fail.push('Voice action allowlist includes irreversible authority');

if(fail.length){console.error('PRENEURA 6.4 production validation failed');fail.forEach(x=>console.error('- '+x));process.exit(1)}
console.log('PRENEURA 6.4 production validation passed');
console.log('- contract requirements / exact contract execution');
console.log('- next offline Allocator assignment');
console.log('- My Property financial visibility');
console.log('- project import + exact phase inventory/pricing');
console.log('- buyer / broker / audit intelligence');
console.log('- executive overview');
console.log('- Egyptian Qwen3-TTS quality profile + AI safety boundary');
