// Synthetic public testing only. Co-located jobs stop whenever Render sleeps
// this web service. Durable independent workers remain the production topology.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabase} from '../packages/database/dist/index.js';
import {RUNTIME_SCHEMA_VERSION} from '../packages/database/dist/runtime-readiness.js';
import {validateApiRuntimeConfig} from '../apps/api/dist/config/runtime-config.js';
import {validateWorkerRuntimeConfig} from '../apps/worker/dist/runtime-config.js';
import {assertNotificationGatewayRuntimeConfiguration} from '../apps/notification-gateway/dist/runtime-config.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.NODE_ENV!=='production'||process.env.PRENEURA_DEPLOYMENT_PROFILE!=='render-public-test') {
  throw new Error('Render public testing requires production security configuration and an explicit deployment profile.');
}
const apiEnv={...process.env};
const gatewayEnv={...process.env,PORT:'4300',NOTIFICATION_GATEWAY_BIND_HOST:'127.0.0.1'};
const workerEnv={...process.env,NOTIFICATION_GATEWAY_TRANSPORT:'loopback',NOTIFICATION_GATEWAY_URL:'http://127.0.0.1:4300/deliver'};
validateApiRuntimeConfig(apiEnv);validateWorkerRuntimeConfig(workerEnv);assertNotificationGatewayRuntimeConfiguration(gatewayEnv);
if(apiEnv.AUTH_OTP_GATEWAY_URL!=='http://127.0.0.1:4300/auth-otp'||apiEnv.CONTACT_VERIFICATION_GATEWAY_URL!=='http://127.0.0.1:4300/contact-verification') {
  throw new Error('The co-located notification gateway must use the fixed local endpoints.');
}
if(Number(apiEnv.PORT)===4300)throw new Error('Public API port conflicts with the internal gateway.');
let stopping=false,runtimeStarted=false,exitCode=0,migrationChild;
function stop(code) {
  if(stopping)return;stopping=true;exitCode=Math.max(exitCode,code);process.exitCode=exitCode;
  migrationChild?.kill('SIGTERM');
  const deadline=setTimeout(()=>{console.error('Render public test shutdown deadline exceeded.');process.exit(exitCode||1);},45000);deadline.unref();
  if(!runtimeStarted&&!migrationChild)process.exit(exitCode);
}
function fatal(error) {
  console.error(error instanceof Error?error.message:'Render public testing startup failed.');exitCode=1;
  if(runtimeStarted)process.kill(process.pid,'SIGTERM');else stop(1);
}
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));
process.on('beforeExit',()=>{process.exitCode=exitCode;});
// A fresh test database may be bootstrapped. Existing runtimes must already be
// migrated offline; never migrate underneath the previous worker.
const db=createDatabase(process.env.DATABASE_URL);
try {
  const tables=await db.selectFrom('information_schema.tables').select('table_name').where('table_schema','=','public').execute();
  if(tables.length>0) {
    const contract=await db.selectFrom('platform_runtime_contract').select('schema_version').where('singleton_key','=','production').executeTakeFirst();
    if(contract?.schema_version!==RUNTIME_SCHEMA_VERSION)throw new Error('Existing database requires an offline migration before this Render test deployment.');
  }
} finally {await db.destroy();}
migrationChild=spawn(process.execPath,['scripts/migrate.mjs'],{cwd:resolve(root,'packages/database'),env:apiEnv,stdio:'inherit'});
const [migrationCode]=await once(migrationChild,'exit');migrationChild=undefined;
if(stopping)process.exit(exitCode);
if(migrationCode!==0)throw new Error('Migration verification failed; no application runtime started.');
// These services share one memory/telemetry runtime for public testing. Their
// separate standalone entry points remain the durable production topology.
Object.assign(process.env,workerEnv,{NOTIFICATION_GATEWAY_PORT:'4300',NOTIFICATION_GATEWAY_BIND_HOST:'127.0.0.1'});
runtimeStarted=true;
try {
  const gateway=await import('../apps/notification-gateway/dist/bootstrap.js');
  const gatewayServer=gateway.notificationGatewayServer;
  if(!gatewayServer.listening)await once(gatewayServer,'listening');
  gatewayServer.on('close',()=>{if(!stopping)fatal(new Error('Local notification gateway unexpectedly closed.'));});
  console.log(JSON.stringify({event:'render.preview.component.started',name:'notification-gateway',pid:process.pid}));
  await import('../apps/worker/dist/main.js');
  console.log(JSON.stringify({event:'render.preview.component.started',name:'worker',pid:process.pid}));
  const api=await import('../apps/api/dist/main.js');
  const application=await api.apiStartup;
  application.getHttpServer().on('close',()=>{if(!stopping)fatal(new Error('Public test API unexpectedly closed.'));});
  console.log(JSON.stringify({event:'render.preview.component.started',name:'api',pid:process.pid}));
} catch(error) {fatal(error);}
