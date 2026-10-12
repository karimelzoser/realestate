import pg from 'pg';

// Offline owner action, never an HTTP endpoint. First obtain genuine AAL2 OIDC
// evidence by signing in to the empty platform; independently verify that exact
// issuer/subject against the owner's corporate identity before running this.
if (!process.argv.includes('--approve-initial-platform-admin')) throw new Error('Explicit offline initial administrator approval is required.');
const required=name=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;};
const databaseUrl=required('DATABASE_URL'),userId=required('BOOTSTRAP_USER_ID'),issuer=required('BOOTSTRAP_IDENTITY_ISSUER'),subject=required('BOOTSTRAP_IDENTITY_SUBJECT'),note=required('BOOTSTRAP_REVIEW_NOTE').trim();
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)||note.length<10||note.length>1000)throw new Error('Valid user ID and independent review note are required.');
if(new URL(issuer).protocol!=='https:' && !(process.env.NODE_ENV==='test' && ['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname)))throw new Error('Production bootstrap requires an HTTPS identity issuer.');
const client=new pg.Client({connectionString:databaseUrl});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('preneura_initial_platform_admin_v1'))`);
  if((await client.query(`SELECT 1 FROM access_role_assignments WHERE role_code='PRENEURA_SUPER_ADMIN' LIMIT 1`)).rows.length)throw new Error('Initial administrator bootstrap is closed; use the existing administrator and reviewed enrollment.');
  const target=await client.query(`SELECT u.id FROM users u JOIN auth_external_identities i ON i.user_id=u.id
    WHERE u.id=$1 AND u.status='PENDING' AND i.provider='google' AND i.issuer=$2 AND i.provider_subject=$3
    AND EXISTS (SELECT 1 FROM auth_sessions s JOIN auth_session_assurance a ON a.session_id=s.id
      WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() AND a.auth_method='OIDC_GOOGLE'
      AND a.assurance_level='AAL2' AND a.verified_at>=now()-interval '10 minutes') FOR UPDATE OF u`,[userId,issuer,subject]);
  if(target.rows.length!==1)throw new Error('The exact pending owner identity needs a recent, genuinely verified MFA session.');
  await client.query(`UPDATE users SET status='ACTIVE',updated_at=now() WHERE id=$1`,[userId]);
  await client.query(`INSERT INTO access_role_assignments(user_id,role_code,scope_type,status,granted_by)
    VALUES($1,'PRENEURA_SUPER_ADMIN','PLATFORM','ACTIVE',$1)`,[userId]);
  await client.query(`INSERT INTO auth_security_events(user_id,event_type,result,metadata)
    VALUES($1,'INITIAL_PLATFORM_ADMIN_OWNER_APPROVED','SUCCESS',jsonb_build_object('reviewNote',$2::text,'issuer',$3::text))`,[userId,note,issuer]);
  // Revoke pre-approval sessions. Owner must authenticate again after activation.
  await client.query(`UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[userId]);
  await client.query('COMMIT');
  console.log('INITIAL_PLATFORM_ADMIN_APPROVED: sign in again with the approved MFA identity.');
} catch(error){await client.query('ROLLBACK');throw error;}
finally{await client.end();}
