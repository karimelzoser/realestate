"""Generate secrets only inside the dedicated VPS directory; never print values."""
from pathlib import Path
import base64
import os
import secrets
import json
import tempfile

base = Path('/opt/realestate-os-testing')
if base.resolve() != base:
    raise RuntimeError('Unexpected isolated deployment directory')

def read_env(name):
    return dict(line.split('=', 1) for line in (base / name).read_text().splitlines()
                if line and not line.startswith('#'))

def write_env(name, values):
    descriptor = os.open(str(base / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(''.join(key + '=' + value + '\n' for key, value in values.items()))

database = read_env('.env.infrastructure')
identity = read_env('.env.identity')
storage = read_env('.env.storage')
scanner = read_env('.env.scanner')
roles = read_env('.env.service-roles')
source_sha = os.environ['PRENEURA_CERTIFIED_SOURCE_SHA']
if len(source_sha) != 40 or any(value not in '0123456789abcdef' for value in source_sha):
    raise RuntimeError('Exact certified source SHA is required')
origin = 'https://realestate-test.aipreneura.com:8443'
telemetry = {
    'NODE_ENV': 'production', 'APP_ENV': 'public-test',
    'OTEL_EXPORTER_OTLP_ENDPOINT': 'http://telemetry:4318',
    'OTEL_EXPORTER_OTLP_INSECURE': 'true',
    'OTEL_SERVICE_VERSION': source_sha,
    'OTEL_TRACE_SAMPLE_RATIO': '0.1',
    'OTEL_NODE_RESOURCE_DETECTORS': 'env,host,os,process',
}
gateway_token = secrets.token_hex(32)
contact_key = base64.b64encode(secrets.token_bytes(32)).decode()
api = {
    **telemetry, 'PORT': '4100', 'PRENEURA_SERVICE_NAME': 'realestate-os-api',
    'DATABASE_URL': 'postgresql://realestate_os_app:' + database['PRENEURA_APP_PASSWORD'] + '@postgres:5432/realestate_os',
    'PRENEURA_EXPECTED_RELEASE_SHA': source_sha, 'WEB_ORIGIN': origin,
    'TRUST_PROXY_HOPS': '1', 'API_BODY_LIMIT_BYTES': '8388608',
    'AUTH_PHONE_LOGIN_ENABLED': 'false', 'OTP_PROVIDER': 'gateway', 'OTP_CHANNEL': 'whatsapp',
    'AUTH_STEP_UP_BASE_MAX_AGE_SECONDS': '600', 'SESSION_COOKIE_NAME': 'preneura_session',
    'AUTH_OTP_GATEWAY_URL': 'http://notification-gateway:4300/auth-otp',
    'CONTACT_VERIFICATION_GATEWAY_URL': 'http://notification-gateway:4300/contact-verification',
    'NOTIFICATION_GATEWAY_TOKEN': gateway_token,
    'CONTACT_ENCRYPTION_KEY_BASE64': contact_key,
    'OIDC_ISSUER': origin + '/identity/realms/realestate',
    'OIDC_CLIENT_ID': 'realestate-web', 'OIDC_CLIENT_SECRET': identity['OIDC_CLIENT_SECRET'],
    'OIDC_IDP_HINT': '', 'OIDC_AAL2_ACR_VALUES': 'urn:preneura:aal2',
    'OIDC_REDIRECT_URI': origin + '/api/v1/auth/google/callback',
    'OBJECT_STORAGE_BUCKET': 'realestate-private-documents', 'OBJECT_STORAGE_REGION': 'us-east-1',
    'OBJECT_STORAGE_ENDPOINT': 'http://object-storage:8333',
    'OBJECT_STORAGE_PUBLIC_ENDPOINT': 'https://realestate-test.aipreneura.com:8444',
    'OBJECT_STORAGE_FORCE_PATH_STYLE': 'true', **storage,
    'DOCUMENT_SCANNER_URL': 'http://scanner:4400/scan',
    'DOCUMENT_SCANNER_TOKEN': scanner['DOCUMENT_SCANNER_TOKEN'],
    'DOCUMENT_SCANNER_TIMEOUT_MS': '60000',
}
for key in ['AUTH_IDENTIFIER_HMAC_KEY', 'AUTH_OTP_PEPPER', 'IDENTITY_DOCUMENT_HMAC_KEY',
            'IDENTITY_RECOVERY_OTP_PEPPER', 'COOKIE_SIGNING_SECRET', 'CONTACT_HMAC_KEY',
            'CONTACT_VERIFICATION_PEPPER', 'FINANCE_PROVIDER_INGRESS_TOKEN',
            'SETTLEMENT_PROVIDER_INGRESS_TOKEN']:
    api[key] = secrets.token_hex(32)
worker = {
    **telemetry, 'PRENEURA_SERVICE_NAME': 'realestate-os-worker',
    'DATABASE_URL': 'postgresql://realestate_os_worker:' + roles['WORKER_DATABASE_PASSWORD'] + '@postgres:5432/realestate_os',
    'WORKER_ID': 'realestate-os-worker-1', 'NOTIFICATION_EXTERNAL_DELIVERY_ENABLED': 'false',
    'NOTIFICATION_GATEWAY_URL': 'http://notification-gateway:4300/deliver',
    'NOTIFICATION_GATEWAY_TOKEN': gateway_token,
    'INVENTORY_LOCK_EXPIRY_SCAN_MS': '1000', 'INVENTORY_LOCK_EXPIRY_BATCH_SIZE': '500',
    'OUTBOX_POLL_MS': '500', 'NOTIFICATION_POLL_MS': '1000', 'SLA_SCAN_MS': '30000',
    'INSTALLMENT_REMINDER_SCAN_MS': '30000', 'COMMISSION_DUE_SCAN_MS': '30000',
}
gateway = {
    **telemetry, 'PORT': '4300', 'PRENEURA_SERVICE_NAME': 'realestate-os-notification-gateway',
    'DATABASE_URL': 'postgresql://realestate_os_gateway:' + roles['GATEWAY_DATABASE_PASSWORD'] + '@postgres:5432/realestate_os',
    'CONTACT_ENCRYPTION_KEY_BASE64': contact_key, 'NOTIFICATION_GATEWAY_TOKEN': gateway_token,
    # Deliberately absent credentials: production startup rejects this profile
    # until the operator supplies real approved delivery-provider settings.
    'META_GRAPH_API_VERSION': '', 'META_WHATSAPP_PHONE_NUMBER_ID': '',
    'META_WHATSAPP_ACCESS_TOKEN': '', 'WHATSAPP_TEMPLATE_BINDINGS_JSON': '',
}
profiles = {'.env.api': api, '.env.worker': worker, '.env.gateway': gateway,
            '.env.runtime': {'PRENEURA_RUNTIME_IMAGE': 'realestate-os-testing-web:' + source_sha}}
bundle_path = base / '.runtime-bootstrap-secrets.json'
if bundle_path.exists():
    bundle = json.loads(bundle_path.read_text())
    if bundle['sourceSha'] != source_sha:
        raise RuntimeError('Existing bootstrap requires ordinary roll-forward; do not regenerate encryption keys')
    profiles = bundle['profiles']
else:
    with tempfile.NamedTemporaryFile(mode='w', dir=str(base), prefix='.secret-bootstrap-', delete=False) as output:
        json.dump({'sourceSha': source_sha, 'profiles': profiles}, output)
        output.flush()
        os.fsync(output.fileno())
        temporary_path = output.name
    try:
        os.link(temporary_path, str(bundle_path))
    finally:
        os.unlink(temporary_path)
for name, values in profiles.items():
    if (base / name).exists():
        if read_env(name) != values:
            raise RuntimeError('Existing environment differs; preserve it and inspect before proceeding')
    else:
        write_env(name, values)
print('Generated separate API/worker/gateway environments and cryptographic keys; no secret output.')
