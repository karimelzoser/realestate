type Env = NodeJS.ProcessEnv;

const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function assertWorkerRuntimeConfiguration(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  requiredUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  requiredUrl(env, 'NOTIFICATION_GATEWAY_URL', ['https:', 'http:'], true);
  requiredSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', 32);

  boundedInteger(env, 'OUTBOX_POLL_MS', 50, 60_000);
  boundedInteger(env, 'NOTIFICATION_POLL_MS', 100, 60_000);
  boundedInteger(env, 'SLA_SCAN_MS', 1_000, 3_600_000);
  boundedInteger(env, 'INSTALLMENT_REMINDER_SCAN_MS', 1_000, 3_600_000);
  boundedInteger(env, 'COMMISSION_DUE_SCAN_MS', 1_000, 3_600_000);
}

function requiredValue(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  if (PLACEHOLDER_PATTERN.test(value)) throw new Error(`${name} contains a placeholder value.`);
  return value;
}

function requiredSecret(env: Env, name: string, minLength: number): void {
  const value = requiredValue(env, name);
  if (value.length < minLength) throw new Error(`${name} must contain at least ${minLength} characters.`);
}

function requiredUrl(env: Env, name: string, protocols: string[], rejectLocalhost = false): void {
  const value = requiredValue(env, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol.`);
  if (rejectLocalhost && isLocalHostname(url.hostname)) {
    throw new Error(`${name} must not target localhost in production.`);
  }
}

function boundedInteger(env: Env, name: string, min: number, max: number): void {
  const raw = requiredValue(env, name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
