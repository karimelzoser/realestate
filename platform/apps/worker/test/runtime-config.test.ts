import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateWorkerRuntimeConfig} from '../src/runtime-config.js';
const base={NODE_ENV:'production',DATABASE_URL:'postgresql://u:p@db:5432/preneura',NOTIFICATION_GATEWAY_URL:'https://notify.preneura.test/deliver',
  NOTIFICATION_GATEWAY_TOKEN:'a'.repeat(32),INVENTORY_LOCK_EXPIRY_SCAN_MS:'1000',INVENTORY_LOCK_EXPIRY_BATCH_SIZE:'500',
  OUTBOX_POLL_MS:'300',NOTIFICATION_POLL_MS:'1000',SLA_SCAN_MS:'30000',INSTALLMENT_REMINDER_SCAN_MS:'30000',COMMISSION_DUE_SCAN_MS:'30000'};
test('network transport rejects local production destinations by default',()=>{
  assert.doesNotThrow(()=>validateWorkerRuntimeConfig(base));
  assert.throws(()=>validateWorkerRuntimeConfig({...base,NOTIFICATION_GATEWAY_URL:'http://127.0.0.1:4300/deliver'}),/localhost/);
});
test('explicit co-located transport permits only the fixed authenticated gateway endpoint',()=>{
  assert.doesNotThrow(()=>validateWorkerRuntimeConfig({...base,NOTIFICATION_GATEWAY_TRANSPORT:'loopback',NOTIFICATION_GATEWAY_URL:'http://127.0.0.1:4300/deliver'}));
  for(const url of ['http://127.0.0.1:4300/other','http://127.0.0.1:4300/deliver?x=1','https://notify.preneura.test/deliver','http://localhost:4300/deliver'])
    assert.throws(()=>validateWorkerRuntimeConfig({...base,NOTIFICATION_GATEWAY_TRANSPORT:'loopback',NOTIFICATION_GATEWAY_URL:url}),/loopback/);
});
test('local transport retains token, inventory reconciliation and cadence requirements',()=>{
  assert.throws(()=>validateWorkerRuntimeConfig({...base,NOTIFICATION_GATEWAY_TRANSPORT:'loopback',NOTIFICATION_GATEWAY_URL:'http://127.0.0.1:4300/deliver',NOTIFICATION_GATEWAY_TOKEN:''}),/TOKEN/);
  assert.throws(()=>validateWorkerRuntimeConfig({...base,INVENTORY_LOCK_EXPIRY_SCAN_MS:'0'}),/EXPIRY/);
});
