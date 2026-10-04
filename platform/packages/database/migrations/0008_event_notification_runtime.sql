BEGIN;

ALTER TABLE notification_jobs
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_by text;

CREATE INDEX IF NOT EXISTS notification_jobs_processing
  ON notification_jobs(processing_started_at, id)
  WHERE status = 'PROCESSING';

ALTER TABLE project_milestone_slas
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'TRANSACTION_OPERATOR'
    CHECK (audience IN ('BUYER','BROKER_AGENT','BROKER_MANAGER','BROKER_FINANCE','SALES','TRANSACTION_OPERATOR','MANAGER')),
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'IN_APP'
    CHECK (channel IN ('WHATSAPP','SMS','EMAIL','IN_APP')),
  ADD COLUMN IF NOT EXISTS template_code text NOT NULL DEFAULT 'transaction.milestone.sla';

CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_job_id uuid NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider text NOT NULL,
  result text NOT NULL CHECK (result IN ('SENT','FAILED')),
  provider_message_id text,
  error text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS notification_delivery_attempts_job
  ON notification_delivery_attempts(notification_job_id, attempt_number DESC);

CREATE TABLE IF NOT EXISTS realtime_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbox_event_id uuid NOT NULL UNIQUE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  topic text NOT NULL CHECK (topic IN ('CATALOG','INVENTORY','PRICING','QUEUE','TRANSACTION','COMMISSION','REFUND','DOMAIN')),
  source_event_type text NOT NULL,
  source_aggregate_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE,
  CHECK (project_id IS NULL OR tenant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS realtime_events_project_sequence
  ON realtime_events(tenant_id, project_id, sequence);

CREATE INDEX IF NOT EXISTS realtime_events_tenant_sequence
  ON realtime_events(tenant_id, sequence);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  notification_job_id uuid NOT NULL UNIQUE REFERENCES notification_jobs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_code text NOT NULL,
  locale text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (project_id, tenant_id)
    REFERENCES projects(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_notifications_recipient_sequence
  ON user_notifications(recipient_user_id, sequence DESC);

CREATE INDEX IF NOT EXISTS user_notifications_unread
  ON user_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION notify_preneura_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('preneura_realtime', json_build_object(
    'sequence', NEW.sequence,
    'tenantId', NEW.tenant_id,
    'projectId', NEW.project_id,
    'topic', NEW.topic
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_preneura_realtime_event ON realtime_events;
CREATE TRIGGER trg_notify_preneura_realtime_event
AFTER INSERT ON realtime_events
FOR EACH ROW
EXECUTE FUNCTION notify_preneura_realtime_event();

CREATE OR REPLACE FUNCTION notify_preneura_user_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('preneura_user_notification', json_build_object(
    'sequence', NEW.sequence,
    'recipientUserId', NEW.recipient_user_id
  )::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_preneura_user_notification ON user_notifications;
CREATE TRIGGER trg_notify_preneura_user_notification
AFTER INSERT ON user_notifications
FOR EACH ROW
EXECUTE FUNCTION notify_preneura_user_notification();

COMMIT;
