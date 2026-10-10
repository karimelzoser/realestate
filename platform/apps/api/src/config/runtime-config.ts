const MIN_SECRET_LENGTH = 32;
const MIN_API_BODY_LIMIT_BYTES = 64 * 1024;
const MAX_API_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

export function validateApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  requirePostgresUrl(env, 'DATABASE_URL', failures);
  requireHttpsOrigins(env, 'WEB_ORIGIN', failures);
  requireIntegerRange(env, 'TRUST_PROXY_HOPS', 1, 10, failures);
  requireIntegerRange(env, 'API_BODY_LIMIT_BYTES', MIN_API_BODY_LIMIT_BYTES, MAX_API_BODY_LIMIT_BYTES, failures);

  requireSecret(env, 'AUTH_IDENTIFIER_HMAC_KEY', failures);
  requireSecret(env, 'AUTH_OTP_PEPPER', failures);
  requireSecret(env, 'COOKIE_SIGNING_SECRET', failures);
  requireSecret(env, 'CONTACT_HMAC_KEY', failures);
  requireSecret(env, 'CONTACT_VERIFICATION_PEPPER', failures);
  requireBase64Key(env, 'CONTACT_ENCRYPTION_KEY_BASE64', 32, failures);

  if (env.OTP_PROVIDER !== 'gateway') failures.push('OTP_PROVIDER must be gateway in production.');
  requireHttpUrl(env, 'AUTH_OTP_GATEWAY_URL', failures, true);
  requireHttpUrl(env, 'CONTACT_VERIFICATION_GATEWAY_URL', failures, true);
  requireSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', failures);

  requireHttpsUrl(env, 'OIDC_ISSUER', failures, true);
  requireNonPlaceholder(env, 'OIDC_CLIENT_ID', failures);
  requireSecret(env, 'OIDC_CLIENT_SECRET', failures, 16);
  requireHttpsUrl(env, 'OIDC_REDIRECT_URI', failures, true);

  requireNonPlaceholder(env, 'OBJECT_STORAGE_BUCKET', failures);
  if (env.OBJECT_STORAGE_ENDPOINT?.trim()) requireHttpUrl(env, 'OBJECT_STORAGE_ENDPOINT', failures, true);
  const storageAccessKey = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const storageSecretKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if ((storageAccessKey && !storageSecretKey) || (!storageAccessKey && storageSecretKey)) {
    failures.push('OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY must be configured together.');
  }
  if (storageAccessKey && isPlaceholder(storageAccessKey)) failures.push('OBJECT_STORAGE_ACCESS_KEY_ID contains a placeholder value.');
  if (storageSecretKey && isPlaceholder(storageSecretKey)) failures.push('OBJECT_STORAGE_SECRET_ACCESS_KEY contains a placeholder value.');

  requireHttpUrl(env, 'DOCUMENT_SCANNER_URL', failures, true);
  requireSecret(env, 'DOCUMENT_SCANNER_TOKEN', failures, 24);
  requireSecret(env, 'FINANCE_PROVIDER_INGRESS_TOKEN', failures);

  requireIntegerRange(env, 'AUTH_OTP_TTL_SECONDS', 30, 1800, failures);
  requireIntegerRange(env, 'AUTH_OTP_MAX_ATTEMPTS', 1, 20, failures);
  requireIntegerRange(env, 'AUTH_OTP_RESEND_SECONDS', 10, 600, failures);
  requireIntegerRange(env, 'SESSION_TTL_SECONDS', 300, 604800, failures);
  requireIntegerRange(env, 'DOCUMENT_SCANNER_TIMEOUT_MS', 1000, 120000, failures);

  if (failures.length > 0) throw new Error(`Invalid production configuration:\n- ${failures.join('\n- ')}`);
}

function requireNonPlaceholder(env: NodeJS.ProcessEnv, name: string, failures: string[]): string | null {
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

function requireSecret(env: NodeJS.ProcessEnv, name: string, failures: string[], minimumLength = MIN_SECRET_LENGTH): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (value && value.length < minimumLength) failures.push(`${name} must be at least ${minimumLength} characters.`);
}

function requireBase64Key(env: NodeJS.ProcessEnv, name: string, expectedBytes: number, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== expectedBytes || decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')) {
    failures.push(`${name} must be canonical base64 encoding of exactly ${expectedBytes} bytes.`);
  }
}

function requireIntegerRange(env: NodeJS.ProcessEnv, name: string, minimum: number, maximum: number, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) failures.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
}

function requirePostgresUrl(env: NodeJS.ProcessEnv, name: string, failures: string[]): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) failures.push(`${name} must use a PostgreSQL URL.`);
  } catch {
    failures.push(`${name} must be a valid PostgreSQL URL.`);
  }
}

function requireHttpsUrl(env: NodeJS.ProcessEnv, name: string, failures: string[], rejectLocalhost = false): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') failures.push(`${name} must use HTTPS in production.`);
    if (rejectLocalhost && isLocalHostname(parsed.hostname)) failures.push(`${name} must not target localhost in production.`);
  } catch {
    failures.push(`${name} must be a valid absolute URL.`);
  }
}

function requireHttpUrl(env: NodeJS.ProcessEnv, name: string, failures: string[], rejectLocalhost = false): void {
  const value = requireNonPlaceholder(env, name, failures);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) failures.push(`${name} must use HTTP or HTTPS.`);
    if (rejectLocalhost && isLocalHostname(parsed.hostname)) failures.push(`${name} must not target localhost in production.`);
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
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || isLocalHostname(parsed.hostname)) {
        failures.push(`${name} entries must be non-local HTTPS origins without path/query/fragment.`);
      }
    } catch {
      failures.push(`${name} contains an invalid origin.`);
    }
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('replace') || normalized.includes('change-me') || normalized.includes('changeme') || normalized.includes('placeholder') || normalized.includes('example-secret') || normalized.includes('your-secret') || normalized.includes('dummy') || normalized === 'secret';
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
