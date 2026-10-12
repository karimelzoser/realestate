import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '@preneura/database';
import {sql} from 'kysely';
import {DiscoveryRepository} from '../dist/discovery/discovery.repository.js';

const url=new URL(process.env.DATABASE_URL);
assert.equal(process.env.NODE_ENV,'test');assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
assert.ok(url.pathname.includes('discovery'),'A dedicated local discovery certification database is required.');
const db=createDatabase(url.toString());const tenant=randomUUID(),other=randomUUID(),actor=randomUUID(),first=randomUUID(),second=randomUUID(),unpublished=randomUUID();
const suffix=randomUUID().slice(0,8);const slug=`synthetic-${suffix}`;
const repository=new DiscoveryRepository(db);
let application;
const input={slug,titleEn:`Synthetic Cairo project ${suffix}`,titleAr:`مشروع القاهرة الاختباري ${suffix}`,descriptionEn:'Explicitly published synthetic public description.',descriptionAr:'وصف عام منشور صراحة لمشروع اختباري.',locationEn:`Cairo ${suffix}`,locationAr:`القاهرة ${suffix}`,status:'PUBLISHED',reason:'Synthetic approved publication for local certification.'};
try{
  await sql`INSERT INTO tenants(id,code,name) VALUES(${tenant}::uuid,${'SYNTH-'+suffix},'Private legal/customer records'),(${other}::uuid,${'OTHER-'+suffix},'Other tenant')`.execute(db);
  await sql`INSERT INTO users(id,display_name,status) VALUES(${actor}::uuid,'Synthetic reviewer','ACTIVE')`.execute(db);
  await sql`INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES(${tenant}::uuid,${actor}::uuid,'ACTIVE')`.execute(db);
  await sql`INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,status) VALUES(${actor}::uuid,'MANAGER','TENANT',${tenant}::uuid,'ACTIVE')`.execute(db);
  await sql`INSERT INTO projects(id,tenant_id,code,name,status) VALUES(${first}::uuid,${tenant}::uuid,'ONE','Internal project name','ACTIVE'),(${second}::uuid,${tenant}::uuid,'TWO','Second internal','ACTIVE'),(${unpublished}::uuid,${tenant}::uuid,'PRIVATE','Never published','ACTIVE')`.execute(db);
  await repository.publish(actor,tenant,first,input);await repository.publish(actor,tenant,second,{...input,slug:slug+'-two'});
  const page=await repository.list({q:suffix,limit:1});assert.equal(page.items.length,1);assert.ok(page.nextCursor);
  const next=await repository.list({q:suffix,after:page.nextCursor,limit:1});assert.equal(next.items.length,1);assert.notEqual(next.items[0].slug,page.items[0].slug);
  assert.deepEqual(Object.keys(page.items[0]).sort(),['description','location','slug','title']);assert.ok(!JSON.stringify(page).includes('Private legal/customer'));
  assert.equal((await repository.list({q:`القاهرة ${suffix}`,limit:12})).items.length,2);
  assert.equal((await repository.list({q:"%' OR 1=1 --",limit:12})).items.length,0);
  assert.equal(await repository.detail('never-published'),null);
  await sql`UPDATE projects SET status='PAUSED' WHERE id=${first}::uuid`.execute(db);
  assert.equal(await repository.detail(slug),null);
  await assert.rejects(()=>repository.publish(actor,tenant,first,input),/active tenant\/project/);
  await sql`UPDATE projects SET status='ACTIVE' WHERE id=${first}::uuid`.execute(db);
  await sql`UPDATE tenants SET status='SUSPENDED' WHERE id=${tenant}::uuid`.execute(db);
  assert.equal((await repository.list({q:suffix,limit:12})).items.length,0);assert.equal(await repository.detail(slug),null);
  await assert.rejects(()=>repository.publish(actor,other,first,input),/matching scope/);
  await sql`UPDATE tenants SET status='ACTIVE' WHERE id=${tenant}::uuid`.execute(db);
  await repository.publish(actor,tenant,first,{...input,status:'UNPUBLISHED'});assert.equal(await repository.detail(slug),null);
  const events=(await sql`SELECT id FROM project_publication_events WHERE project_id=${first}::uuid`.execute(db)).rows;assert.equal(events.length,2);
  await assert.rejects(()=>sql`DELETE FROM project_publication_events WHERE project_id=${first}::uuid`.execute(db),/append-only/);
  // Start the real Nest/Fastify application against this disposable database.
  // No session, OTP, payment or external provider is synthesized for these
  // anonymous reads and unauthenticated-publication negative checks.
  process.env.PORT='4147';process.env.WEB_ORIGIN='http://127.0.0.1:3042';
  // Unused storage configuration only satisfies construction of the full app;
  // no storage/provider operation is performed or certified by this script.
  process.env.OBJECT_STORAGE_BUCKET='synthetic-unused-discovery';
  process.env.OBJECT_STORAGE_ENDPOINT='http://127.0.0.1:1';
  process.env.OBJECT_STORAGE_ACCESS_KEY_ID='synthetic-unused';
  process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY='synthetic-unused';
  process.env.AWS_EC2_METADATA_DISABLED='true';
  application=await (await import('../dist/main.js')).apiStartup;
  const origin='http://127.0.0.1:4147/v1';
  const publicResponse=await fetch(`${origin}/public/projects?q=${suffix}`);assert.equal(publicResponse.status,200);
  const publicPage=await publicResponse.json();assert.equal(publicPage.items.length,1);assert.equal(publicPage.items[0].slug,slug+'-two');
  assert.equal((await fetch(`${origin}/public/projects/${slug}`)).status,404);
  assert.equal((await fetch(`${origin}/public/projects?limit=25`)).status,400);
  const denied=await fetch(`${origin}/tenants/${tenant}/projects/${second}/publication`,{method:'PUT',headers:{'content-type':'application/json',origin:process.env.WEB_ORIGIN},body:JSON.stringify(input)});
  assert.equal(denied.status,401);
  await sql`UPDATE access_role_assignments SET revoked_at=now() WHERE user_id=${actor}::uuid`.execute(db);
  await assert.rejects(()=>repository.publish(actor,tenant,second,{...input,slug:slug+'-two'}),/current scoped manager authority/);
  await assert.rejects(()=>sql`DELETE FROM project_publications WHERE project_id=${second}::uuid`.execute(db),/audited status change/);
  console.log('PUBLIC_DISCOVERY_CERTIFICATION_OK actual DB and real HTTP publication/privacy/lifecycle/Arabic search/cursor/scope/audit, anonymous mutation denied; fixtures remain local and synthetic');
}finally{if(application)await application.close();await db.destroy();}
