BEGIN;

CREATE TABLE IF NOT EXISTS project_installment_reminder_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('DOWN_PAYMENT','INSTALLMENT','FEE')),
  audience text NOT NULL CHECK (audience IN (
    'BUYER','BROKER_AGENT','BROKER_MANAGER','BROKER_FINANCE','SALES','TRANSACTION_OPERATOR','MANAGER'
  )),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL','IN_APP')),
  reminder_hours_before integer NOT NULL DEFAULT 24
    CHECK (reminder_hours_before >= 0 AND reminder_hours_before <= 87600),
  template_code text NOT NULL DEFAULT 'payment.installment.due',
  locale text NOT NULL DEFAULT 'ar-EG',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, item_type, audience, channel)
);

CREATE INDEX IF NOT EXISTS project_installment_reminder_policies_active
  ON project_installment_reminder_policies(project_id, item_type, audience, channel)
  WHERE enabled = true;

COMMIT;
