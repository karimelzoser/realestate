export function apiProxyRewrites(env) {
  const raw=env.PRENEURA_API_UPSTREAM?.trim();
  if(!raw)return [];
  const url=new URL(raw);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const localFixture=(env.NODE_ENV!=='production'||env.GITHUB_ACTIONS==='true')&&loopback&&url.protocol==='http:';
  if((url.protocol!=='https:'&&!localFixture)||url.username||url.password||url.pathname!=='/'||url.search||url.hash) {
    throw new Error('PRENEURA_API_UPSTREAM must be an HTTPS origin without credentials, path, query or fragment.');
  }
  if(loopback&&!localFixture)throw new Error('Production API upstream must not target loopback.');
  const publicUrl=new URL(env.NEXT_PUBLIC_API_URL??'');
  const publicLoopback=['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname);
  const localPublicFixture=(env.NODE_ENV!=='production'||env.GITHUB_ACTIONS==='true')&&publicLoopback&&publicUrl.protocol==='http:';
  if((publicUrl.protocol!=='https:'&&!localPublicFixture)||(publicLoopback&&!localPublicFixture)) {
    throw new Error('Same-origin API proxy requires a public HTTPS web origin.');
  }
  if(publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||publicUrl.username||publicUrl.password) {
    throw new Error('Same-origin API proxy requires NEXT_PUBLIC_API_URL to be the public web origin.');
  }
  if(publicUrl.origin===url.origin)throw new Error('API upstream cannot proxy back to the public web origin.');
  return [{source:'/v1/:path*',destination:`${url.origin}/v1/:path*`}];
}
