type Env = NodeJS.ProcessEnv;

const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function assertApiRuntimeConfiguration(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  requiredUrl(env, 'DATABASE_URL', { protocols: ['postgres:', 'postgresql:'] });
  requiredHttpsList(env, 'WEB_ORIGIN');

  requiredSecret(env, 'AUTH_IDENTIFIER_HMAC_KEY', 32);
  requiredSecret(env, 'AUTH_OTP_PEPPER', 32);
  requiredSecret(env, 'COOKIE_SIGNING_SECRET', 32);
  requiredBase64Key(env, 'CONTACT_ENCRYPTION_KEY_BASE64', 32);
  requiredSecret(env, 'CONTACT_HMAC_KEY', 32);
  requiredSecret(env, 'CONTACT_VERIFICATION_PEPPER', 32);

  requiredUrl(env, 'OIDC_ISSUER', { protocols: ['https:'] });
  requiredValue(env, 'OIDC_CLIENT_ID');
  requiredSecret(env, 'OIDC_CLIENT_SECRET', 16);
  requiredUrl(env, 'OIDC_REDIRECT_URI', { protocols: ['https:'] });

  if (env.OTP_PROVIDER !== 'gateway') {
    throw new Error('OTP_PROVIDER must be gateway in production.');
  }
  requiredUrl(env, 'AUTH_OTP_GATEWAY_URL', { rejectLocalhost: true });
  requiredUrl(env, 'CONTACT_VERIFICATION_GATEWAY_URL', { rejectLocalhost: true });
  requiredSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', 32);

  requiredValue(env, 'OBJECT_STORAGE_BUCKET');
  const storageEndpoint = optionalTrimmed(env.OBJECT_STORAGE_ENDPOINT);
  if (storageEndpoint) assertUrl('OBJECT_STORAGE_ENDPOINT', storageEndpoint, { protocols: ['https:', 'http:'], rejectLocalhost: true });
  const accessKey = optionalTrimmed(env.OBJECT_STORAGE_ACCESS_KEY_ID);
  const secretKey = optionalTrimmed(env.OBJECT_STORAGE_SECRET_ACCESS_KEY);
  if ((accessKey && !secretKey) || (!accessKey && secretKey)) {
    throw new Error('OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY must be configured together.');
  }
  if (accessKey) rejectPlaceholder('OBJECT_STORAGE_ACCESS_KEY_ID', accessKey);
  if (secretKey) rejectPlaceholder('OBJECT_STORAGE_SECRET_ACCESS_KEY', secretKey);

  requiredUrl(env, 'DOCUMENT_SCANNER_URL', { rejectLocalhost: true });
  requiredSecret(env, 'DOCUMENT_SCANNER_TOKEN', 24);
  requiredSecret(env, 'FINANCE_PROVIDER_INGRESS_TOKEN', 32);

  positiveInteger(env, 'AUTH_OTP_TTL_SECONDS', 30, 1800);
  positiveInteger(env, 'AUTH_OTP_MAX_ATTEMPTS', 1, 20);
  positiveInteger(env, 'AUTH_OTP_RESEND_SECONDS', 10, 600);
  positiveInteger(env, 'SESSION_TTL_SECONDS', 300, 604800);
  positiveInteger(env, 'DOCUMENT_SCANNER_TIMEOUT_MS', 1000, 120000);
}

function requiredValue(env: Env, name: string): string {
  const value = optionalTrimmed(env[name]);
  if (!value) throw new Error(`${name} is required in production.`);
  rejectPlaceholder(name, value);
  return value;
}

function requiredSecret(env: Env, name: string, minLength: number): string {
  const value = requiredValue(env, name);
  if (value.length < minLength) throw new Error(`${name} must contain at least ${minLength} characters.`);
  return value;
}

function requiredBase64Key(env: Env, name: string, bytes: number): void {
  const value = requiredValue(env, name);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    throw new Error(`${name} must be valid base64.`);
  }
  if (decoded.length !== bytes || decoded.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')) {
    throw new Error(`${name} must decode to exactly ${bytes} bytes.`);
  }
}

function requiredUrl(
  env: Env,
  name: string,
  options: { protocols?: string[]; rejectLocalhost?: boolean } = {},
): void {
  assertUrl(name, requiredValue(env, name), options);
}

function assertUrl(
  name: string,
  value: string,
  options: { protocols?: string[]; rejectLocalhost?: boolean } = {},
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (options.protocols && !options.protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${options.protocols.join(' or ')}.`);
  }
  if (options.rejectLocalhost && isLocalHostname(url.hostname)) {
    throw new Error(`${name} must not target localhost in production.`);
  }
}

function requiredHttpsList(env: Env, name: string): void {
  const raw = requiredValue(env, name);
  const entries = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error(`${name} must contain at least one origin.`);
  for (const entry of entries) {
    assertUrl(name, entry, { protocols: ['https:'], rejectLocalhost: true });
  }
}

function positiveInteger(env: Env, name: string, min: number, max: number): void {
  const raw = requiredValue(env, name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function rejectPlaceholder(name: string, value: string): void {
  if (PLACEHOLDER_PATTERN.test(value)) throw new Error(`${name} contains a placeholder value.`);
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
