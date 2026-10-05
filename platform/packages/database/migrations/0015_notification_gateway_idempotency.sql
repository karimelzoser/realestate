BEGIN;

CREATE TABLE IF NOT EXISTS notification_gateway_deliveries (
  idempotency_key text PRIMARY KEY,
  request_kind text NOT NULL CHECK (request_kind IN ('NOTIFICATION','AUTH_OTP','CONTACT_VERIFICATION')),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES auth_delivery_contacts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
  provider text,
  status text NOT NULL CHECK (status IN ('PROCESSING','SENT','FAILED')),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_gateway_deliveries_recipient
  ON notification_gateway_deliveries(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_gateway_deliveries_failed
  ON notification_gateway_deliveries(updated_at)
  WHERE status = 'FAILED';

COMMIT;