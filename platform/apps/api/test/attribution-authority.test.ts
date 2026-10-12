import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ForbiddenException} from '@nestjs/common';
import {roleCapabilityMap,roleHasPermission,type RoleCode} from '@preneura/contracts/access';
import {BrokerageOnboardingService} from '../src/brokerage-onboarding/brokerage-onboarding.service.js';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',project='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',profile='cccccccc-cccc-4ccc-8ccc-cccccccccccc',transfer='dddddddd-dddd-4ddd-8ddd-dddddddddddd',company='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',actor='11111111-1111-4111-8111-111111111111';
test('attribution review belongs to developer Managers and Operations Directors only',()=>{
  for(const role of Object.keys(roleCapabilityMap) as RoleCode[])assert.equal(roleHasPermission(role,'broker.attribution.review'),['MANAGER','OPERATIONS_DIRECTOR'].includes(role));
});
test('ordinary buyer management permission cannot approve an attribution transfer',async()=>{
  let wrote=false;
  const repository={transfer:async()=>({projectId:project}),reviewTransfer:async()=>{wrote=true;return true;}};
  const access={assert:async(input:{permission:string})=>{assert.equal(input.permission,'broker.attribution.review');throw new ForbiddenException();}};
  const service=new BrokerageOnboardingService(repository as never,access as never);
  await assert.rejects(service.reviewTransfer({actorUserId:actor,tenantId:tenant,transferId:transfer,data:{decision:'APPROVED',note:'review'}}),ForbiddenException);
  assert.equal(wrote,false);
});
test('a raw broker-manager assignment without current scoped access cannot request reassignment',async()=>{
  let wrote=false;
  const repository={buyerAttribution:async(_tenant:string,_profile:string,projectId:string)=>{assert.equal(projectId,project);return{brokerCompanyId:company,brokerAgentUserId:null};},
    targetEligible:async()=>true,createTransfer:async()=>{wrote=true;return transfer;}};
  const access={can:async()=>({allowed:false}),matchingAssignments:async()=>[],assignmentsForUser:async()=>[{role:'BROKER_MANAGER',brokerCompanyId:company}]};
  const service=new BrokerageOnboardingService(repository as never,access as never);
  await assert.rejects(service.requestTransfer({actorUserId:actor,tenantId:tenant,data:{projectId:project,buyerProfileId:profile,toBrokerCompanyId:company,toBrokerAgentUserId:actor,reason:'reassign'}}),ForbiddenException);
  assert.equal(wrote,false);
});
test('review writes use the authenticated actor and the scoped transfer project',async()=>{
  let submitted:unknown;
  const repository={transfer:async()=>({projectId:project}),reviewTransfer:async(input:unknown)=>{submitted=input;return true;},workspace:async()=>({})};
  const access={assert:async(input:{permission:string;context:unknown})=>{assert.equal(input.permission,'broker.attribution.review');assert.deepEqual(input.context,{tenantId:tenant,projectId:project});}};
  const service=new BrokerageOnboardingService(repository as never,access as never);
  await service.reviewTransfer({actorUserId:actor,tenantId:tenant,transferId:transfer,data:{decision:'REJECTED',note:'not approved'}});
  assert.deepEqual(submitted,{tenantId:tenant,transferId:transfer,actorUserId:actor,decision:'REJECTED',note:'not approved'});
});
