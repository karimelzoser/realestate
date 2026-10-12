import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import {parse} from 'yaml';

const text=await readFile(resolve(process.cwd(),'../render.yaml'),'utf8');
const blueprint=parse(text,{uniqueKeys:true});
const schemaPath=process.env.RENDER_SCHEMA_FILE;
const schemaText=schemaPath?await readFile(schemaPath,'utf8'):await (async()=>{
  const response=await fetch('https://render.com/schema/render.yaml.json',{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Official Render Blueprint schema is unavailable.');
  return response.text();
})();
const schema=JSON.parse(schemaText);
const ajv=new Ajv2020({allErrors:true,strict:false,validateFormats:false});
const validate=ajv.compile(schema);
if(!validate(blueprint))throw new Error(`Invalid Render Blueprint: ${JSON.stringify(validate.errors)}`);
if(blueprint.services?.length!==2||blueprint.databases?.length!==1)throw new Error('Public test topology must have two web services and one database.');
for(const item of [...blueprint.services,...blueprint.databases])if(item.plan!=='free')throw new Error('This public testing Blueprint cannot create paid resources.');
for(const service of blueprint.services) {
  if(service.type!=='web'||service.autoDeployTrigger!=='off'||service.branch!=='codex/egypt-platform-completion')throw new Error('Preview source or controlled deploy policy changed.');
  const variables=new Map(service.envVars.filter(x=>x.key).map(x=>[x.key,x]));
  if(variables.get('NODE_ENV')?.value!=='production')throw new Error('Public preview must retain production security.');
  if(service.name==='preneura-public-test-web'&&variables.get('NEXT_PUBLIC_APP_ENV')?.value!=='public-test')throw new Error('Public test environment must be visibly labeled.');
}
const backend=blueprint.services.find(x=>x.name==='preneura-public-test-backend');
const vars=new Map(backend.envVars.map(x=>[x.key,x]));
for(const key of ['WEB_ORIGIN','PRENEURA_EXPECTED_RELEASE_SHA','OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET','OIDC_REDIRECT_URI','OIDC_AAL2_ACR_VALUES',
  'OBJECT_STORAGE_BUCKET','OBJECT_STORAGE_REGION','OBJECT_STORAGE_ENDPOINT','OBJECT_STORAGE_ACCESS_KEY_ID','OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'DOCUMENT_SCANNER_URL','DOCUMENT_SCANNER_TOKEN','META_GRAPH_API_VERSION','META_WHATSAPP_PHONE_NUMBER_ID','META_WHATSAPP_ACCESS_TOKEN','WHATSAPP_TEMPLATE_BINDINGS_JSON',
  'OTEL_EXPORTER_OTLP_ENDPOINT','OTEL_EXPORTER_OTLP_HEADERS'])
  if(vars.get(key)?.sync!==false)throw new Error(`Public test provider/environment input missing: ${key}`);
for(const key of ['AUTH_IDENTIFIER_HMAC_KEY','AUTH_OTP_PEPPER','IDENTITY_DOCUMENT_HMAC_KEY','IDENTITY_RECOVERY_OTP_PEPPER','COOKIE_SIGNING_SECRET','CONTACT_HMAC_KEY','CONTACT_VERIFICATION_PEPPER','CONTACT_ENCRYPTION_KEY_BASE64',
  'NOTIFICATION_GATEWAY_TOKEN','FINANCE_PROVIDER_INGRESS_TOKEN','SETTLEMENT_PROVIDER_INGRESS_TOKEN'])
  if(vars.get(key)?.generateValue!==true)throw new Error(`Independent generated secret missing: ${key}`);
if(vars.get('OTP_CHANNEL')?.value!=='whatsapp'||vars.get('OTP_PROVIDER')?.value!=='gateway')throw new Error('OTP channel must match the required provider bindings.');
const database=blueprint.databases[0];
if(database.postgresMajorVersion!=='18'||database.ipAllowList?.length!==0)throw new Error('Database major version or external isolation changed.');
console.log(JSON.stringify({result:'RENDER_PUBLIC_TEST_BLUEPRINT_VALID',schemaSha256:createHash('sha256').update(schemaText).digest('hex'),services:2,databases:1,allPlansFree:true,productionSecurity:true,autoDeploy:false}));
