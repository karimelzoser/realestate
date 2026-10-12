import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';

const bytes=Buffer.from('%PDF-1.7\nSynthetic integrity certification\n%%EOF');
const sha=createHash('sha256').update(bytes).digest('base64');
const hex=createHash('sha256').update(bytes).digest('hex');

async function fixture(action:(service:ObjectStorageService,control:{content:Buffer;chunked:boolean})=>Promise<void>) {
  const control={content:bytes,chunked:false};
  const server=createServer((request,response)=>{
    response.setHeader('content-type','application/pdf');
    if(request.method==='HEAD'){
      response.setHeader('content-length',bytes.length);
      response.setHeader('x-amz-meta-preneura-sha256',hex);
      response.end();return;
    }
    if(!control.chunked)response.setHeader('content-length',control.content.length);
    response.write(control.content.subarray(0,8));response.end(control.content.subarray(8));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('No fixture port');
  const saved={...process.env};
  Object.assign(process.env,{NODE_ENV:'test',OBJECT_STORAGE_BUCKET:'synthetic-private',OBJECT_STORAGE_ENDPOINT:`http://127.0.0.1:${address.port}`,OBJECT_STORAGE_PUBLIC_ENDPOINT:'https://objects.example.test:8444',OBJECT_STORAGE_REGION:'garage',OBJECT_STORAGE_ACCESS_KEY_ID:'synthetic-access-key',OBJECT_STORAGE_SECRET_ACCESS_KEY:'synthetic-secret-key',OBJECT_STORAGE_FORCE_PATH_STYLE:'true'});
  try {await action(new ObjectStorageService(),control);}
  finally {process.env=saved;await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
const verify={objectKey:'tenants/synthetic/document',expectedContentType:'application/pdf',expectedByteSize:bytes.length,expectedSha256Base64:sha};

test('metadata alone cannot certify different stored bytes, even when size and MIME match',async()=>{
  await fixture(async(service,control)=>{
    assert.equal((await service.verifyObject(verify))?.sha256Hex,hex);
    control.content=Buffer.alloc(bytes.length,65);
    assert.equal(await service.verifyObject(verify),null);
  });
});
test('a chunked object with truthful metadata but oversized physical bytes fails bounded verification',async()=>{
  await fixture(async(service,control)=>{
    control.chunked=true;control.content=Buffer.concat([bytes,Buffer.from('additional bytes')]);
    assert.equal(await service.verifyObject(verify),null);
    await assert.rejects(service.readObjectBytes({objectKey:verify.objectKey,maxBytes:bytes.length}),/permitted inspection size/);
  });
});
test('browser URLs use the public origin and cryptographically bind a create-only upload',async()=>{
  await fixture(async(service)=>{
    const intent=await service.createUploadIntent({objectKey:verify.objectKey,contentType:'application/pdf',byteSize:bytes.length,sha256Base64:sha});
    const url=new URL(intent.uploadUrl);
    assert.equal(url.origin,'https://objects.example.test:8444');
    assert.equal(intent.requiredHeaders['if-none-match'],'*');
    assert.ok(url.searchParams.get('X-Amz-SignedHeaders')?.split(';').includes('if-none-match'));
    assert.equal(new URL((await service.createDownloadUrl({objectKey:verify.objectKey})).downloadUrl).origin,url.origin);
  });
});
test('public storage origins reject embedded credentials, prefixes and insecure production endpoints',async()=>{
  await fixture(async()=>{
    process.env.NODE_ENV='production';
    for(const endpoint of ['https://user:secret@objects.example.test','https://objects.example.test/storage','http://objects.example.test','http://127.0.0.1:9000','https://objects.example.test/?target=other']){
      process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT=endpoint;
      assert.throws(()=>new ObjectStorageService(),/PUBLIC_ENDPOINT/);
    }
  });
});
