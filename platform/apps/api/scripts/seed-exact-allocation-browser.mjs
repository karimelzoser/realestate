import pg from 'pg';
import { randomUUID } from 'node:crypto';
const url=process.env.DATABASE_URL;
if(!url||process.env.NODE_ENV!=='test'||!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))throw new Error('Browser fixture requires a disposable loopback test database.');
const db=new pg.Pool({connectionString:url,max:1});
try {
  const row=(await db.query(`SELECT q.allocator_user_id AS user_id,q.tenant_id,q.project_id
    FROM queue_entries q JOIN projects p ON p.id=q.project_id JOIN tenants t ON t.id=q.tenant_id
    WHERE p.code='EXACT' AND t.code LIKE 'EXACT-%' AND q.status='CALLED' AND q.allocator_user_id IS NOT NULL
    ORDER BY t.created_at DESC,q.id LIMIT 1`)).rows[0];
  if(!row)throw new Error('Run real exact-allocation certification first to create the synthetic called-buyer graph.');
  await db.query(`DELETE FROM auth_sessions WHERE token_digest=digest('exact-allocation-browser-token-00000000001','sha256')`);
  const sessionId=randomUUID();
  await db.query(`INSERT INTO auth_sessions(id,user_id,token_digest,expires_at)
    VALUES($1,$2,digest('exact-allocation-browser-token-00000000001','sha256'),now()+interval '1 hour')`,[sessionId,row.user_id]);
  await db.query(`INSERT INTO auth_session_assurance(session_id,auth_method,assurance_level,provider_acr,provider_amr)
    VALUES($1,'OIDC_GOOGLE','AAL2','urn:preneura:aal2','["mfa"]'::jsonb)`,[sessionId]);
  console.log('E07_SYNTHETIC_BROWSER_FIXTURE_READY');
} finally {await db.end();}
