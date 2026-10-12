import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiProxyRewrites} from './api-proxy-config.mjs';
test('same-origin proxy forwards only API paths to the fixed server upstream',()=>{
  assert.deepEqual(apiProxyRewrites({NODE_ENV:'production',NEXT_PUBLIC_API_URL:'https://web.onrender.com',PRENEURA_API_UPSTREAM:'https://api.onrender.com'}),
    [{source:'/v1/:path*',destination:'https://api.onrender.com/v1/:path*'}]);
  assert.deepEqual(apiProxyRewrites({}),[]);
});
test('production proxy rejects loops, loopback, credentials and arbitrary target paths',()=>{
  for(const upstream of ['http://api.onrender.com','https://web.onrender.com','https://u:p@api.onrender.com','https://api.onrender.com/other','https://api.onrender.com/?x=1','https://api.onrender.com/#x','https://127.0.0.1'])
    assert.throws(()=>apiProxyRewrites({NODE_ENV:'production',NEXT_PUBLIC_API_URL:'https://web.onrender.com',PRENEURA_API_UPSTREAM:upstream}));
  for(const origin of ['ftp://web.onrender.com','http://web.onrender.com','https://web.onrender.com/api','https://127.0.0.1'])
    assert.throws(()=>apiProxyRewrites({NODE_ENV:'production',NEXT_PUBLIC_API_URL:origin,PRENEURA_API_UPSTREAM:'https://api.onrender.com'}));
});
test('local browser certification uses an explicit loopback upstream',()=>{
  assert.equal(apiProxyRewrites({NODE_ENV:'development',NEXT_PUBLIC_API_URL:'http://127.0.0.1:3030',PRENEURA_API_UPSTREAM:'http://127.0.0.1:4120'})[0].destination,'http://127.0.0.1:4120/v1/:path*');
});
