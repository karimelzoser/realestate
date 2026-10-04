import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import { Pool } from 'pg';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AccessRoleCode =
  | 'PRENEURA_SUPER_ADMIN'
  | 'OPERATIONS_DIRECTOR'
  | 'MANAGER'
  | 'SALES'
  | 'QUEUE_RECEPTIONIST'
  | 'ALLOCATOR'
  | 'TRANSACTION_OPERATOR'
  | 'BROKER_MANAGER'
  | 'BROKER_FINANCE'
  | 'BROKER_AGENT'
  | 'BUYER';

export type AccessScopeType = 'PLATFORM' | 'TENANT' | 'PROJECT' | 'BROKER_COMPANY';

export interface UsersTable {
  id: Generated<string>;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthLoginAliasesTable {
  id: Generated<string>;
  user_id: string;
  kind: 'PHONE' | 'NATIONAL_ID';
  identifier_hmac: Uint8Array;
  verified_at: Timestamp;
  created_at: Generated<Date>;
}

export interface AuthExternalIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: string;
  provider_subject: string;
  email_at_link_time: string | null;
  linked_at: Generated<Date>;
}

export interface AuthOtpChallengesTable {
  id: Generated<string>;
  user_id: string | null;
  requested_kind: 'PHONE' | 'NATIONAL_ID';
  requested_identifier_hmac: Uint8Array;
  otp_digest: Uint8Array;
  delivery_channel: 'SMS' | 'WHATSAPP';
  delivery_attempted: Generated<boolean>;
  attempts_remaining: number;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: Generated<Date>;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  token_digest: Uint8Array;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

export interface AuthSecurityEventsTable {
  id: Generated<string>;
  user_id: string | null;
  event_type: string;
  result: 'SUCCESS' | 'REJECTED' | 'FAILED';
  challenge_id: string | null;
  session_id: string | null;
  request_id: string | null;
  ip_digest: Uint8Array | null;
  user_agent_digest: Uint8Array | null;
  metadata: JsonValue;
  created_at: Generated<Date>;
}

export interface TenantsTable {
  id: Generated<string>;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  default_currency: string;
  default_timezone: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenantMembershipsTable {
  tenant_id: string;
  user_id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  joined_at: Generated<Date>;
}

export interface ProjectsTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
  currency: string;
  timezone: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BrokerCompaniesTable {
  id: Generated<string>;
  tenant_id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BrokerProjectAccessTable {
  broker_company_id: string;
  tenant_id: string;
  project_id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  effective_from: Generated<Date>;
  effective_to: Timestamp | null;
  created_at: Generated<Date>;
}

export interface AccessRoleAssignmentsTable {
  id: Generated<string>;
  user_id: string;
  role_code: AccessRoleCode;
  scope_type: AccessScopeType;
  tenant_id: string | null;
  project_id: string | null;
  broker_company_id: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  granted_by: string | null;
  granted_at: Generated<Date>;
  revoked_at: Timestamp | null;
}

export interface Database {
  users: UsersTable;
  auth_login_aliases: AuthLoginAliasesTable;
  auth_external_identities: AuthExternalIdentitiesTable;
  auth_otp_challenges: AuthOtpChallengesTable;
  auth_sessions: AuthSessionsTable;
  auth_security_events: AuthSecurityEventsTable;
  tenants: TenantsTable;
  tenant_memberships: TenantMembershipsTable;
  projects: ProjectsTable;
  broker_companies: BrokerCompaniesTable;
  broker_project_access: BrokerProjectAccessTable;
  access_role_assignments: AccessRoleAssignmentsTable;
}

export function createDatabase(connectionString: string): Kysely<Database> {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
