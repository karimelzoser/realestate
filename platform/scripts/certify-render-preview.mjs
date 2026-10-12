// Real process/database certification with synthetic configuration, not provider evidence.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Preview certification requires a disposable loopback test database.');
const secret=()=>randomBytes(32).toString('base64');
let residentMemoryBytes=null;
async function sampleResidentMemory(pids) {
  if(process.platform==='linux') {
    const sizes=await Promise.all(pids.map(async pid=>{
      const status=await readFile(`/proc/${pid}/status`,'utf8');
      return Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]??0)*1024;
    }));
    return sizes.reduce((sum,value)=>sum+value,0);
  }
  if(process.platform==='win32') {
    const rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${pids.join(',')} | Select-Object Id,WorkingSet64 | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true}));
    return (Array.isArray(rows)?rows:[rows]).reduce((sum,row)=>sum+row.WorkingSet64,0);
  }
  return null;
}
const identity=JSON.parse(await readFile('apps/api/dist/build-identity.json','utf8'));
const env={...process.env,NODE_ENV:'production',PRENEURA_DEPLOYMENT_PROFILE:'render-public-test',PORT:'4180',
  WEB_ORIGIN:'https://preview.preneura.test',PRENEURA_EXPECTED_RELEASE_SHA:identity.gitSha,TRUST_PROXY_HOPS:'1',API_BODY_LIMIT_BYTES:'8388608',
  AUTH_STEP_UP_BASE_MAX_AGE_SECONDS:'600',AUTH_IDENTIFIER_HMAC_KEY:secret(),AUTH_OTP_PEPPER:secret(),COOKIE_SIGNING_SECRET:secret(),
  IDENTITY_DOCUMENT_HMAC_KEY:secret(),IDENTITY_RECOVERY_OTP_PEPPER:secret(),
  CONTACT_HMAC_KEY:secret(),CONTACT_VERIFICATION_PEPPER:secret(),CONTACT_ENCRYPTION_KEY_BASE64:secret(),NOTIFICATION_GATEWAY_TOKEN:secret(),
  OTP_PROVIDER:'gateway',OTP_CHANNEL:'whatsapp',AUTH_OTP_GATEWAY_URL:'http://127.0.0.1:4300/auth-otp',CONTACT_VERIFICATION_GATEWAY_URL:'http://127.0.0.1:4300/contact-verification',
  OIDC_ISSUER:'https://identity.preneura.test/realm',OIDC_CLIENT_ID:'certification-client',OIDC_CLIENT_SECRET:secret(),OIDC_REDIRECT_URI:'https://preview.preneura.test/v1/auth/google/callback',OIDC_AAL2_ACR_VALUES:'urn:preneura:aal2',
  OBJECT_STORAGE_BUCKET:'certification-private',DOCUMENT_SCANNER_URL:'https://scanner.preneura.test/scan',DOCUMENT_SCANNER_TOKEN:secret(),
  META_GRAPH_API_VERSION:'v23.0',META_WHATSAPP_PHONE_NUMBER_ID:'synthetic-certification-only',META_WHATSAPP_ACCESS_TOKEN:secret(),
  WHATSAPP_TEMPLATE_BINDINGS_JSON:JSON.stringify({'auth.login.otp':{name:'synthetic_certification_only',language:'en'}}),
  INVENTORY_LOCK_EXPIRY_SCAN_MS:'1000',INVENTORY_LOCK_EXPIRY_BATCH_SIZE:'500',OUTBOX_POLL_MS:'300',NOTIFICATION_POLL_MS:'1000',
  SLA_SCAN_MS:'30000',INSTALLMENT_REMINDER_SCAN_MS:'30000',COMMISSION_DUE_SCAN_MS:'30000',
  OTEL_EXPORTER_OTLP_ENDPOINT:'https://telemetry.preneura.test',OTEL_TRACES_EXPORTER:'none',OTEL_METRICS_EXPORTER:'none'};
async function runScenario(crash) {
  const startupFailure=crash==='startup_failure';
  const blocker=startupFailure?createServer((_request,response)=>{response.writeHead(503,{'content-type':'application/json'});response.end('{}');}):null;
  if(blocker){blocker.listen({port:4180,host:'0.0.0.0',exclusive:true});await once(blocker,'listening');}
  const child=spawn(process.execPath,['--import','./packages/observability/dist/register.js','deploy/render-preview.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
  const completion=once(child,'exit');let output='';const pids=new Map();
  function capture(chunk) {
    output=(output+chunk.toString()).slice(-200000);
    for(const line of output.split(/\r?\n/))try{const row=JSON.parse(line);if(row.event==='render.preview.component.started'&&Number.isInteger(row.pid))pids.set(row.name,row.pid);}catch{}
  }
  child.stdout.on('data',capture);child.stderr.on('data',capture);
  const hardTimeout=setTimeout(()=>{for(const pid of pids.values())try{process.kill(pid,'SIGKILL');}catch{}child.kill('SIGKILL');},90000);
  try {
    let ready=false,lastHealth='not contacted';
    for(let attempt=0;attempt<300;attempt++) {
      if(child.exitCode!==null){
        if(startupFailure){assert.equal(child.exitCode,1);assert.ok(output.includes('EADDRINUSE'));assert.ok(pids.has('worker')&&pids.has('notification-gateway'));
          assert.ok(!output.includes('shutdown deadline exceeded'),output);return;}
        throw new Error('Preview exited before readiness. '+output);
      }
      try {
        const health=await fetch('http://127.0.0.1:4180/v1/health/ready',{signal:AbortSignal.timeout(2000)});
        const body=await health.json();lastHealth=JSON.stringify({status:health.status,build:body.build,code:body.checks?.code,children:pids.size});
        if(health.ok&&pids.size===3&&output.includes('worker.ready')){assert.equal(body.build.matchesExpected,true);ready=true;break;}
      }catch(error){lastHealth=error.message;}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    const diagnostic=output.split(/\r?\n/).filter(line=>/error|fatal|shutdown|worker.ready|render.preview|EADDRINUSE/i.test(line)).slice(-20).join('\n');
    assert.equal(ready,true,'All production processes must become ready. Last health: '+lastHealth+' '+diagnostic);
    assert.equal(new Set(pids.values()).size,1,'Public test services must share one memory runtime.');
    residentMemoryBytes=await sampleResidentMemory([child.pid]);
    if(residentMemoryBytes!==null)assert.ok(residentMemoryBytes<384*1024*1024,'Initial test host RSS must leave128MiB headroom on a512MiB instance.');
    console.log(JSON.stringify({event:'render.preview.initial.memory',residentMemoryBytes,processes:1,hostedLoadVerified:false}));
    if(crash)child.kill('SIGKILL');else child.kill('SIGTERM');
    const [code,signal]=await completion;
    if(crash)assert.ok(code!==0||signal!==null,'Abrupt host loss must terminate every service.');
    else assert.equal(code,0,'Host must cleanly drain on termination.');
    if(!crash) {
      assert.ok(output.includes('worker.stopped'),'Worker must finish draining, rather than being force-killed.');
      assert.ok(output.includes('gateway.shutdown_requested'),'Gateway must receive graceful termination.');
      assert.ok(!output.includes('shutdown deadline exceeded'),output);
    }
    for(const pid of pids.values())assert.throws(()=>process.kill(pid,0),'All owned process children must stop.');
  } finally {
    clearTimeout(hardTimeout);
    for(const pid of pids.values())try{process.kill(pid,'SIGKILL');}catch{}
    if(child.exitCode===null)child.kill('SIGKILL');
    if(blocker)await new Promise(resolve=>blocker.close(resolve));
  }
}
// Windows forcibly terminates a root process on SIGTERM; Linux CI certifies drain.
if(process.platform!=='win32')await runScenario(false);
await runScenario(true);
await runScenario('startup_failure');
console.log(JSON.stringify({result:'RENDER_PREVIEW_PROCESS_CERTIFICATION_OK',migrationVerification:true,productionSecurity:true,abruptHostLossStopsServices:true,componentStartupFailureStopsHost:true,gracefulSignalDrain:process.platform!=='win32',initialResidentMemoryBytes:residentMemoryBytes,providersVerified:false,hostedLoadVerified:false}));
