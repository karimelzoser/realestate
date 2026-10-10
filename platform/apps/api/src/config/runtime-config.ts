const MIN_SECRET_LENGTH = 32;
const MIN_API_BODY_LIMIT_BYTES = 64 * 1024;
const MAX_API_BODY_LIMIT_BYTES = 16 * 1024 * 1024;
const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function validateApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  requirePostgresUrl(env, 'DATABASE_URL', failures);
  requireHttpsOrigins(env, 'WEB_ORIGIN', failures);
  requireIntegerRange(env, 'TRUST_PROXY_HOPS', 1, 10, failures);
  requireIntegerRange(
    env,
    'API_BODY_LIMIT_BYTES',
    MIN_API_BODY_LIMIT_BYTES,
    MAX_API_BODY_LIMIT_BYTES,
    failures,
  );

  requireSecret(env, 'AUTH_IDENTIFIER_HMAC_KEY', failures);
  requireSecret(env, 'AUTH_OTP_PEPPER', failures);
  requireSecret(env, 'COOKIE_SIGNING_SECRET', failures);
  requireSecret(env, 'CONTACT_HMAC_KEY', failures);
  requireSecret(env, 'CONTACT_VERIFICATION_PEPPER', failures);
  requireBase64Key(env, 'CONTACT_ENCRYPTION_KEY_BASE64', 32, failures);

  if (env.OTP_PROVIDER !== 'gateway') {
    failures.push('OTP_PROVIDER must be gateway in production.');
  }
  requireAbsoluteUrl(env, 'AUTH_OTP_GATEWAY_URL', failures);
  requireAbsoluteUrl(env, 'CONTACT_VERIFICATION_GATEWAY_URL', failures);
  requireSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', failures);

  requireHttpsUrl(env, 'OIDC_ISSUER', failures);
  requireNonPlaceholder(env, 'OIDC_CLIENT_ID', failures);
  requireSecret(env, 'OIDC_CLIENT_SECRET', failures, 16);
  requireHttpsUrl(env, 'OIDC_REDIRECT_URI', failures);

  requireNonPlaceholder(env, 'OBJECT_STORAGE_BUCKET', failures);
  if (env.OBJECT_STORAGE_ENDPOINT?.trim()) {
    requireAbsoluteUrl(env, 'OBJECT_STORAGE_ENDPOINT', failures);
  }

  requireAbsoluteUrl(env, 'DOCUMENT_SCANNER_URL', failures);
  requireSecret(env, 'DOCUMENT_SCANNER_TOKEN', failures, 16);

  if (failures.length > 0) {
    throw new Error(`Invalid production configuration:\n- ${failures.join('\n- ')}`);
  }
}

function requireNonPlaceholder(
  env: NodeJS.ProcessEnv,
  name: string,
  failures: string[],
): string | null {
  const value = env[name]?.trim();
  if (!value) {
    failures.push(`${name} is required.`);
    return null;
  }
  if (isPlaceholder(value)) {
    failures.push(`${name} still contains a placeholder value.`);
    return null;
  }
  return value;
}

function requireSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  failures: string[],
  minimumLength = MIN_SECRET_LENGTH,
): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (value && value.length < minimumLength) {
    failures.push(`${name} must be at least ${minimumLength} characters.`);
  }
}

function requireBase64Key(
  env: NodeJS.ProcessEnv,
  name: string,
  expectedBytes: number,
  failures: string[],
): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes || decoded.toString('base64') !== value) {
    failures.push(`${name} must be canonical base64 encoding of exactly ${expectedBytes} bytes.`);
  }
}

function requireIntegerRange(
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
  failures: string[],
): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function requirePostgresUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      failures.push(`${name} must use a PostgreSQL URL.`);
    }
  } catch {
    failures.push(`${name} must be a valid PostgreSQL URL.`);
  }
}

function requireHttpsUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') failures.push(`${name} must use HTTPS in production.`);
  } catch {
    failures.push(`${name} must be a valid absolute URL.`);
  }
}

function requireAbsoluteUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      failures.push(`${name} must use HTTP or HTTPS.`);
    }
  } catch {
    failures.push(`${name} must be a valid absolute URL.`);
  }
}

function requireHttpsOrigins(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  for (const entry of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    try {
      const parsed = new URL(entry);
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        failures.push(`${name} entries must be HTTPS origins without path/query/fragment.`);
      }
      if (isLocalHostname(parsed.hostname)) {
        failures.push(`${name} entries must not target localhost/loopback in production.`);
      }
    } catch {
      failures.push(`${name} contains an invalid origin.`);
    }
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value) || value.trim().toLowerCase() === 'secret';
}
