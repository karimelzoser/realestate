import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '@preneura/database';
import {CompiledQuery} from 'kysely';
import {dispatchNotifications} from '../dist/notifications.js';
const url=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Delivery pause certification requires a disposable loopback test database.');
const db=createDatabase(url);
const query=(text,params=[])=>db.executeQuery(CompiledQuery.raw(text,params)),tenant=randomUUID(),user=randomUUID(),jobs=[randomUUID(),randomUUID()];
const previous=process.env.NOTIFICATION_EXTERNAL_DELIVERY_ENABLED;
try {
  await query(`INSERT INTO users(id,display_name,status) VALUES($1,'Synthetic paused-delivery user','ACTIVE')`,[user]);
  await query(`INSERT INTO tenants(id,code,name,status) VALUES($1,$2,'Synthetic paused-delivery tenant','ACTIVE')`,[tenant,`PAUSE-${tenant}`]);
  for(const [index,id]of jobs.entries())await query(`INSERT INTO notification_jobs(id,tenant_id,recipient_user_id,audience,channel,template_code,locale,payload,scheduled_for,status,idempotency_key,attempts)
    VALUES($1,$2,$3,'BUYER',$4,'synthetic.pause.certification','en','{}',now()-interval '1 second','PENDING',$5,0)`,[id,tenant,user,index===0?'SMS':'IN_APP',`PAUSE-${id}`]);
  process.env.NOTIFICATION_EXTERNAL_DELIVERY_ENABLED='false';
  await dispatchNotifications(db,'synthetic-pause-worker',1000);
  const rows=(await query(`SELECT id,status,attempts FROM notification_jobs WHERE id=ANY($1::uuid[])`,[jobs])).rows;
  assert.deepEqual(rows.find(row=>row.id===jobs[0]),{id:jobs[0],status:'PENDING',attempts:0});
  assert.deepEqual(rows.find(row=>row.id===jobs[1]),{id:jobs[1],status:'SENT',attempts:1});
  assert.equal((await query(`SELECT count(*) FROM notification_delivery_attempts WHERE notification_job_id=$1`,[jobs[0]])).rows[0].count,'0');
  assert.equal((await query(`SELECT count(*) FROM user_notifications WHERE notification_job_id=$1`,[jobs[1]])).rows[0].count,'1');
  await dispatchNotifications(db,'synthetic-pause-worker',1000);
  assert.equal((await query(`SELECT attempts FROM notification_jobs WHERE id=$1`,[jobs[0]])).rows[0].attempts,0);
  assert.equal((await query(`SELECT count(*) FROM user_notifications WHERE notification_job_id=$1`,[jobs[1]])).rows[0].count,'1');
  console.log('PROVIDER_PAUSE_CERTIFICATION_OK external jobs remain pending without attempts or fabricated delivery; in-app delivery remains real and idempotent');
}finally{if(previous===undefined)delete process.env.NOTIFICATION_EXTERNAL_DELIVERY_ENABLED;else process.env.NOTIFICATION_EXTERNAL_DELIVERY_ENABLED=previous;await db.destroy();}
