BEGIN;

UPDATE notification_jobs
SET
  status = 'CANCELLED',
  updated_at = now()
WHERE status = 'PENDING'
  AND idempotency_key LIKE 'sla:%';

COMMIT;
