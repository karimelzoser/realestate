BEGIN;

CREATE TABLE IF NOT EXISTS project_milestone_reminder_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  milestone_code text NOT NULL CHECK (milestone_code IN (
    'BUYER_DOCUMENTS_COMPLETE',
    'DOWN_PAYMENT_RECEIVED',
    'CHEQUES_RECEIVED',
    'CONTRACT_GENERATED',
    'CONTRACT_SIGNED',
    'CONTRACT_STAMPED'
  )),
  target_hours_after_open integer NOT NULL
    CHECK (target_hours_after_open > 0 AND target_hours_after_open <= 87600),
  reminder_hours_before integer NOT NULL DEFAULT 24
    CHECK (reminder_hours_before >= 0 AND reminder_hours_before <= 87600),
  audience text NOT NULL CHECK (audience IN (
    'BUYER','BROKER_AGENT','BROKER_MANAGER','BROKER_FINANCE','SALES','TRANSACTION_OPERATOR','MANAGER'
  )),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL','IN_APP')),
  template_code text NOT NULL DEFAULT 'transaction.milestone.sla',
  locale text NOT NULL DEFAULT 'ar-EG',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, milestone_code, audience, channel)
);

CREATE INDEX IF NOT EXISTS project_milestone_reminder_policies_active
  ON project_milestone_reminder_policies(project_id, milestone_code, audience, channel)
  WHERE enabled = true;

INSERT INTO project_milestone_reminder_policies (
  tenant_id,
  project_id,
  milestone_code,
  target_hours_after_open,
  reminder_hours_before,
  audience,
  channel,
  template_code,
  enabled,
  created_at,
  updated_at
)
SELECT
  tenant_id,
  project_id,
  milestone_code,
  target_hours_after_open,
  reminder_hours_before,
  audience,
  channel,
  template_code,
  enabled,
  created_at,
  updated_at
FROM project_milestone_slas
ON CONFLICT (project_id, milestone_code, audience, channel) DO NOTHING;

COMMIT;
