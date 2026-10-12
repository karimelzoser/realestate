import assert from 'node:assert/strict';
if(process.env.PRENEURA_VPS_IDENTITY_CERTIFICATION!=='true')throw new Error('Only the isolated identity configuration may be inspected.');
const server='http://identity:8080/identity';
const tokenResponse=await fetch(`${server}/realms/master/protocol/openid-connect/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'realestate-deployment-admin',password:process.env.KEYCLOAK_BOOTSTRAP_PASSWORD})});
assert.equal(tokenResponse.status,200,'Private deployment administrator authentication failed.');
const token=(await tokenResponse.json()).access_token;
async function get(path){const response=await fetch(`${server}/admin/realms/realestate${path}`,{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200,'Identity configuration could not be read.');return response.json();}
const realm=await get('');assert.equal(realm.browserFlow,'realestate-browser');assert.equal(realm.registrationAllowed,false);assert.deepEqual(JSON.parse(realm.attributes['acr.loa.map']),{'urn:preneura:aal2':2});
const clients=await get('/clients?clientId=realestate-web');assert.equal(clients.length,1);const client=clients[0];
assert.equal(client.directAccessGrantsEnabled,false);assert.equal(client.serviceAccountsEnabled,false);assert.equal(client.implicitFlowEnabled,false);
assert.equal(client.attributes['oauth2.device.authorization.grant.enabled'],'false');assert.equal(client.attributes['oidc.ciba.grant.enabled'],'false');assert.equal(client.attributes['pkce.code.challenge.method'],'S256');assert.equal(client.attributes['minimum.acr.value'],'urn:preneura:aal2');
const secret=await get(`/clients/${client.id}/client-secret`);assert.equal(secret.value,process.env.OIDC_CLIENT_SECRET);
for(const [flow,authenticator,level]of [['realestate-level1','auth-username-password-form','1'],['realestate-level2','auth-otp-form','2']]){
  const executions=await get(`/authentication/flows/${flow}/executions`);
  assert.ok(executions.some(e=>e.providerId===authenticator&&e.requirement==='REQUIRED'));
  const condition=executions.find(e=>e.providerId==='conditional-level-of-authentication');assert.ok(condition);assert.equal(condition.requirement,'REQUIRED');
  const config=await get(`/authentication/config/${condition.authenticationConfig}`);assert.equal(config.config['loa-condition-level'],level);assert.equal(config.config['loa-max-age'],'0');
}
console.log('VPS_IDENTITY_CONFIGURATION_OK own realm/db/client secret, required password+OTP, real LoA mapping, PKCE, no direct/implicit/device/service grants; human MFA and owner activation still pending');
