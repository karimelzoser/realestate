import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
if(process.env.PRENEURA_VPS_SCANNER_CERTIFICATION!=='true')throw new Error('Explicit isolated scanner certification is required.');
const client=new S3Client({endpoint:'http://object-storage:8333',region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY}});
const bucket='realestate-private-documents',prefix=`tenants/synthetic-scanner-certification/${randomUUID()}`,keys=[];
const scanner='http://scanner:4400',token=process.env.DOCUMENT_SCANNER_TOKEN;
const clean=Buffer.from('%PDF-1.7\nSynthetic clean-file qualification only\n%%EOF');
// Standard benign antivirus test pattern; no executable malware is introduced.
const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
async function scan(bytes,name,override={}) {
  const key=`${prefix}/${name}`;keys.push(key);
  await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'application/octet-stream',IfNoneMatch:'*',ChecksumSHA256:createHash('sha256').update(bytes).digest('base64')}));
  const objectUrl=await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60});
  return fetch(`${scanner}/scan`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({objectUrl,expectedSha256Hex:createHash('sha256').update(bytes).digest('hex'),byteSize:bytes.length,...override})});
}
try {
  assert.equal((await fetch(`${scanner}/health`)).status,200);
  const unauthorized=await fetch(`${scanner}/scan`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(unauthorized.status,401);
  const valid=await scan(clean,'clean.pdf');assert.equal(valid.status,200);const result=await valid.json();assert.equal(result.verdict,'CLEAN');assert.ok(result.engineVersion.startsWith('ClamAV 1.5.4/'));
  const infected=await scan(eicar,'benign-eicar-test.txt');assert.equal(infected.status,200);const detection=await infected.json();assert.equal(detection.verdict,'INFECTED');assert.match(detection.signature,/Eicar/i);
  assert.equal((await scan(clean,'wrong-hash.pdf',{expectedSha256Hex:'0'.repeat(64)})).status,400);
  console.log('VPS_SCANNER_CERTIFICATION_OK real ClamAV1.5.4/definitions, CLEAN physical file, benign EICAR detected, wrong digest rejected, authentication enforced');
} finally {for(const key of keys)await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>undefined);client.destroy();}
