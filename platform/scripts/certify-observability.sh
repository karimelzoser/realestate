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

stage() {
  printf '\n[observability] %s\n' "$1"
}

assert_contains() {
  local pattern="$1" file="$2" label="$3"
  if ! grep -q -- "$pattern" "$file" 2>/dev/null; then
    echo "Observability assertion failed: $label" >&2
    echo "Expected pattern: $pattern" >&2
    echo "File: $file" >&2
    [[ -f "$file" ]] && cat "$file" >&2
    return 1
  fi
}

assert_not_contains() {
  local pattern="$1" file="$2" label="$3"
  if grep -q -- "$pattern" "$file" 2>/dev/null; then
    echo "Observability assertion failed: $label" >&2
    echo "Forbidden pattern: $pattern" >&2
    echo "File: $file" >&2
    cat "$file" >&2
    return 1
  fi
}

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
  stage 'prepare PostgreSQL fixture'
  dropdb --if-exists -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
  createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
  local migration
  for migration in packages/database/migrations/*.sql; do
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  done
}

certify_preload_policy() {
  stage 'certify production telemetry preload policy'

  set +e
  NODE_ENV=production PRENEURA_SERVICE_NAME=preneura-cert \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-missing.log 2>&1
  local missing_rc=$?
  set -e
  if [[ "$missing_rc" -eq 0 ]]; then
    cat /tmp/otel-missing.log >&2
    echo 'Observability assertion failed: production preload accepted a missing OTLP endpoint.' >&2
    return 1
  fi
  assert_contains 'OTEL_EXPORTER_OTLP_ENDPOINT is required in production' /tmp/otel-missing.log 'missing production endpoint must fail closed'

  set +e
  NODE_ENV=production PRENEURA_SERVICE_NAME=preneura-cert \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 OTEL_EXPORTER_OTLP_INSECURE=true \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-local.log 2>&1
  local local_rc=$?
  set -e
  if [[ "$local_rc" -eq 0 ]]; then
    cat /tmp/otel-local.log >&2
    echo 'Observability assertion failed: production preload accepted localhost OTLP.' >&2
    return 1
  fi
  assert_contains 'must not target localhost in production' /tmp/otel-local.log 'production OTLP must not target localhost'

  set +e
  NODE_ENV=production PRENEURA_SERVICE_NAME=preneura-cert \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.invalid OTEL_SDK_DISABLED=true \
    pnpm --filter @preneura/observability exec node --import @preneura/observability/register -e "console.log('unexpected')" \
    >/tmp/otel-disabled.log 2>&1
  local disabled_rc=$?
  set -e
  if [[ "$disabled_rc" -eq 0 ]]; then
    cat /tmp/otel-disabled.log >&2
    echo 'Observability assertion failed: production telemetry could be disabled.' >&2
    return 1
  fi
  assert_contains 'must not disable production telemetry' /tmp/otel-disabled.log 'production telemetry disable flag must fail closed'
}

certify_logger_redaction() {
  stage 'certify structured-log redaction'
  : >"$LOGGER_LOG"
  pnpm --filter @preneura/observability exec node --input-type=module - <<'JS' >"$LOGGER_LOG"
import { createLogger } from '@preneura/observability';
const logger = createLogger('observability-cert');
logger.info({ token: 'SUPER_SECRET_TOKEN_VALUE', phone: '+201234567890', safe: 'visible' }, 'redaction-cert');
JS
  assert_contains '"safe":"visible"' "$LOGGER_LOG" 'safe structured field must remain visible'
  assert_contains '\[REDACTED\]' "$LOGGER_LOG" 'sensitive fields must be visibly redacted'
  assert_not_contains 'SUPER_SECRET_TOKEN_VALUE' "$LOGGER_LOG" 'token secret leaked through logger'
  assert_not_contains '+201234567890' "$LOGGER_LOG" 'phone PII leaked through logger'
}

start_capture() {
  stage 'start local OTLP capture fixture'
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

certify_api() {
  stage 'certify API tracing and request correlation'
  : >"$API_LOG"
  NODE_ENV=test PORT=4190 WEB_ORIGIN=http://localhost:3000 \
  DATABASE_URL="$DATABASE_URL" OBJECT_STORAGE_BUCKET=observability-test \
  PRENEURA_SERVICE_NAME=preneura-api-cert \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  OTEL_METRIC_EXPORT_INTERVAL=500 OTEL_BSP_SCHEDULE_DELAY=100 \
    pnpm --filter @preneura/api start >"$API_LOG" 2>&1 &
  API_PID=$!
  wait_for_http http://127.0.0.1:4190/v1/health/live "$API_LOG" "$API_PID"

  if ! curl --silent --fail -D "$HEADERS" -o /tmp/observability-ready.json \
    -H 'x-request-id: observability-cert-123' \
    http://127.0.0.1:4190/v1/health/ready; then
    cat "$API_LOG" >&2
    cat /tmp/observability-ready.json >&2 || true
    echo 'Observability assertion failed: API readiness endpoint failed.' >&2
    return 1
  fi
  assert_contains '^x-request-id: observability-cert-123' "$HEADERS" 'valid request ID must be propagated'
  assert_contains '"status":"ready"' /tmp/observability-ready.json 'API readiness must be green'

  curl --silent --fail -D /tmp/observability-invalid-headers.txt -o /dev/null \
    -H 'x-request-id: invalid request id with spaces' \
    http://127.0.0.1:4190/v1/health/live
  assert_not_contains '^x-request-id: invalid request id with spaces' /tmp/observability-invalid-headers.txt 'invalid request ID must not echo'
  if ! grep -Eqi '^x-request-id: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}' /tmp/observability-invalid-headers.txt; then
    cat /tmp/observability-invalid-headers.txt >&2
    echo 'Observability assertion failed: invalid request ID was not replaced by UUIDv4.' >&2
    return 1
  fi

  wait_for_pattern '/v1/traces' "$CAPTURE_LOG" 20
  kill "$API_PID"
  wait "$API_PID" || true
  API_PID=''
}

certify_worker() {
  stage 'certify worker metrics export'
  : >"$WORKER_LOG"
  NODE_ENV=test DATABASE_URL="$DATABASE_URL" PRENEURA_SERVICE_NAME=preneura-worker-cert \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
  OTEL_METRIC_EXPORT_INTERVAL=500 OTEL_BSP_SCHEDULE_DELAY=100 \
  OUTBOX_POLL_MS=100 NOTIFICATION_POLL_MS=200 SLA_SCAN_MS=1000 \
  INSTALLMENT_REMINDER_SCAN_MS=1000 COMMISSION_DUE_SCAN_MS=1000 \
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

assert_contains '/v1/traces' "$CAPTURE_LOG" 'OTLP trace export must be observed'
assert_contains '/v1/metrics' "$CAPTURE_LOG" 'OTLP metric export must be observed'
echo 'Observability certification: PASS'
