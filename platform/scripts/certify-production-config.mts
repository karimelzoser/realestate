import { validateApiRuntimeConfig as assertApiRuntimeConfiguration } from '../apps/api/src/config/runtime-config.ts';
import { validateWorkerRuntimeConfig as assertWorkerRuntimeConfiguration } from '../apps/worker/src/runtime-config.ts';
import { assertNotificationGatewayRuntimeConfiguration } from '../apps/notification-gateway/src/runtime-config.ts';

type Env = NodeJS.ProcessEnv;

const longSecret = 's'.repeat(48);
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

const apiBase: Env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/preneura',
  WEB_ORIGIN: 'https://app.preneura.example',
  TRUST_PROXY_HOPS: '1',
  API_BODY_LIMIT_BYTES: '8388608',
  AUTH_IDENTIFIER_HMAC_KEY: longSecret,
  AUTH_OTP_PEPPER: longSecret,
  COOKIE_SIGNING_SECRET: longSecret,
  CONTACT_ENCRYPTION_KEY_BASE64: encryptionKey,
  CONTACT_HMAC_KEY: longSecret,
  CONTACT_VERIFICATION_PEPPER: longSecret,
  OIDC_ISSUER: 'https://identity.preneura.example/realms/preneura',
  OIDC_CLIENT_ID: 'preneura-web',
  OIDC_CLIENT_SECRET: longSecret,
  OIDC_REDIRECT_URI: 'https://api.preneura.example/v1/auth/google/callback',
  OTP_PROVIDER: 'gateway',
  AUTH_OTP_GATEWAY_URL: 'http://notification-gateway.railway.internal/auth-otp',
  CONTACT_VERIFICATION_GATEWAY_URL: 'http://notification-gateway.railway.internal/contact-verification',
  NOTIFICATION_GATEWAY_TOKEN: longSecret,
  OBJECT_STORAGE_BUCKET: 'preneura-documents',
  OBJECT_STORAGE_REGION: 'me-south-1',
  DOCUMENT_SCANNER_URL: 'http://document-scanner.railway.internal/scan',
  DOCUMENT_SCANNER_TOKEN: longSecret,
  FINANCE_PROVIDER_INGRESS_TOKEN: longSecret,
  SETTLEMENT_PROVIDER_INGRESS_TOKEN: longSecret,
  AUTH_OTP_TTL_SECONDS: '300',
  AUTH_OTP_MAX_ATTEMPTS: '5',
  AUTH_OTP_RESEND_SECONDS: '60',
  SESSION_TTL_SECONDS: '43200',
  DOCUMENT_SCANNER_TIMEOUT_MS: '20000',
};

const workerBase: Env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/preneura',
  NOTIFICATION_GATEWAY_URL: 'http://notification-gateway.railway.internal/deliver',
  NOTIFICATION_GATEWAY_TOKEN: longSecret,
  INVENTORY_LOCK_EXPIRY_SCAN_MS: '1000',
  INVENTORY_LOCK_EXPIRY_BATCH_SIZE: '500',
  OUTBOX_POLL_MS: '300',
  NOTIFICATION_POLL_MS: '1000',
  SLA_SCAN_MS: '30000',
  INSTALLMENT_REMINDER_SCAN_MS: '30000',
  COMMISSION_DUE_SCAN_MS: '30000',
};

const gatewayBase: Env = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://gateway:secret@db.internal:5432/preneura',
  CONTACT_ENCRYPTION_KEY_BASE64: encryptionKey,
  NOTIFICATION_GATEWAY_TOKEN: longSecret,
  META_GRAPH_API_VERSION: 'v99.0',
  META_WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  META_WHATSAPP_ACCESS_TOKEN: longSecret,
  WHATSAPP_TEMPLATE_BINDINGS_JSON: JSON.stringify({
    'auth.login.otp': {
      name: 'preneura_login_otp',
      language: 'ar',
      bodyParameterPaths: ['code'],
    },
  }),
  PORT: '4300',
};

expectPass('api.valid', () => assertApiRuntimeConfiguration({ ...apiBase }));
expectFail('api.placeholder-secret', 'placeholder', () =>
  assertApiRuntimeConfiguration({ ...apiBase, COOKIE_SIGNING_SECRET: 'replace-with-real-secret-value-1234567890' }),
);
expectFail('api.console-otp', 'OTP_PROVIDER', () =>
  assertApiRuntimeConfiguration({ ...apiBase, OTP_PROVIDER: 'console' }),
);
expectFail('api.localhost-origin', 'localhost', () =>
  assertApiRuntimeConfiguration({ ...apiBase, WEB_ORIGIN: 'https://localhost:3000' }),
);
expectFail('api.invalid-contact-key', '32 bytes', () =>
  assertApiRuntimeConfiguration({ ...apiBase, CONTACT_ENCRYPTION_KEY_BASE64: Buffer.alloc(16, 1).toString('base64') }),
);
expectPass('api.development-skips-production-contract', () =>
  assertApiRuntimeConfiguration({ NODE_ENV: 'development' }),
);

expectPass('worker.valid', () => assertWorkerRuntimeConfiguration({ ...workerBase }));
expectFail('worker.short-gateway-token', '32 characters', () =>
  assertWorkerRuntimeConfiguration({ ...workerBase, NOTIFICATION_GATEWAY_TOKEN: 'too-short' }),
);
expectFail('worker.localhost-gateway', 'localhost', () =>
  assertWorkerRuntimeConfiguration({ ...workerBase, NOTIFICATION_GATEWAY_URL: 'http://localhost:4300/deliver' }),
);
expectFail('worker.unsafe-poll', 'between', () =>
  assertWorkerRuntimeConfiguration({ ...workerBase, OUTBOX_POLL_MS: '1' }),
);
expectFail('worker.unsafe-inventory-poll', 'INVENTORY_LOCK_EXPIRY_SCAN_MS', () =>
  assertWorkerRuntimeConfiguration({ ...workerBase, INVENTORY_LOCK_EXPIRY_SCAN_MS: '1' }),
);
expectFail('worker.invalid-inventory-batch', 'INVENTORY_LOCK_EXPIRY_BATCH_SIZE', () =>
  assertWorkerRuntimeConfiguration({ ...workerBase, INVENTORY_LOCK_EXPIRY_BATCH_SIZE: '5001' }),
);

expectPass('gateway.valid', () => assertNotificationGatewayRuntimeConfiguration({ ...gatewayBase }));
expectFail('gateway.short-token', '32 characters', () =>
  assertNotificationGatewayRuntimeConfiguration({ ...gatewayBase, NOTIFICATION_GATEWAY_TOKEN: 'short' }),
);
expectFail('gateway.bad-bindings-json', 'valid JSON', () =>
  assertNotificationGatewayRuntimeConfiguration({ ...gatewayBase, WHATSAPP_TEMPLATE_BINDINGS_JSON: '{bad' }),
);
expectFail('gateway.empty-template-name', 'non-empty name', () =>
  assertNotificationGatewayRuntimeConfiguration({
    ...gatewayBase,
    WHATSAPP_TEMPLATE_BINDINGS_JSON: JSON.stringify({ 'auth.login.otp': { name: '' } }),
  }),
);
expectFail('gateway.localhost-sms-provider', 'localhost', () =>
  assertNotificationGatewayRuntimeConfiguration({
    ...gatewayBase,
    SMS_PROVIDER_URL: 'http://localhost:4500/send',
  }),
);

console.log('Production configuration certification: PASS');

function expectPass(name: string, fn: () => void): void {
  try {
    fn();
    console.log(JSON.stringify({ case: name, result: 'pass' }));
  } catch (error) {
    throw new Error(`${name} unexpectedly failed: ${message(error)}`);
  }
}

function expectFail(name: string, messageFragment: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const text = message(error);
    if (!text.toLowerCase().includes(messageFragment.toLowerCase())) {
      throw new Error(`${name} failed with unexpected message: ${text}`);
    }
    console.log(JSON.stringify({ case: name, result: 'rejected', reason: text }));
    return;
  }
  throw new Error(`${name} unexpectedly passed.`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
