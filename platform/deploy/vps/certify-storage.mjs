import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,PutBucketCorsCommand,DeleteObjectCommand,CreateBucketCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const endpoint=process.env.OBJECT_STORAGE_ENDPOINT;
if(!['http://storage:3900','http://object-storage:8333'].includes(endpoint)||process.env.PRENEURA_VPS_STORAGE_CERTIFICATION!=='true')throw new Error('Storage certification is restricted to this project’s dedicated private storage services.');
const bucket='realestate-private-documents';
const client=new S3Client({endpoint,region:process.env.OBJECT_STORAGE_REGION??'garage',forcePathStyle:true,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY_ID,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY}});
const prefix=`tenants/synthetic-storage-certification/${randomUUID()}`;
const key=`${prefix}/immutable.pdf`,tamperKey=`${prefix}/presigned.pdf`,raceKey=`${prefix}/race.pdf`,checksumKey=`${prefix}/checksum-negative.pdf`;
const body=Buffer.from('%PDF-1.7\nSynthetic storage qualification only\n%%EOF');
const hash=createHash('sha256').update(body).digest('base64');
try {
  await client.send(new CreateBucketCommand({Bucket:bucket})).catch(error=>{if(!['BucketAlreadyOwnedByYou','BucketAlreadyExists'].includes(error.name))throw error;});
  await client.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:[{AllowedOrigins:['https://realestate-test.aipreneura.com:8443'],AllowedMethods:['GET','HEAD','PUT'],AllowedHeaders:['content-type','x-amz-*','if-none-match'],ExposeHeaders:['ETag','x-amz-checksum-sha256'],MaxAgeSeconds:300}]}}));
  const put={Bucket:bucket,Key:key,Body:body,ContentType:'application/pdf',ChecksumSHA256:hash,IfNoneMatch:'*',Metadata:{'preneura-sha256':createHash('sha256').update(body).digest('hex')}};
  await client.send(new PutObjectCommand(put));
  const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key,ChecksumMode:'ENABLED'}));
  assert.equal(head.ContentLength,body.length);assert.equal(head.ContentType,'application/pdf');
  assert.equal(head.Metadata?.['preneura-sha256'],put.Metadata['preneura-sha256']);
  const stored=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}));
  assert.equal(createHash('sha256').update(await stored.Body.transformToByteArray()).digest('base64'),hash);
  await assert.rejects(client.send(new PutObjectCommand(put)),error=>error.$metadata?.httpStatusCode===412);
  const raced=await Promise.allSettled(Array.from({length:8},()=>client.send(new PutObjectCommand({...put,Key:raceKey}))));
  assert.equal(raced.filter(result=>result.status==='fulfilled').length,1,'Conditional create must be atomic across competing uploads.');
  for(const result of raced)if(result.status==='rejected')assert.equal(result.reason.$metadata?.httpStatusCode,412);
  await assert.rejects(client.send(new PutObjectCommand({...put,Key:checksumKey,Body:Buffer.alloc(body.length,65)})),error=>error.$metadata?.httpStatusCode===400);
  const uploadUrl=await getSignedUrl(client,new PutObjectCommand({...put,Key:tamperKey,Body:undefined}),{expiresIn:60,signableHeaders:new Set(['if-none-match','content-type']),unhoistableHeaders:new Set(['x-amz-checksum-sha256','x-amz-meta-preneura-sha256'])});
  const headers={'content-type':'application/pdf','if-none-match':'*','x-amz-checksum-sha256':hash,'x-amz-meta-preneura-sha256':put.Metadata['preneura-sha256']};
  const upload=await fetch(uploadUrl,{method:'PUT',headers,body});
  const errorCode=upload.ok?'':(await upload.text()).match(/<Code>([^<]+)<\/Code>/)?.[1]??'UNKNOWN_ERROR';
  assert.equal(upload.status,200,`Presigned upload failed: ${errorCode}`);
  const replay=await fetch(uploadUrl,{method:'PUT',headers,body});assert.equal(replay.status,412);
  const altered=await fetch(uploadUrl,{method:'PUT',headers:{...headers,'if-none-match':'different'},body});assert.equal(altered.status,403);
  const anonymous=await fetch(`${endpoint}/${bucket}/${key}`);assert.equal(anonymous.status,403);
  console.log('VPS_STORAGE_CERTIFICATION_OK private bucket/presigned-PUT/HEAD/GET/physical-digest/atomic-conditional-create/replay/tamper/checksum/CORS');
} finally {
  // Only the exact new synthetic objects created by this probe are removed.
  for(const objectKey of [key,tamperKey,raceKey,checksumKey])await client.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey})).catch(()=>undefined);
  client.destroy();
}
