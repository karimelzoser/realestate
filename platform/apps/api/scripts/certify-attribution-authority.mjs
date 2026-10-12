import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {Kysely,PostgresDialect} from 'kysely';
import {SalesRepository} from '../dist/sales/sales.repository.js';
import {SalesService} from '../dist/sales/sales.service.js';
import {AllocationRoleRepository} from '../dist/sales/allocation-role.repository.js';
import {BrokerageOnboardingRepository} from '../dist/brokerage-onboarding/brokerage-onboarding.repository.js';
import {PostgresAccessRepository} from '../dist/access/access.repository.js';
import {AccessService} from '../dist/access/access.service.js';
import {AccessLifecycleService} from '../dist/access/access-lifecycle.service.js';
import {CommissionRepository} from '../dist/commissions/commission.repository.js';
import {CommissionService} from '../dist/commissions/commission.service.js';
import {TransactionListRepository} from '../dist/sales/transaction-list.repository.js';
import {FinanceRepository} from '../dist/finance/finance.repository.js';
import {FinanceLedgerRepository} from '../dist/finance/finance-ledger.repository.js';
import {FinanceService} from '../dist/finance/finance.service.js';
import {ExportService} from '../dist/exports/export.service.js';
import {EoiListRepository} from '../dist/sales/eoi-list.repository.js';
import {SalesBuyerListRepository} from '../dist/sales/sales-buyer-list.repository.js';
import {scheduleMilestoneReminders} from '../../worker/dist/milestone-reminders.js';
import {scheduleInstallmentReminders} from '../../worker/dist/installment-reminders.js';

const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Attribution certification requires a disposable loopback test database.');
const pool=new pg.Pool({connectionString:url,max:12}),db=new Kysely({dialect:new PostgresDialect({pool})});
const query=(text,params=[])=>pool.query(text,params);
const id=()=>randomUUID();
const tenant=id(),project=id(),project2=id(),buyer=id(),reviewers=[id(),id()],brokerManagers=[id(),id()],agents=[id(),id()],finances=[id(),id()],companies=[id(),id()],type=id(),pricing=id(),policy=id(),building=id(),floor=id(),apartments=[id(),id()];
const access=new AccessService(new PostgresAccessRepository(db),new AccessLifecycleService(db));
const sales=new SalesRepository(db),salesService=new SalesService(sales,access,{}),allocation=new AllocationRoleRepository(db),brokerage=new BrokerageOnboardingRepository(db);
const commissions=new CommissionRepository(db),commissionService=new CommissionService(commissions,access);
const financeRepo=new FinanceRepository(db),finance=new FinanceService(financeRepo,new FinanceLedgerRepository(db),access,commissionService);
const transactions=new TransactionListRepository(db),exports=new ExportService(db,access);
const scope={tenantId:tenant,projectId:project};
async function role(user,code,company=null,projectId=project) {
  await query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,tenant_id,project_id,broker_company_id,status)
    VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')`,[user,code,company?'BROKER_COMPANY':'PROJECT',tenant,company?null:projectId,company]);
}
try {
  for(const [i,user] of [buyer,...reviewers,...brokerManagers,...agents,...finances].entries())await query(`INSERT INTO users(id,display_name,status) VALUES($1,$2,'ACTIVE')`,[user,`Synthetic attribution actor ${i}`]);
  await query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,'Attribution certification','ACTIVE')`,[tenant,`ATTR-${tenant}`]);
  await query(`INSERT INTO projects(id,tenant_id,code,name,status,currency,timezone) VALUES($1,$2,'ATTR','Synthetic attribution project','ACTIVE','EGP','Africa/Cairo')`,[project,tenant]);
  await query(`INSERT INTO projects(id,tenant_id,code,name,status,currency,timezone) VALUES($1,$2,'ATTR2','Independent project','ACTIVE','EGP','Africa/Cairo')`,[project2,tenant]);
  for(const user of [buyer,...reviewers,...brokerManagers,...agents,...finances])await query(`INSERT INTO tenant_memberships(tenant_id,user_id,status) VALUES($1,$2,'ACTIVE')`,[tenant,user]);
  await role(buyer,'BUYER');await role(buyer,'BUYER',null,project2);for(const reviewer of reviewers){await role(reviewer,'MANAGER');await role(reviewer,'MANAGER',null,project2);}await role(reviewers[0],'ALLOCATOR');await role(reviewers[0],'ALLOCATOR',null,project2);
  for(let i=0;i<2;i++) {
    const org=id(),agreement=id();
    await query(`INSERT INTO broker_companies(id,tenant_id,code,name,status) VALUES($1,$2,$3,$4,'ACTIVE')`,[companies[i],tenant,`B${i}`,`Brokerage ${i}`]);
    await query(`INSERT INTO brokerage_organizations(id,code,display_name_en,display_name_ar,status) VALUES($1,$2,$3,$3,'ACTIVE')`,[org,`ATTR_${org.replaceAll('-','').toUpperCase()}`,`Synthetic brokerage ${i}`]);
    await query(`INSERT INTO brokerage_tenant_links(organization_id,tenant_id,broker_company_id,status) VALUES($1,$2,$3,'ACTIVE')`,[org,tenant,companies[i]]);
    await query(`INSERT INTO brokerage_agreements(id,organization_id,tenant_id,broker_company_id,version_number,agreement_code,status,effective_from,approved_at)
      VALUES($1,$2,$3,$4,1,$5,'ACTIVE',now()-interval '1 day',now())`,[agreement,org,tenant,companies[i],`A${i}`]);
    await query(`INSERT INTO brokerage_agreement_projects(agreement_id,tenant_id,project_id,status,effective_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')`,[agreement,tenant,project]);
    await query(`INSERT INTO brokerage_agreement_projects(agreement_id,tenant_id,project_id,status,effective_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')`,[agreement,tenant,project2]);
    await query(`INSERT INTO broker_project_access(broker_company_id,tenant_id,project_id,status,effective_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')`,[companies[i],tenant,project]);
    await query(`INSERT INTO broker_project_access(broker_company_id,tenant_id,project_id,status,effective_from) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day')`,[companies[i],tenant,project2]);
    await role(brokerManagers[i],'BROKER_MANAGER',companies[i]);await role(agents[i],'BROKER_AGENT',companies[i]);await role(finances[i],'BROKER_FINANCE',companies[i]);
    await query(`INSERT INTO broker_commission_plans(tenant_id,project_id,broker_company_id,version_number,status,rate_percent,due_days_after_eligibility,effective_at,activated_at)
      VALUES($1,$2,$3,1,'ACTIVE',$4,30,now()-interval '1 day',now())`,[tenant,project,companies[i],i===0?'5':'8']);
    await query(`INSERT INTO broker_commission_plans(tenant_id,project_id,broker_company_id,version_number,status,rate_percent,due_days_after_eligibility,effective_at,activated_at) VALUES($1,$2,$3,1,'ACTIVE',$4,30,now()-interval '1 day',now())`,[tenant,project2,companies[i],i===0?'5':'8']);
  }
  const input={actorUserId:brokerManagers[0],data:{...scope,userId:buyer,source:'BROKER',brokerCompanyId:companies[0],brokerAgentUserId:agents[0]}};
  const [created,retried]=await Promise.all([salesService.createBuyerProfile(input),salesService.createBuyerProfile(input)]);
  assert.equal(created.buyerProfileId,retried.buyerProfileId);const profile=created.buyerProfileId;
  const own=await salesService.createBuyerProfile({actorUserId:buyer,data:{...scope,userId:buyer,source:'DIRECT'}});
  assert.equal(own.buyerProfileId,profile);
  assert.equal((await query(`SELECT broker_company_id FROM buyer_project_attributions WHERE buyer_profile_id=$1 AND project_id='${project}'`,[profile])).rows[0].broker_company_id,companies[0]);
  await assert.rejects(salesService.createBuyerProfile({actorUserId:brokerManagers[1],data:{...scope,userId:buyer,source:'BROKER',brokerCompanyId:companies[1],brokerAgentUserId:agents[1]}}),/approved transfer/);
  await assert.rejects(salesService.createBuyerProfile({actorUserId:brokerManagers[0],data:{...input.data,brokerAgentUserId:agents[1]}}),/not eligible/);
  assert.equal((await query(`SELECT count(*)::int AS n FROM domain_outbox_events WHERE aggregate_id=$1 AND event_type='buyer.profile.upserted'`,[profile])).rows[0].n,1);
  assert.equal((await query(`SELECT count(*)::int AS n FROM brokerage_attribution_history WHERE buyer_profile_id=$1 AND project_id='${project}' AND event_type='INITIAL'`,[profile])).rows[0].n,1);
  await query(`UPDATE buyer_profiles SET status='BLOCKED' WHERE id=$1`,[profile]);
  await assert.rejects(salesService.createBuyerProfile(input),/lifecycle/);await query(`UPDATE buyer_profiles SET status='ACTIVE' WHERE id=$1`,[profile]);
  await assert.rejects(query(`UPDATE buyer_profiles SET source='DIRECT',broker_company_id=NULL,broker_agent_user_id=NULL WHERE id=$1`,[profile]),/cannot be changed directly/);
  const spoof=await pool.connect();try {await spoof.query('BEGIN');await spoof.query(`SELECT set_config('preneura.attribution_projection','on',true)`);
    await assert.rejects(spoof.query(`UPDATE buyer_project_attributions SET broker_company_id=$2 WHERE buyer_profile_id=$1 AND project_id='${project}'`,[profile,companies[1]]),/approved-transfer-derived/);
    await spoof.query('ROLLBACK');}finally{spoof.release();}

  const type2=id(),pricing2=id(),policy2=id(),building2=id(),floor2=id();
  const graph=[{projectId:project,typeId:type,priceId:pricing,policyId:policy,buildingId:building,floorId:floor},{projectId:project2,typeId:type2,priceId:pricing2,policyId:policy2,buildingId:building2,floorId:floor2}];
  for(const [i,{projectId,typeId,priceId,policyId,buildingId,floorId}] of graph.entries()) {
  await query(`INSERT INTO catalog_unit_types(id,tenant_id,project_id,code,name,indoor_area_sqm,status) VALUES($1,$2,$3,'ATTR','Synthetic type',100,'ACTIVE')`,[typeId,tenant,projectId]);
  await query(`INSERT INTO pricing_versions(id,tenant_id,project_id,version_number,label,status,effective_at,created_by)
    VALUES($1,$2,$3,1,'Attribution price','DRAFT',now()-interval '1 minute',$4)`,[priceId,tenant,projectId,reviewers[0]]);
  await query(`INSERT INTO pricing_rates(tenant_id,project_id,pricing_version_id,unit_type_id,component,rate_per_sqm)
    SELECT $1,$2,$3,$4,c,r FROM(VALUES('INDOOR',1000::numeric),('ROOF',0::numeric),('GARDEN',0::numeric)) p(c,r)`,[tenant,projectId,priceId,typeId]);
  await query(`UPDATE pricing_versions SET status='PUBLISHED',published_at=now(),published_by=$2 WHERE id=$1`,[priceId,reviewers[0]]);
  await query(`INSERT INTO eoi_refund_policies(id,tenant_id,project_id,version_number,name,status,eoi_amount,currency,effective_at,published_at)
    VALUES($1,$2,$3,1,'Synthetic policy','ACTIVE',25000,'EGP',now()-interval '1 day',now())`,[policyId,tenant,projectId]);
  await query(`INSERT INTO project_buildings(id,tenant_id,project_id,code,name,status) VALUES($1,$2,$3,'B1','Synthetic building','ACTIVE')`,[buildingId,tenant,projectId]);
  await query(`INSERT INTO project_floors(id,tenant_id,project_id,building_id,code,name,level_number,status) VALUES($1,$2,$3,$4,'F1','Synthetic floor',1,'ACTIVE')`,[floorId,tenant,projectId,buildingId]);

    await query(`INSERT INTO physical_units(id,tenant_id,project_id,building_id,floor_id,unit_type_id,internal_reference,display_reference,status) VALUES($1,$2,$3,$4,$5,$6,$7,$7,'ACTIVE')`,[apartments[i],tenant,projectId,buildingId,floorId,typeId,`ATTR-U${i+1}`]);
    await query(`INSERT INTO inventory_slots(tenant_id,project_id,unit_type_id,physical_unit_id,state,internal_reference) VALUES($1,$2,$3,$4,'AVAILABLE',$5)`,[tenant,projectId,typeId,apartments[i],`ATTR-S${i+1}`]);
  }
  const futureScope={tenantId:tenant,projectId:project2};
  const joined2=await salesService.createBuyerProfile({actorUserId:buyer,data:{...futureScope,userId:buyer,source:'DIRECT'}});
  assert.equal(joined2.buyerProfileId,profile);
  async function book(i) {
    const selected=graph[i],bookScope={tenantId:tenant,projectId:selected.projectId};
    const eoi=await sales.createEoi({actorUserId:buyer,...bookScope,buyerProfileId:profile,unitTypeId:selected.typeId,refundPolicyId:selected.policyId,now:new Date()});
    await query(`SELECT preneura_post_eoi_payment($1,$2,$3,$4,$5)`,[tenant,selected.projectId,eoi.eoiId,`SYNTHETIC-ATTR-${i}`,reviewers[0]]);
    const queue=id();await query(`INSERT INTO queue_entries(id,tenant_id,project_id,buyer_profile_id,eoi_id,status,called_at,allocator_user_id,allocator_assigned_at)
      VALUES($1,$2,$3,$4,$5,'CALLED',now(),$6,now())`,[queue,tenant,selected.projectId,profile,eoi.eoiId,reviewers[0]]);
    const quote=await allocation.quoteApartment({...bookScope,allocatorUserId:reviewers[0],queueEntryId:queue,physicalUnitId:apartments[i]});
    const lock=await allocation.createAssignedLock({...bookScope,allocatorUserId:reviewers[0],quoteId:quote.quoteId,idempotencyKey:id(),ttlSeconds:900});
    return sales.convertLockToReservation({actorUserId:reviewers[0],...bookScope,buyerProfileId:profile,queueEntryId:queue,lockId:lock.lockId,now:new Date()});
  }
  const oldDeal=await book(0);
  const transfer=await brokerage.createTransfer({tenantId:tenant,actorUserId:reviewers[0],fromBrokerCompanyId:companies[0],fromBrokerAgentUserId:agents[0],
    data:{projectId:project,buyerProfileId:profile,toBrokerCompanyId:companies[1],toBrokerAgentUserId:agents[1],reason:'Synthetic approved prospective transfer'}});
  assert.equal(await brokerage.reviewTransfer({tenantId:id(),transferId:transfer,actorUserId:reviewers[0],decision:'APPROVED',note:'wrong scope'}),false);
  await assert.rejects(brokerage.reviewTransfer({tenantId:tenant,transferId:transfer,actorUserId:brokerManagers[1],decision:'APPROVED',note:'forbidden'}),/reviewer/);
  await query(`UPDATE tenant_memberships SET status='SUSPENDED' WHERE tenant_id=$1 AND user_id=$2`,[tenant,reviewers[0]]);
  await assert.rejects(brokerage.reviewTransfer({tenantId:tenant,transferId:transfer,actorUserId:reviewers[0],decision:'APPROVED',note:'inactive'}),/reviewer/);
  await query(`UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=$1 AND user_id=$2`,[tenant,reviewers[0]]);
  await query(`UPDATE broker_companies SET status='SUSPENDED' WHERE id=$1`,[companies[1]]);
  await assert.rejects(brokerage.reviewTransfer({tenantId:tenant,transferId:transfer,actorUserId:reviewers[0],decision:'APPROVED',note:'inactive target'}),/not eligible/);
  await query(`UPDATE broker_companies SET status='ACTIVE' WHERE id=$1`,[companies[1]]);
  const races=await Promise.allSettled([
    ...reviewers.map((actorUserId,i)=>brokerage.reviewTransfer({tenantId:tenant,transferId:transfer,actorUserId,decision:'APPROVED',note:`review ${i}`})),
    salesService.createBuyerProfile(input),
    brokerage.createTransfer({tenantId:tenant,actorUserId:reviewers[0],fromBrokerCompanyId:companies[0],fromBrokerAgentUserId:agents[0],
      data:{projectId:project,buyerProfileId:profile,toBrokerCompanyId:companies[1],toBrokerAgentUserId:agents[1],reason:'Concurrent request must not steal approval'}}),
  ]);
  assert.ok(races.every(result=>result.status==='fulfilled'||result.reason.code!=='40P01'),'Approval/request/profile lock ordering must not deadlock.');
  const approvals=races.slice(0,2);
  assert.equal(races[3].status,'rejected');
  if(races[2].status==='rejected')assert.match(races[2].reason.message,/approved transfer/);
  assert.equal(approvals.filter(result=>result.status==='fulfilled').length,1);const winner=approvals.findIndex(result=>result.status==='fulfilled');
  assert.equal(await brokerage.reviewTransfer({tenantId:tenant,transferId:transfer,actorUserId:reviewers[winner],decision:'APPROVED',note:`review ${winner}`}),true);
  assert.equal((await query(`SELECT attribution_revision FROM buyer_project_attributions WHERE buyer_profile_id=$1 AND project_id='${project}'`,[profile])).rows[0].attribution_revision,'1');
  assert.equal((await query(`SELECT count(*)::int AS n FROM brokerage_attribution_history WHERE transfer_id=$1`,[transfer])).rows[0].n,1);
  await assert.rejects(query(`UPDATE brokerage_attribution_transfers SET reviewed_by=$2 WHERE id=$1`,[transfer,reviewers[1-winner]]),/immutable/);
  await assert.rejects(query(`UPDATE reservations SET broker_company_id_snapshot=$2 WHERE id=$1`,[oldDeal.reservationId,companies[1]]),/immutable/);
  await assert.rejects(query(`UPDATE broker_commission_cases SET broker_agent_user_id=$2 WHERE transaction_id=$1`,[oldDeal.transactionId,agents[1]]),/immutable/);
  await commissions.refreshTransactionCase({...scope,transactionId:oldDeal.transactionId,now:new Date()});
  const caseA=(await query(`SELECT broker_company_id,broker_agent_user_id,commission_amount FROM broker_commission_cases WHERE transaction_id=$1`,[oldDeal.transactionId])).rows[0];
  assert.equal(caseA.broker_company_id,companies[0]);assert.equal(caseA.broker_agent_user_id,agents[0]);assert.equal(caseA.commission_amount,'5000.00');
  await salesService.getTransactionProgress({actorUserId:brokerManagers[0],...scope,transactionId:oldDeal.transactionId});
  await assert.rejects(salesService.getTransactionProgress({actorUserId:brokerManagers[1],...scope,transactionId:oldDeal.transactionId}),/permission/);
  assert.equal((await query(`SELECT source FROM buyer_project_attributions WHERE buyer_profile_id=$1 AND project_id=$2`,[profile,project2])).rows[0].source,'DIRECT','A project1 transfer must not affect project2');
  const scopedBuyers=await new SalesBuyerListRepository(db).list(futureScope);
  assert.equal(scopedBuyers.find(row=>row.buyerProfileId===profile).source,'DIRECT');
  const eois=new EoiListRepository(db);
  assert.equal((await eois.list({...scope,brokerCompanyIds:[companies[0]]})).length,0);
  assert.equal((await eois.list({...scope,brokerCompanyIds:[companies[1]]})).length,1);
  assert.equal((await eois.list({...scope,brokerCompanyIds:[]})).length,0);
  const transfer2=await brokerage.createTransfer({tenantId:tenant,actorUserId:reviewers[0],fromBrokerCompanyId:null,fromBrokerAgentUserId:null,data:{projectId:project2,buyerProfileId:profile,toBrokerCompanyId:companies[1],toBrokerAgentUserId:agents[1],reason:'Independent project2 transfer'}});
  await brokerage.reviewTransfer({tenantId:tenant,transferId:transfer2,actorUserId:reviewers[1],decision:'APPROVED',note:'project2 approved independently'});
  const newDeal=await book(1);
  assert.equal((await transactions.list({...scope,brokerCompanyIds:[companies[0]],brokerAgentUserId:agents[0]}))[0].transactionId,oldDeal.transactionId);
  assert.deepEqual((await transactions.list({...futureScope,brokerCompanyIds:[companies[1]]})).map(row=>row.transactionId),[newDeal.transactionId]);
  const oldFinance=await financeRepo.getTransactionContext({...scope,transactionId:oldDeal.transactionId});assert.equal(oldFinance.brokerCompanyId,companies[0]);
  await finance.createPaymentSchedule({actorUserId:reviewers[0],data:{...scope,transactionId:oldDeal.transactionId,currency:'EGP',totalContractAmount:'100000.00',
    items:[{sequenceNumber:1,itemType:'DOWN_PAYMENT',amount:'10000.00',dueAt:new Date().toISOString()},{sequenceNumber:2,itemType:'INSTALLMENT',amount:'90000.00',dueAt:new Date(Date.now()+86400000).toISOString()}]}});
  await finance.getPaymentSchedule({actorUserId:finances[0],...scope,transactionId:oldDeal.transactionId});
  await assert.rejects(finance.getPaymentSchedule({actorUserId:finances[1],...scope,transactionId:oldDeal.transactionId}),/permission/);
  const exportA=await exports.exportCsv({actorUserId:brokerManagers[0],...scope,dataset:'transactions'});
  const exportB=await exports.exportCsv({actorUserId:brokerManagers[1],...futureScope,dataset:'transactions'});
  assert.equal(exportA.rowCount,1);assert.ok(exportA.csv.includes(oldDeal.transactionId));assert.ok(!exportA.csv.includes(newDeal.transactionId));
  assert.equal(exportB.rowCount,1);assert.ok(!exportB.csv.includes(oldDeal.transactionId));
  const prospectsA=await exports.exportCsv({actorUserId:brokerManagers[0],...scope,dataset:'buyers'});
  const prospectsB=await exports.exportCsv({actorUserId:brokerManagers[1],...scope,dataset:'buyers'});
  assert.equal(prospectsA.rowCount,0);assert.equal(prospectsB.rowCount,1);
  const paymentsA=await exports.exportCsv({actorUserId:finances[0],...scope,dataset:'payments'});
  const paymentsB=await exports.exportCsv({actorUserId:finances[1],...scope,dataset:'payments'});
  assert.equal(paymentsA.rowCount,2);assert.equal(paymentsB.rowCount,0);
  await query(`INSERT INTO project_milestone_reminder_policies(tenant_id,project_id,milestone_code,target_hours_after_open,reminder_hours_before,audience,channel,template_code,locale)
    VALUES($1,$2,'DOWN_PAYMENT_RECEIVED',1,1,'BROKER_AGENT','IN_APP','SYNTHETIC_ATTR_MILESTONE','en')`,[tenant,project]);
  await query(`INSERT INTO project_installment_reminder_policies(tenant_id,project_id,item_type,audience,channel,reminder_hours_before,template_code,locale)
    VALUES($1,$2,'INSTALLMENT','BROKER_AGENT','IN_APP',48,'SYNTHETIC_ATTR_INSTALLMENT','en')`,[tenant,project]);
  await scheduleMilestoneReminders(db);await scheduleInstallmentReminders(db);
  const jobs=(await query(`SELECT recipient_user_id FROM notification_jobs WHERE transaction_id=$1 AND template_code LIKE 'SYNTHETIC_ATTR_%'`,[oldDeal.transactionId])).rows;
  assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.recipient_user_id===agents[0]),'Old deal reminders must not move to the new prospect agent.');
  const agentCases=await commissionService.listCases({actorUserId:agents[0],...scope,brokerCompanyId:companies[0]});
  assert.equal(agentCases.length,1);assert.equal(agentCases[0].transactionId,oldDeal.transactionId);
  for(const field of ['commissionAmount','ratePercent','basisAmount'])assert.equal(agentCases[0][field],undefined,'Agent confidential economics must stay redacted.');
  const rejected=await brokerage.createTransfer({tenantId:tenant,actorUserId:reviewers[0],fromBrokerCompanyId:companies[1],fromBrokerAgentUserId:agents[1],
    data:{projectId:project2,buyerProfileId:profile,toBrokerCompanyId:companies[1],toBrokerAgentUserId:null,reason:'Review an unassigned prospect pool'}});
  const rejectInput={tenantId:tenant,transferId:rejected,actorUserId:reviewers[1],decision:'REJECTED',note:'Keep current assignment'};
  assert.equal(await brokerage.reviewTransfer(rejectInput),true);assert.equal(await brokerage.reviewTransfer(rejectInput),true);
  await assert.rejects(query(`UPDATE brokerage_attribution_transfers SET status='APPROVED' WHERE id=$1`,[rejected]),/immutable/);
  const atomic=await brokerage.createTransfer({tenantId:tenant,actorUserId:reviewers[0],fromBrokerCompanyId:companies[1],fromBrokerAgentUserId:agents[1],
    data:{projectId:project2,buyerProfileId:profile,toBrokerCompanyId:companies[1],toBrokerAgentUserId:null,reason:'Approved prospective pool assignment'}});
  await query(`UPDATE brokerage_attribution_transfers SET status='APPROVED',reviewed_by=$2,reviewed_at=clock_timestamp(),review_note='Scoped reviewed update' WHERE id=$1`,[atomic,reviewers[1]]);
  assert.equal((await query(`SELECT attribution_revision FROM buyer_project_attributions WHERE buyer_profile_id=$1 AND project_id=$2`,[profile,project2])).rows[0].attribution_revision,'2');
  assert.equal((await query(`SELECT count(*)::int AS n FROM brokerage_attribution_history WHERE transfer_id=$1`,[atomic])).rows[0].n,1,'An approved status cannot omit its atomic projection.');
  assert.equal((await query(`SELECT broker_agent_user_id FROM broker_commission_cases WHERE transaction_id=$1`,[newDeal.transactionId])).rows[0].broker_agent_user_id,agents[1]);
  console.log(JSON.stringify({result:'E03_ATTRIBUTION_AUTHORITY_CERTIFICATION_OK',safeProfileRetry:true,brokerTakeoverRejected:true,concurrentCreateOneEvent:true,
    lifecycleNotReactivated:true,directSqlAndFlagBypassRejected:true,activeDeveloperReviewRequired:true,oneConcurrentApproval:true,
    terminalRetryStable:true,atomicApprovalProjection:true,rejectedRetryStable:true,concurrentRequestProfileAndReviewSafe:true,historicalDealCommissionFinanceAndExportsFrozen:true,historicalReminderRecipientsFrozen:true,prospectiveDealsUseNewBroker:true,projectAttributionIndependent:true,agentEconomicsRedacted:true}));
} finally {await db.destroy();}
