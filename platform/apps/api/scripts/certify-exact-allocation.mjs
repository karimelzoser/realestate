import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { AllocationRoleRepository } from '../dist/sales/allocation-role.repository.js';
import { SalesRepository } from '../dist/sales/sales.repository.js';
import { TransactionPriceRepository } from '../dist/sales/transaction-price.repository.js';
import { PropertyRepository } from '../dist/property/property.repository.js';

const url=process.env.DATABASE_URL;
if (!url || process.env.NODE_ENV!=='test' || !['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Exact allocation certification requires a disposable loopback database and NODE_ENV=test.');
}
const pool=new pg.Pool({ connectionString:url,max:12 });
const db=new Kysely({ dialect:new PostgresDialect({ pool }) });
const allocate=new AllocationRoleRepository(db), sales=new SalesRepository(db);
const query=(text,values=[])=>pool.query(text,values);
const tenantId=randomUUID(),projectId=randomUUID(),typeA=randomUUID(),typeB=randomUUID(),policyId=randomUUID(),price1=randomUUID(),price2=randomUUID();
const buildingId=randomUUID(),floorId=randomUUID(),apartment1=randomUUID(),apartment2=randomUUID(),wrongTypeApartment=randomUUID();
const actors=[randomUUID(),randomUUID()],buyers=[randomUUID(),randomUUID()];
const buyerProfiles=[randomUUID(),randomUUID()],queues=[randomUUID(),randomUUID()];

async function publishPrice(id,version,indoorRate) {
  await query(`INSERT INTO pricing_versions(id,tenant_id,project_id,version_number,label,status,effective_at,created_by)
    VALUES($1,$2,$3,$4,$5,'DRAFT',clock_timestamp()-interval '1 second',$6)`,[id,tenantId,projectId,version,`Exact price ${version}`,actors[0]]);
  await query(`INSERT INTO pricing_rates(tenant_id,project_id,pricing_version_id,unit_type_id,component,rate_per_sqm)
    SELECT $1,$2,$3,t,c.component,c.rate FROM unnest($4::uuid[]) t
    CROSS JOIN(VALUES('INDOOR',$5::numeric),('ROOF',0::numeric),('GARDEN',100::numeric)) c(component,rate)`,[tenantId,projectId,id,[typeA,typeB],indoorRate]);
  await query(`UPDATE pricing_versions SET status='PUBLISHED',published_at=clock_timestamp(),published_by=$2 WHERE id=$1`,[id,actors[0]]);
}

try {
  for (const [i,id] of [...actors,...buyers].entries()) await query(`INSERT INTO users(id,display_name,status) VALUES($1,$2,'ACTIVE')`,[id,`Synthetic exact allocation actor ${i}`]);
  await query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,'Exact allocation certification','ACTIVE')`,[tenantId,`EXACT-${tenantId}`]);
  await query(`INSERT INTO projects(id,tenant_id,code,name,status,currency,timezone) VALUES($1,$2,'EXACT','Exact project','ACTIVE','EGP','Africa/Cairo')`,[projectId,tenantId]);
  for (const id of [...actors,...buyers]) await query(`INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES($1,$2,'ACTIVE')`,[tenantId,id]);
  for (const id of actors) await query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,project_id,status)
    VALUES($1,'ALLOCATOR','PROJECT',$2,$3,'ACTIVE')`,[id,tenantId,projectId]);
  for (const id of buyers) await query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,project_id,status)
    VALUES($1,'BUYER','PROJECT',$2,$3,'ACTIVE')`,[id,tenantId,projectId]);
  await query(`INSERT INTO catalog_unit_types(id,tenant_id,project_id,code,name,indoor_area_sqm,garden_area_sqm,status)
    VALUES($1,$3,$4,'A','EOI Type A',100,10,'ACTIVE'),($2,$3,$4,'B','Wrong EOI Type B',100,10,'ACTIVE')`,[typeA,typeB,tenantId,projectId]);
  await query(`INSERT INTO project_buildings(id,tenant_id,project_id,code,name,status) VALUES($1,$2,$3,'B1','Building One','ACTIVE')`,[buildingId,tenantId,projectId]);
  await query(`INSERT INTO project_floors(id,tenant_id,project_id,building_id,code,name,level_number,status)
    VALUES($1,$2,$3,$4,'F1','First Floor',1,'ACTIVE')`,[floorId,tenantId,projectId,buildingId]);
  for (const [i,id] of [apartment1,apartment2,wrongTypeApartment].entries()) {
    await query(`INSERT INTO physical_units(id,tenant_id,project_id,building_id,floor_id,unit_type_id,internal_reference,display_reference,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,'ACTIVE')`,[id,tenantId,projectId,buildingId,floorId,i===2?typeB:typeA,`B1-F1-U${i+1}`]);
    await query(`INSERT INTO inventory_slots(tenant_id,project_id,unit_type_id,physical_unit_id,state,internal_reference)
      VALUES($1,$2,$3,$4,'AVAILABLE',$5)`,[tenantId,projectId,i===2?typeB:typeA,id,`SLOT-${i+1}`]);
  }
  await publishPrice(price1,1,'1000');
  await query(`INSERT INTO eoi_refund_policies(id,tenant_id,project_id,version_number,name,status,eoi_amount,currency,effective_at,published_at)
    VALUES($1,$2,$3,1,'Exact EOI policy','ACTIVE',25000,'EGP',now()-interval '1 day',now())`,[policyId,tenantId,projectId]);
  for (let i=0;i<2;i++) {
    await query(`INSERT INTO buyer_profiles(id,tenant_id,user_id,status,source,created_by) VALUES($1,$2,$3,'ACTIVE','DIRECT',$3)`,[buyerProfiles[i],tenantId,buyers[i]]);
    const eoi=await sales.createEoi({ actorUserId:buyers[i],tenantId,projectId,buyerProfileId:buyerProfiles[i],unitTypeId:typeA,refundPolicyId:policyId,now:new Date() });
    await query(`SELECT preneura_post_eoi_payment($1,$2,$3,$4,$5)`,[tenantId,projectId,eoi.eoiId,`SYNTHETIC-EXACT-EOI-${i}`,actors[0]]);
    await query(`INSERT INTO queue_entries(id,tenant_id,project_id,buyer_profile_id,eoi_id,status,called_at,allocator_user_id,allocator_assigned_at)
      VALUES($1,$2,$3,$4,$5,'CALLED',clock_timestamp(),$6,clock_timestamp())`,[queues[i],tenantId,projectId,buyerProfiles[i],eoi.eoiId,actors[i]]);
  }
  const scope={ tenantId,projectId,allocatorUserId:actors[0] };
  const page=await allocate.eligibleApartments({ ...scope,filters:{ limit:1 } });
  assert.equal(page.items.length,1); assert.ok(page.nextCursor);
  const next=await allocate.eligibleApartments({ ...scope,filters:{ limit:1,after:page.nextCursor } });
  assert.equal(next.items.length,1); assert.equal(next.nextCursor,null);
  assert.notEqual(page.items[0].physicalUnitId,next.items[0].physicalUnitId);
  assert.ok([...page.items,...next.items].every(item=>item.unitTypeId===typeA));
  await assert.rejects(allocate.quoteApartment({ ...scope,queueEntryId:queues[0],physicalUnitId:wrongTypeApartment }),/not eligible/);
  await assert.rejects(allocate.quoteApartment({ ...scope,queueEntryId:queues[1],physicalUnitId:apartment1 }),/not eligible/);
  const quotes=await Promise.all(actors.map((allocatorUserId,i)=>allocate.quoteApartment({ tenantId,projectId,allocatorUserId,queueEntryId:queues[i],physicalUnitId:apartment1 })));
  assert.equal(quotes[0].quotedTotal,'101000.00');
  const keys=[randomUUID(),randomUUID()];
  const attempts=await Promise.allSettled(actors.map((allocatorUserId,i)=>allocate.createAssignedLock({ tenantId,projectId,allocatorUserId,quoteId:quotes[i].quoteId,idempotencyKey:keys[i],ttlSeconds:900 })));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1,'one requested apartment must have exactly one winner');
  const winner=attempts.findIndex(x=>x.status==='fulfilled'),loser=1-winner;
  const lock=attempts[winner].value;
  assert.equal(lock.physicalUnitId,apartment1); assert.equal(lock.status,'ACTIVE');
  assert.equal((await query(`SELECT count(*)::int AS n FROM inventory_locks WHERE project_id=$1 AND status='ACTIVE'`,[projectId])).rows[0].n,1);
  const retry=await allocate.createAssignedLock({ tenantId,projectId,allocatorUserId:actors[winner],quoteId:quotes[winner].quoteId,idempotencyKey:keys[winner],ttlSeconds:900 });
  assert.equal(retry.lockId,lock.lockId);
  await assert.rejects(allocate.createAssignedLock({ tenantId,projectId,allocatorUserId:actors[winner],quoteId:quotes[winner].quoteId,idempotencyKey:keys[winner],ttlSeconds:60 }),/different lock request/);
  await assert.rejects(query(`UPDATE inventory_locks SET physical_unit_id=$2 WHERE id=$1`,[lock.lockId,apartment2]),/immutable/);
  await assert.rejects(query(`UPDATE allocation_quotes SET quoted_total=1 WHERE id=$1`,[quotes[winner].quoteId]),/immutable/);
  await assert.rejects(query(`UPDATE physical_units SET display_reference='SILENT-SUBSTITUTE' WHERE id=$1`,[apartment1]),/immutable/);
  const stale=await allocate.quoteApartment({ tenantId,projectId,allocatorUserId:actors[loser],queueEntryId:queues[loser],physicalUnitId:apartment2 });
  await publishPrice(price2,2,'2000');
  await query(`UPDATE pricing_versions SET status='SUPERSEDED' WHERE id=$1`,[price1]);
  await assert.rejects(allocate.createAssignedLock({ tenantId,projectId,allocatorUserId:actors[loser],quoteId:stale.quoteId,idempotencyKey:randomUUID(),ttlSeconds:900 }),/pricing changed/);
  const reserveInput={ actorUserId:actors[winner],tenantId,projectId,buyerProfileId:buyerProfiles[winner],queueEntryId:queues[winner],lockId:lock.lockId,now:new Date() };
  await query(`UPDATE tenant_memberships SET status='SUSPENDED' WHERE tenant_id=$1 AND user_id=$2`,[tenantId,buyers[winner]]);
  await assert.rejects(sales.convertLockToReservation(reserveInput),/eligibility changed/);
  assert.equal((await query(`SELECT status FROM inventory_locks WHERE id=$1`,[lock.lockId])).rows[0].status,'ACTIVE','failed conversion must roll back the hold');
  await query(`UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=$1 AND user_id=$2`,[tenantId,buyers[winner]]);
  const [reservation,reservationRetry]=await Promise.all([sales.convertLockToReservation(reserveInput),sales.convertLockToReservation(reserveInput)]);
  assert.equal(reservation.reservationId,reservationRetry.reservationId);
  assert.equal(reservation.physicalUnitId,apartment1); assert.equal(reservation.quotedTotal,'101000.00');
  assert.equal(reservation.apartment.apartmentReference,'B1-F1-U1');
  const price=await new TransactionPriceRepository(db).getSnapshot({ tenantId,projectId,transactionId:reservation.transactionId });
  assert.equal(price.physicalUnitId,apartment1); assert.equal(price.quotedTotal,'101000.00');
  const properties=await new PropertyRepository(db).listBuyerProperties({ tenantId,projectId,buyerUserId:buyers[winner],now:new Date() });
  assert.equal(properties.length,1); assert.equal(properties[0].physicalUnitId,apartment1);
  assert.equal(properties[0].apartment.floorName,'First Floor');
  assert.equal((await query(`SELECT count(*)::int AS n FROM transaction_events WHERE transaction_id=$1 AND event_type='reservation.created'`,[reservation.transactionId])).rows[0].n,1);
  const convertedReplay=await allocate.createAssignedLock({tenantId,projectId,allocatorUserId:actors[winner],quoteId:quotes[winner].quoteId,idempotencyKey:keys[winner],ttlSeconds:900});
  assert.equal(convertedReplay.lockId,lock.lockId);assert.equal(convertedReplay.status,'CONVERTED','retry must not create a fresh hold after conversion');
  // Simulated trusted objects/signatures certify database evidence only, never live scanner or legal acceptance.
  async function trustedObject(purpose,key,hash,bytes) {
    const trust=(await query(`INSERT INTO storage_object_trust(tenant_id,project_id,purpose,object_key,declared_mime_type,byte_size,sha256_hex,status)
      VALUES($1,$2,$3,$4,'application/pdf',$5,$6,'PENDING_SCAN') RETURNING id`,[tenantId,projectId,purpose,key,bytes,hash])).rows[0].id;
    await query(`INSERT INTO storage_object_scan_attempts(object_trust_id,attempt_number,provider,result,detected_mime_type,engine_version,provider_reference,started_at,completed_at)
      VALUES($1,1,'SYNTHETIC_CERTIFICATION','CLEAN','application/pdf','1',$2,clock_timestamp(),clock_timestamp())`,[trust,key]);
    await query(`UPDATE storage_object_trust SET status='CLEAN',detected_mime_type='application/pdf',scanner_provider='SYNTHETIC_CERTIFICATION',scanner_reference=$2,
      scanned_at=(SELECT completed_at FROM storage_object_scan_attempts WHERE object_trust_id=$1 AND attempt_number=1) WHERE id=$1`,[trust,key]);
    return trust;
  }
  const templateKey=`exact/${tenantId}/template.pdf`,documentKey=`exact/${tenantId}/contract.pdf`;
  await trustedObject('DOCUMENT_TEMPLATE',templateKey,'a'.repeat(64),1200);
  const template=(await query(`INSERT INTO document_templates(tenant_id,project_id,code,name,category,version_number,status,storage_object_key,sha256_hex,mime_type,requires_signature,created_by,activated_at)
    VALUES($1,$2,'EXACT','Exact synthetic contract','CONTRACT',1,'ACTIVE',$3,$4,'application/pdf',true,$5,clock_timestamp()) RETURNING id`,[tenantId,projectId,templateKey,'a'.repeat(64),actors[winner]])).rows[0].id;
  await query(`INSERT INTO document_template_signer_requirements(template_id,signer_role,signing_order,required) VALUES($1,'BUYER',1,true),($1,'COMPANY',2,true)`,[template]);
  await trustedObject('TRANSACTION_DOCUMENT',documentKey,'b'.repeat(64),5000);
  const document=(await query(`INSERT INTO transaction_documents(tenant_id,project_id,transaction_id,template_id,category,revision_number,status,storage_object_key,original_filename,mime_type,byte_size,sha256_hex,uploaded_by,uploaded_at)
    VALUES($1,$2,$3,$4,'CONTRACT',1,'UPLOADED',$5,'synthetic.pdf','application/pdf',5000,$6,$7,clock_timestamp()) RETURNING id`,[tenantId,projectId,reservation.transactionId,template,documentKey,'b'.repeat(64),actors[winner]])).rows[0].id;
  await query(`UPDATE transaction_documents SET status='VERIFIED',verified_by=$2,verified_at=clock_timestamp() WHERE id=$1`,[document,actors[winner]]);
  await query(`INSERT INTO document_signatures(document_id,signer_role,signer_user_id,method,typed_name,signed_at) VALUES($1,'BUYER',$2,'TYPED','Synthetic buyer',clock_timestamp())`,[document,buyers[winner]]);
  await query(`INSERT INTO document_signatures(document_id,signer_role,signer_user_id,method,typed_name,signed_at) VALUES($1,'COMPANY',$2,'TYPED','Synthetic company',clock_timestamp())`,[document,actors[winner]]);
  await query(`UPDATE transaction_documents SET status='SIGNED' WHERE id=$1`,[document]);
  await query(`UPDATE transaction_documents SET status='STAMPED',stamped_by=$2,stamped_at=clock_timestamp() WHERE id=$1`,[document,actors[winner]]);
  const executed=(await query(`SELECT manifest,manifest_sha256_hex,encode(digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex') AS computed FROM contract_execution_snapshots WHERE document_id=$1`,[document])).rows[0];
  assert.equal(executed.manifest.schemaVersion,2);assert.equal(executed.manifest.physicalUnitId,apartment1);
  assert.equal(executed.manifest.apartment.apartmentReference,'B1-F1-U1');assert.equal(executed.manifest_sha256_hex,executed.computed);
  await assert.rejects(query(`UPDATE contract_execution_snapshots SET manifest='{}'::jsonb WHERE document_id=$1`,[document]),/immutable/);
  const fresh=await allocate.quoteApartment({tenantId,projectId,allocatorUserId:actors[loser],queueEntryId:queues[loser],physicalUnitId:apartment2});
  const expiredKey=randomUUID();
  const shortHold=await allocate.createAssignedLock({tenantId,projectId,allocatorUserId:actors[loser],quoteId:fresh.quoteId,idempotencyKey:expiredKey,ttlSeconds:60});
  // Advance the existing expiry function's explicit clock only in this disposable certification database.
  await query(`SELECT preneura_expire_inventory_locks(500,clock_timestamp()+interval '61 seconds')`);
  const expiredReplay=await allocate.createAssignedLock({tenantId,projectId,allocatorUserId:actors[loser],quoteId:fresh.quoteId,idempotencyKey:expiredKey,ttlSeconds:60});
  assert.equal(expiredReplay.lockId,shortHold.lockId);assert.equal(expiredReplay.status,'EXPIRED');
  await assert.rejects(sales.convertLockToReservation({actorUserId:actors[loser],tenantId,projectId,buyerProfileId:buyerProfiles[loser],queueEntryId:queues[loser],lockId:shortHold.lockId,now:new Date()}),/missing or expired/);
  assert.equal((await query(`SELECT state FROM inventory_slots WHERE physical_unit_id=$1`,[apartment2])).rows[0].state,'AVAILABLE');
  assert.equal((await query(`SELECT status FROM queue_entries WHERE id=$1`,[queues[loser]])).rows[0].status,'CALLED');
  await query(`UPDATE access_role_assignments SET status='SUSPENDED',revoked_at=clock_timestamp() WHERE user_id=$1 AND role_code='BUYER'`,[buyers[loser]]);
  await assert.rejects(allocate.quoteApartment({tenantId,projectId,allocatorUserId:actors[loser],queueEntryId:queues[loser],physicalUnitId:apartment2}),/not eligible/);
  await query(`UPDATE access_role_assignments SET status='ACTIVE',revoked_at=NULL WHERE user_id=$1 AND role_code='BUYER'`,[buyers[loser]]);
  console.log(JSON.stringify({ result:'E07_EXACT_ALLOCATION_CERTIFICATION_OK',requestedApartmentRace:true,idempotentLockAndReservation:true,
    originalEoiTypeEnforced:true,acceptedPricePreservedAfterChange:true,immutableIdentity:true,propertyAndPricePropagation:true,pagedEligibility:true,
    conversionEligibilityRevalidated:true,terminalRetryPreserved:true,expiredHoldCannotReserve:true,revokedBuyerCannotQuote:true,executedContractApartmentHashBound:true }));
} finally { await db.destroy(); }
