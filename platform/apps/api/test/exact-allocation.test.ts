import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException,ForbiddenException } from '@nestjs/common';
import { createAssignedAllocationLockSchema } from '@preneura/contracts/allocation';
import { AllocationRoleService } from '../src/sales/allocation-role.service.js';

const ids={tenantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',projectId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  quoteId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',idempotencyKey:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',ttlSeconds:900};

test('exact lock contract rejects type-only requests, missing replay key and longer direct holds',()=>{
  assert.equal(createAssignedAllocationLockSchema.safeParse(ids).success,true);
  assert.equal(createAssignedAllocationLockSchema.safeParse({...ids,quoteId:undefined,unitTypeId:ids.quoteId}).success,false);
  assert.equal(createAssignedAllocationLockSchema.safeParse({...ids,idempotencyKey:undefined}).success,false);
  assert.equal(createAssignedAllocationLockSchema.safeParse({...ids,ttlSeconds:901}).success,false);
});

test('an allocation capability without an explicit Allocator assignment cannot quote an apartment',async()=>{
  let writes=0;
  const service=new AllocationRoleService({quoteApartment:async()=>{writes++;}} as never,
    {matchingAssignments:async()=>[{role:'OPERATIONS_DIRECTOR'}]} as never);
  await assert.rejects(service.createQuote({actorUserId:'director',data:{tenantId:ids.tenantId,projectId:ids.projectId,queueEntryId:ids.quoteId,physicalUnitId:ids.idempotencyKey}}),ForbiddenException);
  assert.equal(writes,0);
});

test('assigned lock writes are bound to the authenticated allocator, exact quote and replay key',async()=>{
  let request:unknown;
  const service=new AllocationRoleService({createAssignedLock:async(value:unknown)=>{request=value;return {lockId:'lock'};}} as never,
    {matchingAssignments:async()=>[{role:'ALLOCATOR'}]} as never);
  await service.createLock({actorUserId:'authenticated-allocator',data:ids});
  assert.deepEqual(request,{tenantId:ids.tenantId,projectId:ids.projectId,allocatorUserId:'authenticated-allocator',quoteId:ids.quoteId,idempotencyKey:ids.idempotencyKey,ttlSeconds:900});
});

test('contested exact apartments return conflict without attempting a substitute type or slot',async()=>{
  let writes=0;
  const service=new AllocationRoleService({createAssignedLock:async()=>{writes++;throw {code:'P0001',message:'requested apartment already held'};}} as never,
    {matchingAssignments:async()=>[{role:'ALLOCATOR'}]} as never);
  await assert.rejects(service.createLock({actorUserId:'allocator',data:ids}),ConflictException);
  assert.equal(writes,1);
});
