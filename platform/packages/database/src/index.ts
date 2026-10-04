import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import { Pool } from 'pg';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Numeric = ColumnType<string, string | number, string | number>;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type DocumentCategory = 'BUYER_ID' | 'PASSPORT' | 'ADDRESS_PROOF' | 'PAYMENT_RECEIPT' | 'CHEQUE' | 'CONTRACT' | 'STAMPED_CONTRACT' | 'OTHER';
export type MilestoneCode = 'BUYER_DOCUMENTS_COMPLETE' | 'DOWN_PAYMENT_RECEIVED' | 'CHEQUES_RECEIVED' | 'CONTRACT_GENERATED' | 'CONTRACT_SIGNED' | 'CONTRACT_STAMPED';
export type AccessRoleCode = 'PRENEURA_SUPER_ADMIN' | 'OPERATIONS_DIRECTOR' | 'MANAGER' | 'SALES' | 'QUEUE_RECEPTIONIST' | 'ALLOCATOR' | 'TRANSACTION_OPERATOR' | 'BROKER_MANAGER' | 'BROKER_FINANCE' | 'BROKER_AGENT' | 'BUYER';
export type AccessScopeType = 'PLATFORM' | 'TENANT' | 'PROJECT' | 'BROKER_COMPANY';
export type NotificationAudience = 'BUYER' | 'BROKER_AGENT' | 'BROKER_MANAGER' | 'BROKER_FINANCE' | 'SALES' | 'TRANSACTION_OPERATOR' | 'MANAGER';
export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'IN_APP';
export type RealtimeTopic = 'CATALOG' | 'INVENTORY' | 'PRICING' | 'QUEUE' | 'TRANSACTION' | 'COMMISSION' | 'REFUND' | 'DOMAIN';

export interface UsersTable { id: Generated<string>; display_name: string; status: 'ACTIVE' | 'DISABLED' | 'PENDING'; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface AuthLoginAliasesTable { id: Generated<string>; user_id: string; kind: 'PHONE' | 'NATIONAL_ID'; identifier_hmac: Uint8Array; verified_at: Timestamp; created_at: Generated<Date>; }
export interface AuthExternalIdentitiesTable { id: Generated<string>; user_id: string; provider: string; provider_subject: string; email_at_link_time: string | null; linked_at: Generated<Date>; }
export interface AuthOtpChallengesTable { id: Generated<string>; user_id: string | null; requested_kind: 'PHONE' | 'NATIONAL_ID'; requested_identifier_hmac: Uint8Array; otp_digest: Uint8Array; delivery_channel: 'SMS' | 'WHATSAPP'; delivery_attempted: Generated<boolean>; attempts_remaining: number; expires_at: Timestamp; consumed_at: Timestamp | null; created_at: Generated<Date>; }
export interface AuthSessionsTable { id: Generated<string>; user_id: string; token_digest: Uint8Array; expires_at: Timestamp; revoked_at: Timestamp | null; created_at: Generated<Date>; last_seen_at: Generated<Date>; }
export interface AuthSecurityEventsTable { id: Generated<string>; user_id: string | null; event_type: string; result: 'SUCCESS' | 'REJECTED' | 'FAILED'; challenge_id: string | null; session_id: string | null; request_id: string | null; ip_digest: Uint8Array | null; user_agent_digest: Uint8Array | null; metadata: JsonValue; created_at: Generated<Date>; }
export interface TenantsTable { id: Generated<string>; code: string; name: string; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'; default_currency: string; default_timezone: string; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface TenantMembershipsTable { tenant_id: string; user_id: string; status: 'ACTIVE' | 'SUSPENDED' | 'INVITED'; joined_at: Generated<Date>; }
export interface ProjectsTable { id: Generated<string>; tenant_id: string; code: string; name: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED'; currency: string; timezone: string; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface BrokerCompaniesTable { id: Generated<string>; tenant_id: string; code: string; name: string; status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface BrokerProjectAccessTable { broker_company_id: string; tenant_id: string; project_id: string; status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'; effective_from: Generated<Date>; effective_to: Timestamp | null; created_at: Generated<Date>; }
export interface AccessRoleAssignmentsTable { id: Generated<string>; user_id: string; role_code: AccessRoleCode; scope_type: AccessScopeType; tenant_id: string | null; project_id: string | null; broker_company_id: string | null; status: 'ACTIVE' | 'SUSPENDED'; granted_by: string | null; granted_at: Generated<Date>; revoked_at: Timestamp | null; }

export interface CatalogUnitTypesTable { id: Generated<string>; tenant_id: string; project_id: string; code: string; name: string; description: string | null; bedroom_count: number | null; indoor_area_sqm: Numeric; roof_area_sqm: Numeric; garden_area_sqm: Numeric; status: 'ACTIVE' | 'HIDDEN' | 'ARCHIVED'; sort_order: number; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface PricingVersionsTable { id: Generated<string>; tenant_id: string; project_id: string; version_number: number; label: string; status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'SUPERSEDED' | 'CANCELLED'; effective_at: Timestamp; published_at: Timestamp | null; published_by: string | null; created_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface PricingRatesTable { id: Generated<string>; tenant_id: string; project_id: string; pricing_version_id: string; unit_type_id: string; component: 'INDOOR' | 'ROOF' | 'GARDEN'; rate_per_sqm: Numeric; created_at: Generated<Date>; }
export interface InventorySlotsTable { id: Generated<string>; tenant_id: string; project_id: string; unit_type_id: string; state: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'WITHDRAWN'; internal_reference: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface InventoryLocksTable { id: Generated<string>; tenant_id: string; project_id: string; unit_type_id: string; inventory_slot_id: string; buyer_user_id: string | null; locked_by_user_id: string; status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'CONVERTED'; expires_at: Timestamp; released_at: Timestamp | null; converted_at: Timestamp | null; release_reason: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface DomainOutboxEventsTable { id: Generated<string>; tenant_id: string | null; project_id: string | null; aggregate_type: string; aggregate_id: string; event_type: string; payload: JsonValue; occurred_at: Generated<Date>; published_at: Timestamp | null; attempts: number; }

export interface BuyerProfilesTable { id: Generated<string>; tenant_id: string; user_id: string; status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED'; source: 'DIRECT' | 'BROKER' | 'INTERNAL'; broker_company_id: string | null; broker_agent_user_id: string | null; created_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface EoiRefundPoliciesTable { id: Generated<string>; tenant_id: string; project_id: string; version_number: number; name: string; status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'CANCELLED'; eoi_amount: Numeric; currency: string; before_reservation_refund_percent: Numeric; after_reservation_before_contract_refund_percent: Numeric; after_contract_refund_percent: Numeric; processing_fee: Numeric; effective_at: Timestamp; published_at: Timestamp | null; created_by: string | null; published_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface BuyerEoisTable { id: Generated<string>; tenant_id: string; project_id: string; buyer_profile_id: string; refund_policy_id: string; amount: Numeric; currency: string; status: 'PAYMENT_PENDING' | 'PAID' | 'APPLIED' | 'REFUND_REQUESTED' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED'; payment_reference: string | null; paid_at: Timestamp | null; applied_at: Timestamp | null; refund_requested_at: Timestamp | null; refunded_at: Timestamp | null; expires_at: Timestamp | null; created_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface EoiRefundRequestsTable { id: Generated<string>; tenant_id: string; project_id: string; eoi_id: string; buyer_profile_id: string; refund_policy_id: string; stage: 'BEFORE_RESERVATION' | 'AFTER_RESERVATION_BEFORE_CONTRACT' | 'AFTER_CONTRACT'; eoi_status_at_request: 'PAID' | 'APPLIED'; original_eoi_amount: Numeric; refund_percent: Numeric; processing_fee: Numeric; requested_amount: Numeric; currency: string; status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED'; requested_by: string; requested_at: Generated<Date>; reviewed_by: string | null; reviewed_at: Timestamp | null; paid_at: Timestamp | null; decision_note: string | null; updated_at: Generated<Date>; }
export interface QueueEntriesTable { id: Generated<string>; tenant_id: string; project_id: string; buyer_profile_id: string; eoi_id: string; channel: 'ONSITE' | 'ONLINE' | 'BROKER'; priority_group: 'STANDARD' | 'VIP' | 'RECOVERY'; priority_score: number; status: 'WAITING' | 'CALLED' | 'LOCKED' | 'COMPLETED' | 'LEFT' | 'CANCELLED'; checked_in_at: Generated<Date>; called_at: Timestamp | null; completed_at: Timestamp | null; cancelled_at: Timestamp | null; created_by: string | null; updated_at: Generated<Date>; }
export interface ReservationsTable { id: Generated<string>; tenant_id: string; project_id: string; buyer_profile_id: string; queue_entry_id: string; inventory_lock_id: string; inventory_slot_id: string; unit_type_id: string; pricing_version_id: string | null; quoted_total: Numeric | null; currency: string; status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED'; reserved_by: string; reserved_at: Generated<Date>; cancelled_at: Timestamp | null; completed_at: Timestamp | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface TransactionsTable { id: Generated<string>; tenant_id: string; project_id: string; reservation_id: string; buyer_profile_id: string; status: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED' | 'CANCELLED'; opened_at: Generated<Date>; completed_at: Timestamp | null; cancelled_at: Timestamp | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface TransactionMilestonesTable { id: Generated<string>; transaction_id: string; code: MilestoneCode; label: string; weight_percent: Numeric; status: 'PENDING' | 'COMPLETED' | 'WAIVED' | 'BLOCKED'; completed_at: Timestamp | null; completed_by: string | null; evidence_document_id: string | null; updated_at: Generated<Date>; }
export interface TransactionEventsTable { id: Generated<string>; transaction_id: string; actor_user_id: string | null; event_type: string; metadata: JsonValue; created_at: Generated<Date>; }

export interface DocumentTemplatesTable { id: Generated<string>; tenant_id: string; project_id: string | null; code: string; name: string; category: DocumentCategory; version_number: number; status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'CANCELLED'; storage_object_key: string; sha256_hex: string; mime_type: string; requires_signature: boolean; created_by: string | null; activated_at: Timestamp | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface ProjectDocumentRequirementsTable { id: Generated<string>; tenant_id: string; project_id: string; category: DocumentCategory; required_count: number; required_for_completion: boolean; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface TransactionDocumentsTable { id: Generated<string>; tenant_id: string; project_id: string; transaction_id: string; template_id: string | null; category: DocumentCategory; revision_number: number; supersedes_document_id: string | null; status: 'REQUESTED' | 'UPLOADING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED' | 'SIGNED' | 'STAMPED' | 'SUPERSEDED'; storage_object_key: string | null; original_filename: string | null; mime_type: string | null; byte_size: ColumnType<number | null, number | null, number | null>; sha256_hex: string | null; due_at: Timestamp | null; uploaded_by: string | null; uploaded_at: Timestamp | null; verified_by: string | null; verified_at: Timestamp | null; rejection_reason: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface DocumentSignaturesTable { id: Generated<string>; document_id: string; signer_role: 'BUYER' | 'COMPANY' | 'WITNESS' | 'BROKER'; signer_user_id: string | null; method: 'DRAWN' | 'TYPED' | 'UPLOAD' | 'EXTERNAL_PROVIDER'; typed_name: string | null; signature_object_key: string | null; signature_sha256_hex: string | null; provider: string | null; provider_envelope_id: string | null; signed_at: Timestamp; metadata: JsonValue; created_at: Generated<Date>; }
export interface DocumentTemplateSignerRequirementsTable { template_id: string; signer_role: 'BUYER' | 'COMPANY' | 'WITNESS' | 'BROKER'; signing_order: number; required: boolean; created_at: Generated<Date>; }
export interface ProjectMilestoneSlasTable { tenant_id: string; project_id: string; milestone_code: MilestoneCode; target_hours_after_open: number; reminder_hours_before: number; audience: NotificationAudience; channel: NotificationChannel; template_code: string; enabled: boolean; created_at: Generated<Date>; updated_at: Generated<Date>; }

export interface PaymentSchedulesTable { id: Generated<string>; tenant_id: string; project_id: string; transaction_id: string; currency: string; total_contract_amount: Numeric; status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'; created_by: string | null; activated_at: Timestamp | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface PaymentScheduleItemsTable { id: Generated<string>; payment_schedule_id: string; sequence_number: number; item_type: 'DOWN_PAYMENT' | 'INSTALLMENT' | 'FEE'; amount: Numeric; due_at: Timestamp; status: 'UPCOMING' | 'DUE' | 'PAID' | 'OVERDUE' | 'WAIVED' | 'CANCELLED'; paid_at: Timestamp | null; payment_reference: string | null; verified_by: string | null; updated_at: Generated<Date>; }
export interface TransactionChequesTable { id: Generated<string>; tenant_id: string; project_id: string; transaction_id: string; sequence_number: number; amount: Numeric; due_at: Timestamp; cheque_number: string | null; bank_name: string | null; status: 'EXPECTED' | 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'RETURNED' | 'CANCELLED'; received_at: Timestamp | null; verified_by: string | null; updated_at: Generated<Date>; }

export interface BrokerCommissionPlansTable { id: Generated<string>; tenant_id: string; project_id: string; broker_company_id: string; version_number: number; status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'CANCELLED'; rate_percent: Numeric; due_days_after_eligibility: number; effective_at: Timestamp; activated_at: Timestamp | null; created_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface BrokerCommissionCasesTable { id: Generated<string>; tenant_id: string; project_id: string; transaction_id: string; broker_company_id: string; broker_agent_user_id: string | null; commission_plan_id: string; basis_amount: Numeric; rate_percent: Numeric; commission_amount: Numeric; status: 'PENDING_PREREQUISITES' | 'ELIGIBLE' | 'INVOICED' | 'DUE' | 'PAID' | 'DISPUTED' | 'CANCELLED'; completion_percent_snapshot: Numeric; eligible_at: Timestamp | null; due_at: Timestamp | null; invoiced_at: Timestamp | null; paid_at: Timestamp | null; created_at: Generated<Date>; updated_at: Generated<Date>; }

export interface NotificationJobsTable { id: Generated<string>; tenant_id: string; project_id: string | null; transaction_id: string | null; recipient_user_id: string; audience: NotificationAudience; channel: NotificationChannel; template_code: string; locale: string; payload: JsonValue; scheduled_for: Timestamp; status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED'; idempotency_key: string; attempts: number; provider_message_id: string | null; last_error: string | null; sent_at: Timestamp | null; processing_started_at: Timestamp | null; processing_by: string | null; created_at: Generated<Date>; updated_at: Generated<Date>; }
export interface NotificationDeliveryAttemptsTable { id: Generated<string>; notification_job_id: string; attempt_number: number; provider: string; result: 'SENT' | 'FAILED'; provider_message_id: string | null; error: string | null; started_at: Timestamp; completed_at: Timestamp; created_at: Generated<Date>; }
export interface RealtimeEventsTable { sequence: Generated<number>; outbox_event_id: string; tenant_id: string | null; project_id: string | null; topic: RealtimeTopic; source_event_type: string; source_aggregate_type: string; occurred_at: Timestamp; published_at: Generated<Date>; }
export interface UserNotificationsTable { id: Generated<string>; sequence: Generated<number>; notification_job_id: string; tenant_id: string; project_id: string | null; recipient_user_id: string; template_code: string; locale: string; payload: JsonValue; created_at: Generated<Date>; read_at: Timestamp | null; }

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
  buyer_profiles: BuyerProfilesTable;
  eoi_refund_policies: EoiRefundPoliciesTable;
  buyer_eois: BuyerEoisTable;
  eoi_refund_requests: EoiRefundRequestsTable;
  queue_entries: QueueEntriesTable;
  reservations: ReservationsTable;
  transactions: TransactionsTable;
  transaction_milestones: TransactionMilestonesTable;
  transaction_events: TransactionEventsTable;
  document_templates: DocumentTemplatesTable;
  project_document_requirements: ProjectDocumentRequirementsTable;
  transaction_documents: TransactionDocumentsTable;
  document_signatures: DocumentSignaturesTable;
  document_template_signer_requirements: DocumentTemplateSignerRequirementsTable;
  project_milestone_slas: ProjectMilestoneSlasTable;
  payment_schedules: PaymentSchedulesTable;
  payment_schedule_items: PaymentScheduleItemsTable;
  transaction_cheques: TransactionChequesTable;
  broker_commission_plans: BrokerCommissionPlansTable;
  broker_commission_cases: BrokerCommissionCasesTable;
  notification_jobs: NotificationJobsTable;
  notification_delivery_attempts: NotificationDeliveryAttemptsTable;
  realtime_events: RealtimeEventsTable;
  user_notifications: UserNotificationsTable;
}

export function createDatabase(connectionString: string): Kysely<Database> {
  const pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
