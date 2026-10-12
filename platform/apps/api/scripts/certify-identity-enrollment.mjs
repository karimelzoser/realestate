import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { PostgresAuthRepository } from '../dist/auth/auth.repository.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { GoogleOidcService } from '../dist/auth/google-oidc.service.js';
import { GoogleAuthController } from '../dist/auth/google-auth.controller.js';
import { IdentityEnrollmentRepository } from '../dist/auth/identity-enrollment.repository.js';
import { IdentityEnrollmentController } from '../dist/auth/identity-enrollment.controller.js';

const url=process.env.DATABASE_URL;
if (process.env.NODE_ENV!=='test' || !url || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Identity certification requires a disposable loopback test database.');
const pool=new pg.Pool({connectionString:url,max:8}),db=new Kysely({dialect:new PostgresDialect({pool})});
const query=(text,params=[])=>pool.query(text,params);
const identities=new PostgresAuthRepository(db),enrollments=new IdentityEnrollmentRepository(db);
const auth=new AuthService(identities,{deliver:async()=>{throw new Error('No synthetic OTP provider use in this certification');}});
const roles=['MANAGER','PRENEURA_SUPER_ADMIN','MANAGER','PRENEURA_SUPER_ADMIN','MANAGER'];
const users=roles.map(()=>randomUUID()),sessions=[];
const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'synthetic-oidc',alg:'RS256',use:'sig'},codes=new Map();
const server=createServer(async(req,res)=>{
  if(req.url==='/realm/protocol/openid-connect/certs'){res.setHeader('content-type','application/json');res.end(JSON.stringify({keys:[jwk]}));return;}
  if(req.url==='/realm/protocol/openid-connect/token'){
    const chunks=[];for await(const c of req)chunks.push(c);
    const code=new URLSearchParams(Buffer.concat(chunks).toString()).get('code'),token=codes.get(code);codes.delete(code);
    res.setHeader('content-type','application/json');res.statusCode=token?200:400;res.end(JSON.stringify(token?{id_token:token}:{error:'invalid_grant'}));return;
  }
  res.statusCode=404;res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const issuer=`http://127.0.0.1:${server.address().port}/realm`;
Object.assign(process.env,{WEB_ORIGIN:'https://web.example.test',OIDC_ISSUER:issuer,OIDC_CLIENT_ID:'synthetic-client',OIDC_CLIENT_SECRET:'synthetic-oidc-client-secret',OIDC_REDIRECT_URI:'https://web.example.test/api/v1/auth/google/callback',OIDC_AAL2_ACR_VALUES:'urn:test:aal2'});
const google=new GoogleOidcService(identities,auth,enrollments),controller=new IdentityEnrollmentController(auth,enrollments);
async function tokenCode(nonce,subject,overrides={}) {
  const code=randomUUID(),now=Math.floor(Date.now()/1000);
  codes.set(code,await new SignJWT({nonce,acr:'urn:test:aal2',amr:['pwd','mfa'],auth_time:now,email:'synthetic.staff@example.test',email_verified:true,...overrides})
    .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('synthetic-client').setSubject(subject).setIssuedAt().setExpirationTime(now+300).sign(keys.privateKey));
  return code;
}
async function complete(user,subject,mode='enrollment',claims={}) {
  const request=google.createAuthorizationRequest({requireAal2:true});
  const code=await tokenCode(request.nonce,subject,claims);
  return google.completeAuthorization({code,codeVerifier:request.codeVerifier,nonce:request.nonce,requireAal2:true,targetUserId:users[user],...(mode==='enrollment'?{enrollmentBaseSessionId:sessions[user].sessionId}:{})});
}
async function reviewer(user) {return auth.resolveSessionToken(sessions[user].sessionToken);}
async function rejectAction(action){await assert.rejects(action);}
try {
  for(const [i,user] of users.entries()){
    await query(`INSERT INTO users(id,display_name,status) VALUES($1,$2,'ACTIVE')`,[user,`Synthetic MFA actor ${i}`]);
    if(roles[i]==='PRENEURA_SUPER_ADMIN')await query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,status) VALUES($1,$2,'PLATFORM','ACTIVE')`,[user,roles[i]]);
    else{
      const tenant=randomUUID();await query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,'Synthetic MFA tenant','ACTIVE')`,[tenant,`MFA-${tenant}`]);
      await query(`INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES($1,$2,'ACTIVE')`,[tenant,user]);
      await query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,status) VALUES($1,$2,'TENANT',$3,'ACTIVE')`,[user,roles[i],tenant]);
    }
    sessions.push(await auth.issueSessionForUser(user,{eventType:'SYNTHETIC_CERTIFICATION_SESSION'},{authMethod:i===1||i===2||i===3?'OIDC_GOOGLE':'OTP',assuranceLevel:i===1||i===2||i===3?'AAL2':'AAL1',providerAmr:i===1||i===2||i===3?['mfa']:[]}));
  }
  const originalSessions=Number((await query('SELECT count(*) FROM auth_sessions')).rows[0].count);
  const request=google.createAuthorizationRequest({requireAal2:true}),params=new URL(request.url).searchParams;
  assert.equal(params.get('nonce'),request.nonce);assert.equal(params.get('max_age'),'0');assert.equal(params.get('code_challenge_method'),'S256');
  await rejectAction(()=>complete(0,'staff-a','step-up'));
  await rejectAction(()=>complete(0,'staff-a','enrollment',{nonce:'wrong-request'}));
  await rejectAction(()=>complete(0,'staff-a','enrollment',{auth_time:Math.floor(Date.now()/1000)-301}));
  await rejectAction(()=>complete(0,'staff-a','enrollment',{acr:'unapproved',amr:['otp']}));
  const ordinary=google.createAuthorizationRequest();
  const staleSso=await tokenCode(ordinary.nonce,'stale-sso',{auth_time:Math.floor(Date.now()/1000)-301});
  await rejectAction(()=>google.completeAuthorization({code:staleSso,nonce:ordinary.nonce,codeVerifier:ordinary.codeVerifier}));
  assert.equal((await query('SELECT count(*) FROM auth_identity_enrollment_requests WHERE user_id=ANY($1::uuid[])',[users])).rows[0].count,'0');
  const [a,b]=await Promise.all([complete(0,'staff-a'),complete(0,'staff-a')]);assert.equal(a.kind,'ENROLLMENT');assert.equal(a.requestId,b.requestId);
  assert.equal((await query('SELECT count(*) FROM auth_external_identities WHERE user_id=ANY($1::uuid[])',[users])).rows[0].count,'0');
  assert.equal(Number((await query('SELECT count(*) FROM auth_sessions')).rows[0].count),originalSessions);
  await rejectAction(()=>complete(0,'different-subject'));
  const own=await controller.mine({cookies:{preneura_session:sessions[0].sessionToken}});assert.equal(own.length,1);assert.equal(own[0].userId,users[0]);
  assert.equal((await controller.mine({cookies:{preneura_session:sessions[4].sessionToken}})).length,0);
  await rejectAction(async()=>controller.inbox(await reviewer(0)));
  await rejectAction(async()=>controller.inbox(await reviewer(2))); // Tenant manager with MFA is not a platform credential reviewer.
  const admin=await reviewer(1);
  const selfRequest=await complete(3,'synthetic-admin-first-factor');
  await rejectAction(()=>enrollments.review({id:selfRequest.requestId,reviewerUserId:users[3],reviewerSessionId:sessions[3].sessionId,decision:'APPROVED',note:'A platform administrator cannot independently approve their own enrollment.'}));
  await rejectAction(()=>query(`UPDATE auth_identity_enrollment_requests SET status='APPROVED',reviewed_by=$2,reviewer_session_id=$3,reviewed_at=now(),decision_note='Tenant manager cannot approve a global credential factor.' WHERE id=$1`,[a.requestId,users[2],sessions[2].sessionId]));
  const input={id:a.requestId,reviewerUserId:users[1],reviewerSessionId:admin.sessionId,decision:'APPROVED',note:'Corporate issuer and subject independently verified in trusted staff registry.'};
  const results=await Promise.all([enrollments.review(input),enrollments.review(input)]);assert.deepEqual(results,[true,true]);
  assert.equal((await query(`SELECT count(*) FROM auth_external_identities WHERE user_id=$1`,[users[0]])).rows[0].count,'1');
  assert.equal((await query(`SELECT count(*) FROM auth_security_events WHERE user_id=$1 AND event_type='IDENTITY_ENROLLMENT_APPROVED'`,[users[0]])).rows[0].count,'1');
  assert.equal(await enrollments.review({...input,note:'A changed decision is not an identical retry.'}),false);
  await rejectAction(()=>query(`UPDATE auth_external_identities SET provider_subject='replacement' WHERE user_id=$1`,[users[0]]));
  await rejectAction(()=>query(`UPDATE auth_identity_enrollment_requests SET status='REJECTED' WHERE id=$1`,[a.requestId]));
  await rejectAction(()=>complete(0,'staff-b'));
  await rejectAction(()=>complete(0,'staff-b','step-up'));
  const login=await complete(0,'staff-a','step-up');assert.equal(login.kind,'LOGIN');assert.equal(login.login.assuranceLevel,'AAL2');
  assert.equal((await auth.resolveSessionToken(sessions[0].sessionToken)).assuranceLevel,'AAL1'); // Review never upgrades a base session.
  const scoped=await identities.findOrProvisionExternalIdentity({provider:'google',issuer:issuer+'/other',providerSubject:'staff-a',displayName:'Synthetic unrelated issuer'});
  assert.notEqual(scoped.userId,users[0]);assert.equal(scoped.status,'PENDING');
  const conflicting=await complete(4,'staff-a');
  await rejectAction(()=>enrollments.review({...input,id:conflicting.requestId}));
  assert.equal((await query('SELECT status FROM auth_identity_enrollment_requests WHERE id=$1',[conflicting.requestId])).rows[0].status,'PENDING');
  assert.equal(await enrollments.review({...input,id:conflicting.requestId,decision:'REJECTED'}),true);
  assert.equal(await enrollments.review({...input,id:conflicting.requestId,decision:'REJECTED'}),true);
  // Expiry uses database-owned times. Rewind only in this disposable fixture.
  const next=await complete(4,'staff-c');
  const fixtureClient=await pool.connect();
  await fixtureClient.query('BEGIN');await fixtureClient.query('ALTER TABLE auth_identity_enrollment_requests DISABLE TRIGGER identity_enrollment_guard');
  await fixtureClient.query(`UPDATE auth_identity_enrollment_requests SET proof_verified_at=now()-interval '25 hours',created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE id=$1`,[next.requestId]);
  await fixtureClient.query('ALTER TABLE auth_identity_enrollment_requests ENABLE TRIGGER identity_enrollment_guard');await fixtureClient.query('COMMIT');fixtureClient.release();
  await rejectAction(()=>enrollments.review({...input,id:next.requestId}));
  const renewed=await complete(4,'staff-c');assert.notEqual(renewed.requestId,next.requestId);
  // Fresh AAL2 target cannot approve its own credential request.
  await rejectAction(()=>enrollments.review({...input,id:renewed.requestId,reviewerUserId:users[4],reviewerSessionId:sessions[4].sessionId}));
  await query(`UPDATE auth_sessions SET revoked_at=now() WHERE id=$1`,[admin.sessionId]);
  await rejectAction(()=>enrollments.review({...input,id:renewed.requestId}));
  assert.equal((await query(`SELECT count(*) FROM auth_external_identities WHERE user_id=$1`,[users[4]])).rows[0].count,'0');
  // External /api prefix must be present in every OIDC state cookie and clear.
  const cookies=new Map(),cleared=[];let destination='',responseBody;
  const reply={setCookie:(name,value,options)=>{cookies.set(name,{value,options});return reply;},clearCookie:(name,options)=>{cleared.push({name,options});return reply;},redirect:async(value)=>{destination=value;},send:async(value)=>{responseBody=value;}};
  const googleController=new GoogleAuthController(google,auth);
  await googleController.start('aal2',{cookies:{preneura_session:sessions[4].sessionToken}},reply);
  assert.ok(cookies.size>=5);for(const cookie of cookies.values())assert.equal(cookie.options.path,'/api/v1/auth/google');
  assert.ok(destination.startsWith(issuer));
  await googleController.startEnrollment({cookies:{preneura_session:sessions[4].sessionToken}},reply);
  assert.ok(responseBody.authorizationUrl.startsWith(issuer));
  const flow=JSON.parse(cookies.get('preneura_oidc_flow').value);
  assert.equal(flow.mode,'ENROLLMENT');
  const callbackCode=await tokenCode(flow.nonce,'staff-c');
  const callbackCookies={preneura_session:sessions[4].sessionToken,...Object.fromEntries([...cookies].map(([name,value])=>[name,value.value]))};
  const beforeCallback=Number((await query('SELECT count(*) FROM auth_sessions')).rows[0].count);
  await googleController.callback(callbackCode,cookies.get('preneura_oidc_state').value,undefined,{cookies:callbackCookies},reply);
  assert.equal(destination,'https://web.example.test/mfa-enrollment');
  assert.equal(Number((await query('SELECT count(*) FROM auth_sessions')).rows[0].count),beforeCallback);
  assert.equal((await auth.resolveSessionToken(sessions[4].sessionToken)).assuranceLevel,'AAL1');
  for(const cookie of cleared)assert.equal(cookie.options.path,'/api/v1/auth/google');
  console.log('IDENTITY_ENROLLMENT_CERTIFICATION_OK nonce/freshness/issuer/scoped-status/no-session-escalation/admin-only/replay/race/conflict/expiry/immutable/proxy-path');
} finally { await new Promise(r=>server.close(r));await db.destroy(); }
