import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import { Pool } from 'pg';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Numeric = ColumnType<string, string | number, string | number>;
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

export interface CatalogUnitTypesTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  code: string;
  name: string;
  description: string | null;
  bedroom_count: number | null;
  indoor_area_sqm: Numeric;
  roof_area_sqm: Numeric;
  garden_area_sqm: Numeric;
  status: 'ACTIVE' | 'HIDDEN' | 'ARCHIVED';
  sort_order: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PricingVersionsTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  version_number: number;
  label: string;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'SUPERSEDED' | 'CANCELLED';
  effective_at: Timestamp;
  published_at: Timestamp | null;
  published_by: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PricingRatesTable {
  id: Generated<string>;
  pricing_version_id: string;
  unit_type_id: string;
  component: 'INDOOR' | 'ROOF' | 'GARDEN';
  rate_per_sqm: Numeric;
  created_at: Generated<Date>;
}

export interface InventorySlotsTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  unit_type_id: string;
  state: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'WITHDRAWN';
  internal_reference: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryLocksTable {
  id: Generated<string>;
  tenant_id: string;
  project_id: string;
  unit_type_id: string;
  inventory_slot_id: string;
  buyer_user_id: string | null;
  locked_by_user_id: string;
  status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'CONVERTED';
  expires_at: Timestamp;
  released_at: Timestamp | null;
  converted_at: Timestamp | null;
  release_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DomainOutboxEventsTable {
  id: Generated<string>;
  tenant_id: string | null;
  project_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: JsonValue;
  occurred_at: Generated<Date>;
  published_at: Timestamp | null;
  attempts: number;
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
  catalog_unit_types: CatalogUnitTypesTable;
  pricing_versions: PricingVersionsTable;
  pricing_rates: PricingRatesTable;
  inventory_slots: InventorySlotsTable;
  inventory_locks: InventoryLocksTable;
  domain_outbox_events: DomainOutboxEventsTable;
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
