import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from '../src/auth/auth.service.js';
import type { AuthRepository } from '../src/auth/auth.repository.js';
import type { OtpDeliveryPort } from '../src/auth/otp-delivery.js';
import { GoogleOidcService } from '../src/auth/google-oidc.service.js';
import { validateApiRuntimeConfig } from '../src/config/runtime-config.js';

test('paused phone sign-in returns unavailable before identity lookup, challenge creation or delivery',async()=>{
  const saved=process.env.AUTH_PHONE_LOGIN_ENABLED;process.env.AUTH_PHONE_LOGIN_ENABLED='false';
  let calls=0;
  const forbidden=new Proxy({}, { get:()=>{calls++;throw new Error('No provider or identity access is allowed');} });
  try {
    const auth=new AuthService(forbidden as AuthRepository,forbidden as OtpDeliveryPort);
    await assert.rejects(auth.startLogin({method:'phone',identifier:'+201012345678',channel:'sms'}),/awaiting delivery-provider/);
    assert.equal(calls,0);
  } finally {if(saved===undefined)delete process.env.AUTH_PHONE_LOGIN_ENABLED;else process.env.AUTH_PHONE_LOGIN_ENABLED=saved;}
});
test('public capabilities contain no credentials and advertise the configured WhatsApp channel honestly',()=>{
  const saved={...process.env};
  try {
    Object.assign(process.env,{AUTH_PHONE_LOGIN_ENABLED:'false',OTP_CHANNEL:'whatsapp',OIDC_IDP_HINT:'',OIDC_ISSUER:'https://identity.example.test',OIDC_CLIENT_ID:'synthetic-client',OIDC_CLIENT_SECRET:'never-expose-this-secret',OIDC_REDIRECT_URI:'https://web.example.test/v1/auth/google/callback'});
    const auth=new AuthService({} as AuthRepository,{} as OtpDeliveryPort);
    assert.deepEqual(auth.publicCapabilities(),{phoneSignInEnabled:false,oidcSignInEnabled:true,oidcProvider:'ORGANIZATION',defaultOtpChannel:'whatsapp'});
    assert.equal(JSON.stringify(auth.publicCapabilities()).includes('never-expose'),false);
  }finally{process.env=saved;}
});
test('the organization identity flow omits a nonexistent Google federation hint while retaining PKCE and nonce',()=>{
  const saved={...process.env};
  try {
    Object.assign(process.env,{OIDC_IDP_HINT:'',OIDC_ISSUER:'https://identity.example.test',OIDC_CLIENT_ID:'synthetic-client',OIDC_REDIRECT_URI:'https://web.example.test/v1/auth/google/callback'});
    const google=new GoogleOidcService({} as AuthRepository,{} as AuthService,{} as never);
    const request=google.createAuthorizationRequest({requireAal2:true});const url=new URL(request.url);
    assert.equal(url.searchParams.has('kc_idp_hint'),false);assert.equal(url.searchParams.get('nonce'),request.nonce);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  }finally{process.env=saved;}
});
test('delivery deferral cannot silently become a fully enabled production login configuration',()=>{
  assert.throws(()=>validateApiRuntimeConfig({NODE_ENV:'production',AUTH_PHONE_LOGIN_ENABLED:'false',APP_ENV:'production'}),/paused only/);
});
