import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type {
  AccountSnapshot,
  AccountAdminScopeSnapshot,
  AccountRoleSnapshot,
} from '@preneura/contracts/accounts';
import type { RoleCode, ScopeType } from '@preneura/contracts/access';
import { DATABASE } from '../database/database.module.js';

type ContactRow = {
  user_id: string;
  kind: 'PHONE' | 'EMAIL';
  display_hint: string | null;
  verified_at: Date | null;
  is_primary: boolean;
};

type EnrollmentRow = {
  challenge_id: string;
  user_id: string;
  contact_id: string;
  alias_id: string;
  code_digest: Uint8Array;
  attempts_remaining: number;
  expires_at: Date;
};

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async listAccounts(input: {
    tenantId: string;
    brokerCompanyIds: string[] | null;
  }): Promise<AccountSnapshot[]> {
    const baseUsers = () => this.db
      .selectFrom('tenant_memberships as membership')
      .innerJoin('users as user', 'user.id', 'membership.user_id')
      .select([
        'user.id as user_id',
        'user.display_name',
        'user.status',
        'membership.status as membership_status',
      ])
      .where('membership.tenant_id', '=', input.tenantId);

    const users = input.brokerCompanyIds === null
      ? await baseUsers().orderBy('user.display_name', 'asc').execute()
      : input.brokerCompanyIds.length === 0
        ? []
        : await baseUsers()
          .innerJoin('access_role_assignments as visible_assignment', 'visible_assignment.user_id', 'user.id')
          .where('visible_assignment.tenant_id', '=', input.tenantId)
          .where('visible_assignment.scope_type', '=', 'BROKER_COMPANY')
          .where('visible_assignment.broker_company_id', 'in', input.brokerCompanyIds)
          .where('visible_assignment.revoked_at', 'is', null)
          .distinct()
          .orderBy('user.display_name', 'asc')
          .execute();

    const userIds = users.map((user) => user.user_id);
    if (userIds.length === 0) return [];

    const baseAssignments = () => this.db
      .selectFrom('access_role_assignments')
      .select([
        'id', 'user_id', 'role_code', 'scope_type', 'tenant_id', 'project_id',
        'broker_company_id', 'status',
      ])
      .where('user_id', 'in', userIds)
      .where('revoked_at', 'is', null);

    const assignments = input.brokerCompanyIds === null
      ? await baseAssignments()
        .where((eb) => eb.or([
          eb('tenant_id', '=', input.tenantId),
          eb('scope_type', '=', 'PLATFORM'),
        ]))
        .execute()
      : await baseAssignments()
        .where('tenant_id', '=', input.tenantId)
        .where('scope_type', '=', 'BROKER_COMPANY')
        .where('broker_company_id', 'in', input.brokerCompanyIds)
        .execute();

    const contactResult = await sql<ContactRow>`
      SELECT user_id, kind, display_hint, verified_at, is_primary
      FROM auth_delivery_contacts
      WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}::uuid`))})
      ORDER BY kind, is_primary DESC, created_at ASC
    `.execute(this.db);

    return users.map((user) => ({
      userId: user.user_id,
      displayName: user.display_name,
      status: user.status,
      membershipStatus: user.membership_status,
      contacts: contactResult.rows
        .filter((contact) => contact.user_id === user.user_id)
        .map((contact) => ({
          kind: contact.kind,
          displayHint: contact.display_hint,
          verifiedAt: contact.verified_at ? contact.verified_at.toISOString() : null,
          primary: contact.is_primary,
        })),
      roles: assignments
        .filter((assignment) => assignment.user_id === user.user_id)
        .map((assignment): AccountRoleSnapshot => ({
          assignmentId: assignment.id,
          role: assignment.role_code as RoleCode,
          scopeType: assignment.scope_type as ScopeType,
          tenantId: assignment.tenant_id,
          projectId: assignment.project_id,
          brokerCompanyId: assignment.broker_company_id,
          status: assignment.status,
        })),
    }));
  }

  async scopeSnapshot(input: {
    tenantId: string;
    tenantUserAdmin: boolean;
    brokerCompanyIds: string[];
  }): Promise<AccountAdminScopeSnapshot> {
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['id', 'name'])
      .where('id', '=', input.tenantId)
      .executeTakeFirstOrThrow();

    const projects = input.tenantUserAdmin
      ? await this.db
        .selectFrom('projects')
        .select(['id', 'code', 'name'])
        .where('tenant_id', '=', input.tenantId)
        .where('status', '!=', 'ARCHIVED')
        .orderBy('name', 'asc')
        .execute()
      : [];

    let brokerQuery = this.db
      .selectFrom('broker_companies')
      .select(['id', 'code', 'name'])
      .where('tenant_id', '=', input.tenantId)
      .where('status', '=', 'ACTIVE');
    if (!input.tenantUserAdmin) {
      if (input.brokerCompanyIds.length === 0) {
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          canManageTenantUsers: false,
          projects: [],
          brokerCompanies: [],
        };
      }
      brokerQuery = brokerQuery.where('id', 'in', input.brokerCompanyIds);
    }
    const brokers = await brokerQuery.orderBy('name', 'asc').execute();

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      canManageTenantUsers: input.tenantUserAdmin,
      projects: projects.map((project) => ({ projectId: project.id, code: project.code, name: project.name })),
      brokerCompanies: brokers.map((broker) => ({ brokerCompanyId: broker.id, code: broker.code, name: broker.name })),
    };
  }

  async provision(input: {
    actorUserId: string;
    tenantId: string;
    displayName: string;
    phoneIdentifierHmac: Uint8Array;
    contactCiphertext: Uint8Array;
    contactHmac: Uint8Array;
    contactDisplayHint: string;
    role: RoleCode;
    scopeType: ScopeType;
    projectId: string | null;
    brokerCompanyId: string | null;
    challengeId: string;
    challengeDigest: Uint8Array;
    channel: 'WHATSAPP' | 'SMS';
    expiresAt: Date;
  }): Promise<{ userId: string; contactId: string }> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto('users')
          .values({ display_name: input.displayName, status: 'PENDING' })
          .returning('id')
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('tenant_memberships')
          .values({ tenant_id: input.tenantId, user_id: user.id, status: 'INVITED' })
          .execute();

        const alias = await sql<{ id: string }>`
          INSERT INTO auth_login_aliases (user_id, kind, identifier_hmac, verified_at)
          VALUES (${user.id}::uuid, 'PHONE', ${input.phoneIdentifierHmac}, NULL)
          RETURNING id
        `.execute(trx);
        const aliasId = alias.rows[0]?.id;
        if (!aliasId) throw new Error('Unable to create phone login alias.');

        const contact = await sql<{ id: string }>`
          INSERT INTO auth_delivery_contacts (
            user_id, kind, value_ciphertext, value_hmac, verified_at, is_primary, display_hint
          ) VALUES (
            ${user.id}::uuid, 'PHONE', ${input.contactCiphertext}, ${input.contactHmac},
            NULL, true, ${input.contactDisplayHint}
          )
          RETURNING id
        `.execute(trx);
        const contactId = contact.rows[0]?.id;
        if (!contactId) throw new Error('Unable to create delivery contact.');

        await trx
          .insertInto('access_role_assignments')
          .values({
            user_id: user.id,
            role_code: input.role,
            scope_type: input.scopeType,
            tenant_id: input.tenantId,
            project_id: input.projectId,
            broker_company_id: input.brokerCompanyId,
            status: 'ACTIVE',
            granted_by: input.actorUserId,
            revoked_at: null,
          })
          .execute();

        await sql`
          INSERT INTO auth_contact_verification_challenges (
            id, user_id, contact_id, alias_id, channel, code_digest, attempts_remaining, expires_at
          ) VALUES (
            ${input.challengeId}::uuid, ${user.id}::uuid, ${contactId}::uuid, ${aliasId}::uuid,
            ${input.channel}, ${input.challengeDigest}, 5, ${input.expiresAt}
          )
        `.execute(trx);

        await trx.insertInto('auth_security_events').values({
          user_id: user.id,
          event_type: 'ACCOUNT_PROVISIONED',
          result: 'SUCCESS',
          challenge_id: input.challengeId,
          session_id: null,
          request_id: null,
          ip_digest: null,
          user_agent_digest: null,
          metadata: { tenantId: input.tenantId, role: input.role, scopeType: input.scopeType },
        }).execute();

        return { userId: user.id, contactId };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('That phone number is already associated with a PRENEURA account.');
      }
      throw error;
    }
  }

  async markChallengeSent(challengeId: string, at: Date): Promise<void> {
    await sql`
      UPDATE auth_contact_verification_challenges
      SET sent_at = COALESCE(sent_at, ${at})
      WHERE id = ${challengeId}::uuid
    `.execute(this.db);
  }

  async pendingVerificationTarget(input: { tenantId: string; userId: string }): Promise<{
    userId: string;
    contactId: string;
    aliasId: string;
  } | null> {
    const result = await sql<{ user_id: string; contact_id: string; alias_id: string }>`
      SELECT user.id AS user_id, contact.id AS contact_id, alias.id AS alias_id
      FROM users user
      JOIN tenant_memberships membership
        ON membership.user_id = user.id AND membership.tenant_id = ${input.tenantId}::uuid
      JOIN auth_login_aliases alias
        ON alias.user_id = user.id AND alias.kind = 'PHONE' AND alias.verified_at IS NULL
      JOIN auth_delivery_contacts contact
        ON contact.user_id = user.id AND contact.kind = 'PHONE'
        AND contact.is_primary = true AND contact.verified_at IS NULL
      WHERE user.id = ${input.userId}::uuid
        AND user.status = 'PENDING'
      LIMIT 1
    `.execute(this.db);
    const row = result.rows[0];
    return row ? { userId: row.user_id, contactId: row.contact_id, aliasId: row.alias_id } : null;
  }

  async createVerificationChallenge(input: {
    id: string;
    userId: string;
    contactId: string;
    aliasId: string;
    channel: 'WHATSAPP' | 'SMS';
    digest: Uint8Array;
    expiresAt: Date;
  }): Promise<void> {
    await sql`
      INSERT INTO auth_contact_verification_challenges (
        id, user_id, contact_id, alias_id, channel, code_digest, attempts_remaining, expires_at
      ) VALUES (
        ${input.id}::uuid, ${input.userId}::uuid, ${input.contactId}::uuid, ${input.aliasId}::uuid,
        ${input.channel}, ${input.digest}, 5, ${input.expiresAt}
      )
    `.execute(this.db);
  }

  async enrollmentChallenge(identifierHmac: Uint8Array, now: Date): Promise<EnrollmentRow | null> {
    const result = await sql<EnrollmentRow>`
      SELECT
        challenge.id AS challenge_id,
        challenge.user_id,
        challenge.contact_id,
        challenge.alias_id,
        challenge.code_digest,
        challenge.attempts_remaining,
        challenge.expires_at
      FROM auth_contact_verification_challenges challenge
      JOIN auth_login_aliases alias
        ON alias.id = challenge.alias_id
      JOIN users user
        ON user.id = challenge.user_id
      WHERE alias.kind = 'PHONE'
        AND alias.identifier_hmac = ${identifierHmac}
        AND alias.verified_at IS NULL
        AND user.status = 'PENDING'
        AND challenge.consumed_at IS NULL
        AND challenge.expires_at > ${now}
        AND challenge.attempts_remaining > 0
      ORDER BY challenge.created_at DESC
      LIMIT 1
    `.execute(this.db);
    return result.rows[0] ?? null;
  }

  async decrementVerificationAttempt(challengeId: string, now: Date): Promise<void> {
    await sql`
      UPDATE auth_contact_verification_challenges
      SET attempts_remaining = GREATEST(attempts_remaining - 1, 0)
      WHERE id = ${challengeId}::uuid
        AND consumed_at IS NULL
        AND expires_at > ${now}
    `.execute(this.db);
  }

  async completeEnrollment(input: EnrollmentRow, now: Date): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`
        UPDATE auth_contact_verification_challenges
        SET consumed_at = ${now}
        WHERE id = ${input.challenge_id}::uuid AND consumed_at IS NULL
      `.execute(trx);
      await sql`
        UPDATE auth_delivery_contacts
        SET verified_at = ${now}, updated_at = ${now}
        WHERE id = ${input.contact_id}::uuid AND verified_at IS NULL
      `.execute(trx);
      await sql`
        UPDATE auth_login_aliases
        SET verified_at = ${now}
        WHERE id = ${input.alias_id}::uuid AND verified_at IS NULL
      `.execute(trx);
      await trx.updateTable('users')
        .set({ status: 'ACTIVE', updated_at: now })
        .where('id', '=', input.user_id)
        .where('status', '=', 'PENDING')
        .execute();
      await trx.updateTable('tenant_memberships')
        .set({ status: 'ACTIVE' })
        .where('user_id', '=', input.user_id)
        .where('status', '=', 'INVITED')
        .execute();
      await trx.insertInto('auth_security_events').values({
        user_id: input.user_id,
        event_type: 'ACCOUNT_ENROLLMENT_VERIFIED',
        result: 'SUCCESS',
        challenge_id: input.challenge_id,
        session_id: null,
        request_id: null,
        ip_digest: null,
        user_agent_digest: null,
        metadata: {},
      }).execute();
    });
  }

  async grantRole(input: {
    actorUserId: string;
    tenantId: string;
    userId: string;
    role: RoleCode;
    scopeType: ScopeType;
    projectId: string | null;
    brokerCompanyId: string | null;
  }): Promise<string> {
    await this.db
      .insertInto('tenant_memberships')
      .values({ tenant_id: input.tenantId, user_id: input.userId, status: 'ACTIVE' })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doNothing())
      .execute();
    const assignment = await this.db
      .insertInto('access_role_assignments')
      .values({
        user_id: input.userId,
        role_code: input.role,
        scope_type: input.scopeType,
        tenant_id: input.tenantId,
        project_id: input.projectId,
        broker_company_id: input.brokerCompanyId,
        status: 'ACTIVE',
        granted_by: input.actorUserId,
        revoked_at: null,
      })
      .returning('id')
      .executeTakeFirst();
    if (!assignment) throw new ConflictException('That active role assignment already exists.');
    return assignment.id;
  }

  async assignment(assignmentId: string): Promise<AccountRoleSnapshot & { userId: string }> {
    const row = await this.db.selectFrom('access_role_assignments')
      .select(['id','user_id','role_code','scope_type','tenant_id','project_id','broker_company_id','status'])
      .where('id', '=', assignmentId)
      .where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      assignmentId: row.id,
      userId: row.user_id,
      role: row.role_code as RoleCode,
      scopeType: row.scope_type as ScopeType,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      brokerCompanyId: row.broker_company_id,
      status: row.status,
    };
  }

  async revokeRole(input: { assignmentId: string; actorUserId: string; now: Date }): Promise<void> {
    await this.db.updateTable('access_role_assignments')
      .set({ status: 'SUSPENDED', revoked_at: input.now })
      .where('id', '=', input.assignmentId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async setUserStatus(input: { tenantId: string; userId: string; status: 'ACTIVE' | 'DISABLED'; now: Date }): Promise<boolean> {
    const hasTenant = await this.db.selectFrom('tenant_memberships')
      .select('user_id')
      .where('tenant_id', '=', input.tenantId)
      .where('user_id', '=', input.userId)
      .executeTakeFirst();
    if (!hasTenant) return false;
    const result = await this.db.updateTable('users')
      .set({ status: input.status, updated_at: input.now })
      .where('id', '=', input.userId)
      .where('status', '!=', 'PENDING')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}
