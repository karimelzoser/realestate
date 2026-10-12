import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

export function scannerConfig(env=process.env) {
  const token=env.DOCUMENT_SCANNER_TOKEN??'';
  if(token.length<32)throw new Error('A private scanner token of at least32 characters is required.');
  const origins=(env.SCANNER_ALLOWED_OBJECT_ORIGINS??'').split(',').filter(Boolean).map(value=>{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Scanner object origins must be exact origins.');
    return url.origin;
  });
  if(origins.length===0)throw new Error('At least one fixed object-store origin is required.');
  return {token,origins,bucket:env.OBJECT_STORAGE_BUCKET??'realestate-private-documents',host:env.CLAMD_HOST??'antivirus',port:Number(env.CLAMD_PORT??3310),maxBytes:32*1024*1024,timeoutMs:45000};
}
export function validateScanRequest(value,config) {
  if(!value||typeof value!=='object'||typeof value.objectUrl!=='string'||typeof value.expectedSha256Hex!=='string'||!/^[0-9a-f]{64}$/i.test(value.expectedSha256Hex)||!Number.isInteger(value.byteSize)||value.byteSize<1||value.byteSize>config.maxBytes)throw new ScanError(400,'INVALID_SCAN_REQUEST');
  const url=new URL(value.objectUrl);
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw new ScanError(400,'INVALID_OBJECT_PATH');}
  if(!config.origins.includes(url.origin)||url.username||url.password||url.hash||!pathname.startsWith(`/${config.bucket}/tenants/`)||pathname.includes('..')||pathname.includes('\\')||pathname.includes('\0'))throw new ScanError(400,'OBJECT_ORIGIN_OR_PREFIX_DENIED');
  return {url:url.toString(),sha:value.expectedSha256Hex.toLowerCase(),byteSize:value.byteSize};
}
export function parseClamVerdict(response) {
  const value=response.replace(/\0/g,'').trim();
  if(value==='stream: OK')return {verdict:'CLEAN',signature:null};
  const found=/^stream: (.{1,300}) FOUND$/.exec(value);
  if(found&&!found[1].startsWith('Heuristics.Limits.Exceeded'))return {verdict:'INFECTED',signature:found[1]};
  throw new ScanError(503,'ENGINE_CANNOT_CERTIFY_OBJECT');
}
export function validateClamVersion(value,now=Date.now()) {
  if(!/^ClamAV \d+\.\d+\.\d+\//.test(value)||value.length>120)throw new ScanError(503,'ENGINE_VERSION_UNAVAILABLE');
  const date=value.split('/')[2];
  const updated=date?Date.parse(date.replace(/\s+(?:GMT|UTC)$/,'')+' UTC'):NaN;
  if(!Number.isFinite(updated)||updated>now+300000||now-updated>48*3600000)throw new ScanError(503,'ENGINE_DEFINITIONS_NOT_CURRENT');
  return value;
}
async function clamdCommand(config,command,bytes) {
  const socket=createConnection({host:config.host,port:config.port});
  socket.setTimeout(config.timeoutMs,()=>socket.destroy(new Error('ENGINE_TIMEOUT')));
  const chunks=[];let count=0;
  const response=new Promise((resolve,reject)=>{
    socket.on('data',chunk=>{count+=chunk.length;if(count>2048){socket.destroy(new Error('ENGINE_RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);if(chunk.includes(0))resolve(Buffer.concat(chunks).toString());});
    socket.once('error',reject);socket.once('end',()=>resolve(Buffer.concat(chunks).toString()));
  });
  // Attach rejection handling before waiting for connection/writes.
  void response.catch(()=>undefined);
  try {
    await once(socket,'connect');
    socket.write(`z${command}\0`);
    if(bytes){
      for(let offset=0;offset<bytes.length;offset+=65536){
        const chunk=bytes.subarray(offset,offset+65536),length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);
        if(!socket.write(length))await once(socket,'drain');
        if(!socket.write(chunk))await once(socket,'drain');
      }
      socket.write(Buffer.alloc(4));
    }
    return await response;
  }finally{socket.destroy();}
}
class ScanError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}

export function createScanner(config) {
  let active=0;
  const server=createServer((request,response)=>void handle(request,response).catch(error=>{
    if(!response.headersSent){response.writeHead(error instanceof ScanError?error.status:503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({code:error instanceof ScanError?error.code:'SCANNER_UNAVAILABLE'}));}
  }));
  async function handle(request,response) {
    if(request.method==='GET'&&request.url==='/health'){
      if((await clamdCommand(config,'PING')).replace(/\0/g,'').trim()!=='PONG')throw new ScanError(503,'ENGINE_NOT_READY');
      validateClamVersion((await clamdCommand(config,'VERSION')).replace(/\0/g,'').trim());
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({status:'ready',engine:'ClamAV'}));return;
    }
    if(request.method!=='POST'||request.url!=='/scan')throw new ScanError(404,'NOT_FOUND');
    const supplied=createHash('sha256').update(request.headers.authorization??'').digest();
    const expected=createHash('sha256').update(`Bearer ${config.token}`).digest();
    if(!timingSafeEqual(supplied,expected))throw new ScanError(401,'AUTHENTICATION_REQUIRED');
    if(!request.headers['content-type']?.startsWith('application/json'))throw new ScanError(415,'JSON_REQUIRED');
    if(active>=1)throw new ScanError(503,'SCANNER_BUSY');
    active++;
    try {
      let length=0;const input=[];
      for await(const chunk of request){length+=chunk.length;if(length>8192)throw new ScanError(413,'SCAN_REQUEST_TOO_LARGE');input.push(chunk);}
      let value;try{value=JSON.parse(Buffer.concat(input).toString());}catch{throw new ScanError(400,'INVALID_JSON');}
      const task=validateScanRequest(value,config);
      const object=await fetch(task.url,{redirect:'error',signal:AbortSignal.timeout(config.timeoutMs)});
      if(!object.ok||!object.body)throw new ScanError(503,'OBJECT_READ_FAILED');
      const declared=object.headers.get('content-length');
      if(declared!==null&&Number(declared)!==task.byteSize){await object.body.cancel();throw new ScanError(400,'OBJECT_SIZE_MISMATCH');}
      const chunks=[];let total=0;const digest=createHash('sha256');
      for await(const chunk of object.body){total+=chunk.length;if(total>task.byteSize)throw new ScanError(400,'OBJECT_SIZE_MISMATCH');digest.update(chunk);chunks.push(Buffer.from(chunk));}
      if(total!==task.byteSize||digest.digest('hex')!==task.sha)throw new ScanError(400,'OBJECT_DIGEST_MISMATCH');
      const bytes=Buffer.concat(chunks,total);
      const version=validateClamVersion((await clamdCommand(config,'VERSION')).replace(/\0/g,'').trim());
      const verdict=parseClamVerdict(await clamdCommand(config,'INSTREAM',bytes));
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify({...verdict,engine:'ClamAV',engineVersion:version,reference:randomUUID()}));
    }finally{active--;}
  }
  server.headersTimeout=5000;server.requestTimeout=60000;
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createScanner(scannerConfig());server.listen(Number(process.env.PORT??4400),'0.0.0.0');
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();server.closeIdleConnections();setTimeout(()=>process.exit(1),60000).unref();});
}
