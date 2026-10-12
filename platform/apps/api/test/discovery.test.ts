import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discoveryQuerySchema,publishProjectDiscoverySchema} from '@preneura/contracts/discovery';
import {DiscoveryController,ProjectPublicationController} from '../src/discovery/discovery.controller.js';

test('anonymous discovery rejects oversized filters, unexpected fields and malformed cursors before repository access',async()=>{
  let calls=0;const controller=new DiscoveryController({list:async()=>{calls++;return {items:[],nextCursor:null};}} as never);
  for(const query of [{limit:'25'},{q:'a'.repeat(101)},{after:'../../private'},{tenantId:'private'}])assert.throws(()=>controller.list(query));
  assert.equal(calls,0);assert.deepEqual(await controller.list({}),{items:[],nextCursor:null});
  assert.equal(discoveryQuerySchema.parse({limit:'1'}).limit,1);
});
test('missing and invalid publication slugs are indistinguishable from private projects',async()=>{
  const controller=new DiscoveryController({detail:async()=>null} as never);
  for(const slug of ['missing-project','../private'])await assert.rejects(()=>controller.detail(slug),/Project not found/);
});
const input={slug:'synthetic-project',titleEn:'Synthetic project',titleAr:'مشروع اختباري',descriptionEn:'Published synthetic project description.',descriptionAr:'وصف مشروع اختباري منشور.',locationEn:'Cairo',locationAr:'القاهرة',status:'PUBLISHED',reason:'Project content approved for public discovery.'};
test('publication requires manager authority before a write and binds the authenticated actor/project',async()=>{
  let writes=0;const denied=new ProjectPublicationController({publish:async()=>{writes++;}} as never,{assert:async()=>{throw Error('DENIED');}} as never);
  const ids={tenantId:'11111111-1111-4111-8111-111111111111',projectId:'22222222-2222-4222-8222-222222222222',userId:'33333333-3333-4333-8333-333333333333'};
  await assert.rejects(()=>denied.publish(ids.tenantId,ids.projectId,input,{userId:ids.userId} as never),/DENIED/);assert.equal(writes,0);
  let args:unknown[]=[];let permission='';const allowed=new ProjectPublicationController({publish:async(...value:unknown[])=>{args=value;}} as never,{assert:async(value:{permission:string})=>{permission=value.permission;}} as never);
  await allowed.publish(ids.tenantId,ids.projectId,input,{userId:ids.userId} as never);
  assert.equal(permission,'project.manage');assert.deepEqual(args.slice(0,3),[ids.userId,ids.tenantId,ids.projectId]);
});
test('publication copy must include both languages and cannot smuggle operational fields',()=>{
  assert.equal(publishProjectDiscoverySchema.safeParse(input).success,true);
  assert.equal(publishProjectDiscoverySchema.safeParse({...input,titleAr:''}).success,false);
  assert.equal(publishProjectDiscoverySchema.safeParse({...input,brokerCommission:'1000'}).success,false);
});
