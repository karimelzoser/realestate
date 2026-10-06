#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
export PGPASSWORD

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_NAME=preneura_observability
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB_NAME"
CAPTURE_LOG=/tmp/preneura-otel-capture.log
CAPTURE_SCRIPT=/tmp/preneura-otel-capture.mjs
API_LOG=/tmp/preneura-observability-api.log
WORKER_LOG=/tmp/preneura-observability-worker.log
LOGGER_LOG=/tmp/preneura-observability-logger.log
HEADERS=/tmp/preneura-observability-headers.txt

cleanup() {
  for pid in "${API_PID:-}" "${WORKER_PID:-}" "${CAPTURE_PID:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  done
  rm -f "$CAPTURE_SCRIPT"
}
trap cleanup EXIT

wait_for_http() {
  local url="$1" log_file="$2" pid="$3"
  local attempt
  for attempt in {1..40}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      cat "$log_file" >&2
      echo "Process exited before $url became available." >&2
      return 1
    fi
    if curl --fail --silent "$url" >/dev/null; then return 0; fi
    sleep 0.5
  done
  cat "$log_file" >&2
  echo "Timed out waiting for $url." >&2
  return 1
}

wait_for_pattern() {
  local pattern="$1" file="$2" seconds="${3:-15}"
  local attempt
  for ((attempt=0; attempt<seconds*2; attempt++)); do
    if grep -q -- "$pattern" "$file" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  echo "Expected pattern '$pattern' was not observed in $file." >&2
  [[ -f "$file" ]] && cat "$file" >&2
  return 1
}

prepare_database() {
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
  local migration
  for migration in packages/database/migrations/*.sql; do
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done
}

start_capture() {
  : >"$CAPTURE_LOG"
  cat >"$CAPTURE_SCRIPT" <<'JS'
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const logFile = process.env.CAPTURE_LOG;
if (!logFile) throw new Error('CAPTURE_LOG is required');
const server = createServer(async (request, response) => {
  let size = 0;
  for await (const chunk of request) size += Buffer.byteLength(chunk);
  appendFileSync(logFile, `${request.method ?? ''} ${request.url ?? ''} ${size}\n`);
  response.writeHead(200, { 'content-type': 'application/x-protobuf' });
  response.end();
});
server.listen(4318, '127.0.0.1', () => appendFileSync(logFile, 'READY\n'));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
JS
  CAPTURE_LOG="$CAPTURE_LOG" node "$CAPTURE_SCRIPT" >/tmp/preneura-otel-capture.stdout 2>&1 &
  CAPTURE_PID=$!
  wait_for_pattern '^READY$' "$CAPTURE_LOG" 10
}

certify_preload_policy() {
  set +e
  NODE_ENV=production \
    PRENEURA_SERVICE_NAME=preneura-cert \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-missing.log 2>&1
  local missing_rc=$?
  set -e
  test "$missing_rc" -ne 0
  grep -q 'OTEL_EXPORTER_OTLP_ENDPOINT is required in production' /tmp/otel-missing.log

  set +e
  NODE_ENV=production \
    PRENEURA_SERVICE_NAME=preneura-cert \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
    OTEL_EXPORTER_OTLP_INSECURE=true \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-local.log 2>&1
  local local_rc=$?
  set -e
  test "$local_rc" -ne 0
  grep -q 'must not target localhost in production' /tmp/otel-local.log

  set +e
  NODE_ENV=production \
    PRENEURA_SERVICE_NAME=preneura-cert \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.invalid \
    OTEL_SDK_DISABLED=true \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-disabled.log 2>&1
  local disabled_rc=$?
  set -e
  test "$disabled_rc" -ne 0
  grep -q 'must not disable production telemetry' /tmp/otel-disabled.log
}

certify_logger_redaction() {
  : >"$LOGGER_LOG"
  pnpm --filter @preneura/observability exec node --input-type=module - <<'JS' >"$LOGGER_LOG"
import { createLogger } from '@preneura/observability';
const logger = createLogger('observability-cert');
logger.info({ token: 'SUPER_SECRET_TOKEN_VALUE', phone: '+201234567890', safe: 'visible' }, 'redaction-cert');
JS
  grep -q '"safe":"visible"' "$LOGGER_LOG"
  grep -q '\[REDACTED\]' "$LOGGER_LOG"
  ! grep -q 'SUPER_SECRET_TOKEN_VALUE' "$LOGGER_LOG"
  ! grep -q '+201234567890' "$LOGGER_LOG"
}

certify_api() {
  : >"$API_LOG"
  NODE_ENV=test \
  PORT=4190 \
  WEB_ORIGIN=http://localhost:3000 \
  DATABASE_URL="$DATABASE_URL" \
  OBJECT_STORAGE_BUCKET=observability-test \
  PRENEURA_SERVICE_NAME=preneura-api-cert \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  OTEL_METRIC_EXPORT_INTERVAL=500 \
  OTEL_BSP_SCHEDULE_DELAY=100 \
    pnpm --filter @preneura/api start >"$API_LOG" 2>&1 &
  API_PID=$!
  wait_for_http http://127.0.0.1:4190/v1/health/live "$API_LOG" "$API_PID"

  curl --silent --fail -D "$HEADERS" -o /tmp/observability-ready.json \
    -H 'x-request-id: observability-cert-123' \
    http://127.0.0.1:4190/v1/health/ready
  grep -qi '^x-request-id: observability-cert-123' "$HEADERS"
  grep -q '"status":"ready"' /tmp/observability-ready.json

  curl --silent --fail -D /tmp/observability-invalid-headers.txt -o /dev/null \
    -H 'x-request-id: invalid request id with spaces' \
    http://127.0.0.1:4190/v1/health/live
  ! grep -qi '^x-request-id: invalid request id with spaces' /tmp/observability-invalid-headers.txt
  grep -Eqi '^x-request-id: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' /tmp/observability-invalid-headers.txt

  wait_for_pattern '/v1/traces' "$CAPTURE_LOG" 20
  kill "$API_PID"
  wait "$API_PID" || true
  API_PID=''
}

certify_worker() {
  : >"$WORKER_LOG"
  NODE_ENV=test \
  DATABASE_URL="$DATABASE_URL" \
  PRENEURA_SERVICE_NAME=preneura-worker-cert \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  OTEL_METRIC_EXPORT_INTERVAL=500 \
  OTEL_BSP_SCHEDULE_DELAY=100 \
  OUTBOX_POLL_MS=100 \
  NOTIFICATION_POLL_MS=200 \
  SLA_SCAN_MS=1000 \
  INSTALLMENT_REMINDER_SCAN_MS=1000 \
  COMMISSION_DUE_SCAN_MS=1000 \
    pnpm --filter @preneura/worker start >"$WORKER_LOG" 2>&1 &
  WORKER_PID=$!
  wait_for_pattern '"event":"worker.ready"' "$WORKER_LOG" 15
  wait_for_pattern '/v1/metrics' "$CAPTURE_LOG" 20
  kill "$WORKER_PID"
  wait "$WORKER_PID" || true
  WORKER_PID=''
}

prepare_database
certify_preload_policy
certify_logger_redaction
start_capture
certify_api
certify_worker

grep -q '/v1/traces' "$CAPTURE_LOG"
grep -q '/v1/metrics' "$CAPTURE_LOG"
echo 'Observability certification: PASS'
