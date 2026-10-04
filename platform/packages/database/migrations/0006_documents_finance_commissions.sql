BEGIN;

CREATE TABLE IF NOT EXISTS document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'BUYER_ID','PASSPORT','ADDRESS_PROOF','PAYMENT_RECEIPT','CHEQUE','CONTRACT','STAMPED_CONTRACT','OTHER'
  )),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','CANCELLED')),
  storage_object_key text NOT NULL,
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[0-9a-fA-F]{64}$'),
  mime_type text NOT NULL,
  requires_signature boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS document_templates_project_version
  ON document_templates(project_id, code, version_number)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_templates_tenant_version
  ON document_templates(tenant_id, code, version_number)
  WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS document_templates_active_lookup
  ON document_templates(tenant_id, project_id, category, code, version_number DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS project_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'BUYER_ID','PASSPORT','ADDRESS_PROOF','PAYMENT_RECEIPT','CHEQUE','CONTRACT','STAMPED_CONTRACT','OTHER'
  )),
  required_count integer NOT NULL DEFAULT 1 CHECK (required_count > 0),
  required_for_completion boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, category)
);

CREATE TABLE IF NOT EXISTS transaction_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  template_id uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN (
    'BUYER_ID','PASSPORT','ADDRESS_PROOF','PAYMENT_RECEIPT','CHEQUE','CONTRACT','STAMPED_CONTRACT','OTHER'
  )),
  revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  supersedes_document_id uuid REFERENCES transaction_documents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN (
    'REQUESTED','UPLOADING','UPLOADED','VERIFIED','REJECTED','SIGNED','STAMPED','SUPERSEDED'
  )),
  storage_object_key text,
  original_filename text,
  mime_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256_hex text CHECK (sha256_hex IS NULL OR sha256_hex ~ '^[0-9a-fA-F]{64}$'),
  due_at timestamptz,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE CASCADE,
  UNIQUE (transaction_id, category, revision_number),
  UNIQUE (id, transaction_id),
  CHECK (
    status IN ('REQUESTED','UPLOADING')
    OR (storage_object_key IS NOT NULL AND sha256_hex IS NOT NULL AND uploaded_at IS NOT NULL)
  ),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CHECK (status NOT IN ('VERIFIED','SIGNED','STAMPED') OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS transaction_documents_transaction_status
  ON transaction_documents(transaction_id, category, status, revision_number DESC);

CREATE TABLE IF NOT EXISTS document_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES transaction_documents(id) ON DELETE CASCADE,
  signer_role text NOT NULL CHECK (signer_role IN ('BUYER','COMPANY','WITNESS','BROKER')),
  signer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  method text NOT NULL CHECK (method IN ('DRAWN','TYPED','UPLOAD','EXTERNAL_PROVIDER')),
  typed_name text,
  signature_object_key text,
  signature_sha256_hex text CHECK (signature_sha256_hex IS NULL OR signature_sha256_hex ~ '^[0-9a-fA-F]{64}$'),
  provider text,
  provider_envelope_id text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (method = 'TYPED' AND typed_name IS NOT NULL)
    OR (method IN ('DRAWN','UPLOAD') AND signature_object_key IS NOT NULL AND signature_sha256_hex IS NOT NULL)
    OR (method = 'EXTERNAL_PROVIDER' AND provider IS NOT NULL AND provider_envelope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS document_signatures_role_unique
  ON document_signatures(document_id, signer_role, COALESCE(signer_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  currency char(3) NOT NULL,
  total_contract_amount numeric(18,2) NOT NULL CHECK (total_contract_amount >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE CASCADE,
  UNIQUE (transaction_id),
  UNIQUE (id, transaction_id),
  CHECK (status NOT IN ('ACTIVE','COMPLETED') OR activated_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS payment_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_schedule_id uuid NOT NULL REFERENCES payment_schedules(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  item_type text NOT NULL CHECK (item_type IN ('DOWN_PAYMENT','INSTALLMENT','FEE')),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','DUE','PAID','OVERDUE','WAIVED','CANCELLED')),
  paid_at timestamptz,
  payment_reference text,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_schedule_id, sequence_number),
  CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND payment_reference IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS payment_schedule_items_due
  ON payment_schedule_items(due_at, status)
  WHERE status IN ('UPCOMING','DUE','OVERDUE');

CREATE TABLE IF NOT EXISTS transaction_cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  due_at timestamptz NOT NULL,
  cheque_number text,
  bank_name text,
  status text NOT NULL DEFAULT 'EXPECTED' CHECK (status IN ('EXPECTED','RECEIVED','DEPOSITED','CLEARED','RETURNED','CANCELLED')),
  received_at timestamptz,
  verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE CASCADE,
  UNIQUE (transaction_id, sequence_number),
  CHECK (status NOT IN ('RECEIVED','DEPOSITED','CLEARED') OR received_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS transaction_cheques_transaction_status
  ON transaction_cheques(transaction_id, status, sequence_number);

CREATE TABLE IF NOT EXISTS broker_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  broker_company_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED','CANCELLED')),
  rate_percent numeric(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  due_days_after_eligibility integer NOT NULL DEFAULT 30 CHECK (due_days_after_eligibility >= 0 AND due_days_after_eligibility <= 3650),
  effective_at timestamptz NOT NULL,
  activated_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (broker_company_id, tenant_id)
    REFERENCES broker_companies(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, broker_company_id, version_number),
  UNIQUE (id, tenant_id, project_id, broker_company_id),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS broker_commission_plans_active
  ON broker_commission_plans(project_id, broker_company_id, effective_at DESC, version_number DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS broker_commission_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  broker_company_id uuid NOT NULL,
  broker_agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  commission_plan_id uuid NOT NULL,
  basis_amount numeric(18,2) NOT NULL CHECK (basis_amount >= 0),
  rate_percent numeric(7,4) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  commission_amount numeric(18,2) NOT NULL CHECK (commission_amount >= 0),
  status text NOT NULL DEFAULT 'PENDING_PREREQUISITES' CHECK (status IN (
    'PENDING_PREREQUISITES','ELIGIBLE','INVOICED','DUE','PAID','DISPUTED','CANCELLED'
  )),
  completion_percent_snapshot numeric(5,2) NOT NULL DEFAULT 0 CHECK (completion_percent_snapshot BETWEEN 0 AND 100),
  eligible_at timestamptz,
  due_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (commission_plan_id, tenant_id, project_id, broker_company_id)
    REFERENCES broker_commission_plans(id, tenant_id, project_id, broker_company_id) ON DELETE RESTRICT,
  UNIQUE (transaction_id),
  UNIQUE (id, tenant_id, project_id),
  CHECK ((status = 'PENDING_PREREQUISITES' AND eligible_at IS NULL) OR status <> 'PENDING_PREREQUISITES'),
  CHECK (status NOT IN ('ELIGIBLE','INVOICED','DUE','PAID') OR eligible_at IS NOT NULL),
  CHECK (status <> 'PAID' OR paid_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS broker_commission_cases_broker_status
  ON broker_commission_cases(broker_company_id, project_id, status, due_at);

CREATE INDEX IF NOT EXISTS broker_commission_cases_due
  ON broker_commission_cases(due_at, status)
  WHERE status IN ('ELIGIBLE','INVOICED','DUE');

CREATE TABLE IF NOT EXISTS notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  transaction_id uuid,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('BUYER','BROKER_AGENT','BROKER_MANAGER','BROKER_FINANCE','SALES','TRANSACTION_OPERATOR','MANAGER')),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL','IN_APP')),
  template_code text NOT NULL,
  locale text NOT NULL DEFAULT 'ar-EG',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id, tenant_id, project_id)
    REFERENCES transactions(id, tenant_id, project_id) ON DELETE CASCADE,
  CHECK (transaction_id IS NULL OR project_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS notification_jobs_dispatch
  ON notification_jobs(scheduled_for, id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS notification_jobs_transaction
  ON notification_jobs(transaction_id, status, scheduled_for)
  WHERE transaction_id IS NOT NULL;

COMMIT;
