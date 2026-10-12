import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {createHash} from 'node:crypto';
import {scannerConfig,validateScanRequest,parseClamVerdict,validateClamVersion,createScanner} from './document-scanner.mjs';

const token='synthetic-scanner-token-'.repeat(2),bytes=Buffer.from('Synthetic scanner byte-integrity test');
const hash=createHash('sha256').update(bytes).digest('hex');
test('scanner object selection rejects another origin, credentials, another bucket and traversal',()=>{
  const config=scannerConfig({DOCUMENT_SCANNER_TOKEN:token,SCANNER_ALLOWED_OBJECT_ORIGINS:'https://objects.example.test'});
  const input={objectUrl:'https://objects.example.test/realestate-private-documents/tenants/synthetic/doc',expectedSha256Hex:hash,byteSize:bytes.length};
  assert.equal(validateScanRequest(input,config).sha,hash);
  for(const objectUrl of ['https://other.example.test/realestate-private-documents/tenants/synthetic/doc','https://u:p@objects.example.test/realestate-private-documents/tenants/synthetic/doc','https://objects.example.test/other/tenants/doc','https://objects.example.test/realestate-private-documents/tenants/x/%2e%2e%2fsecret'])assert.throws(()=>validateScanRequest({...input,objectUrl},config));
});
test('unknown, incomplete and scan-limit engine responses can never certify CLEAN',()=>{
  assert.deepEqual(parseClamVerdict('stream: OK\0'),{verdict:'CLEAN',signature:null});
  assert.deepEqual(parseClamVerdict('stream: Win.Test.EICAR_HDB-1 FOUND\0'),{verdict:'INFECTED',signature:'Win.Test.EICAR_HDB-1'});
  for(const response of ['','OK','stream: ERROR','stream: Heuristics.Limits.Exceeded FOUND\0'])assert.throws(()=>parseClamVerdict(response));
});
test('stale, absent and future antivirus definitions cannot be reported ready',()=>{
  const now=Date.now();
  assert.ok(validateClamVersion(`ClamAV 1.5.4/12345/${new Date(now).toUTCString()}`,now));
  for(const updated of [new Date(now-49*3600000),new Date(now+3600000)])assert.throws(()=>validateClamVersion(`ClamAV 1.5.4/12345/${updated.toUTCString()}`,now));
  assert.throws(()=>validateClamVersion('ClamAV 1.5.4',now));
});

async function fixture(action) {
  let verdict='stream: OK',scanCalls=0;
  const object=httpServer((request,response)=>{if(request.url.endsWith('/redirect')){response.writeHead(302,{location:'http://169.254.169.254/'});response.end();}else response.end(bytes);});
  const engine=tcpServer(socket=>{let buffer=Buffer.alloc(0),command;
    socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);if(!command){const end=buffer.indexOf(0);if(end<0)return;command=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+1);if(command==='zPING'){socket.end('PONG\0');return;}if(command==='zVERSION'){socket.end(`ClamAV 1.5.4/12345/${new Date().toUTCString()}\0`);return;}}
      if(command==='zINSTREAM'){while(buffer.length>=4){const length=buffer.readUInt32BE(0);if(length===0){scanCalls++;socket.end(`${verdict}\0`);return;}if(buffer.length<4+length)return;buffer=buffer.subarray(4+length);}}
    });
  });
  await Promise.all([new Promise(r=>object.listen(0,'127.0.0.1',r)),new Promise(r=>engine.listen(0,'127.0.0.1',r))]);
  const objectOrigin=`http://127.0.0.1:${object.address().port}`;
  const config=scannerConfig({DOCUMENT_SCANNER_TOKEN:token,SCANNER_ALLOWED_OBJECT_ORIGINS:objectOrigin,CLAMD_HOST:'127.0.0.1',CLAMD_PORT:String(engine.address().port)});
  const scanner=createScanner(config);await new Promise(r=>scanner.listen(0,'127.0.0.1',r));
  const scannerOrigin=`http://127.0.0.1:${scanner.address().port}`;
  const input={objectUrl:`${objectOrigin}/realestate-private-documents/tenants/synthetic/doc`,expectedSha256Hex:hash,byteSize:bytes.length};
  const scan=(value=input,authorized=true)=>fetch(`${scannerOrigin}/scan`,{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(value)});
  try{await action({scan,input,calls:()=>scanCalls,verdict:value=>{verdict=value;}});}
  finally{scanner.closeAllConnections();object.closeAllConnections();await Promise.all([new Promise(r=>scanner.close(r)),new Promise(r=>object.close(r)),new Promise(r=>engine.close(r))]);}
}
test('unauthorized scanner requests and mismatched physical bytes never reach the engine',async()=>{
  await fixture(async f=>{assert.equal((await f.scan(f.input,false)).status,401);assert.equal((await f.scan({...f.input,expectedSha256Hex:'0'.repeat(64)})).status,400);assert.equal(f.calls(),0);});
});
test('HTTP scanner trusts only an exact digest and a valid engine verdict',async()=>{
  await fixture(async f=>{const clean=await f.scan();assert.equal(clean.status,200);assert.equal((await clean.json()).verdict,'CLEAN');f.verdict('stream: Win.Test.EICAR_HDB-1 FOUND');assert.equal((await (await f.scan()).json()).verdict,'INFECTED');f.verdict('stream: Heuristics.Limits.Exceeded FOUND');assert.equal((await f.scan()).status,503);});
});
test('a redirect from the approved object host cannot make the scanner fetch another service',async()=>{
  await fixture(async f=>{assert.equal((await f.scan({...f.input,objectUrl:f.input.objectUrl+'/redirect'})).status,503);assert.equal(f.calls(),0);});
});
