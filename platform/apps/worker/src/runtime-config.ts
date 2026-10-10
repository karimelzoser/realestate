type Env = NodeJS.ProcessEnv;
const PLACEHOLDER_PATTERN = /(replace|change[-_ ]?me|placeholder|example-secret|your[-_ ]|dummy)/i;

export function validateWorkerRuntimeConfig(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const failures: string[] = [];
  requireUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:'], failures);
  requireUrl(env, 'NOTIFICATION_GATEWAY_URL', ['https:', 'http:'], failures, true);
  requireSecret(env, 'NOTIFICATION_GATEWAY_TOKEN', 32, failures);
  boundedInteger(env, 'OUTBOX_POLL_MS', 50, 60_000, failures);
  boundedInteger(env, 'NOTIFICATION_POLL_MS', 100, 60_000, failures);
  boundedInteger(env, 'SLA_SCAN_MS', 1_000, 3_600_000, failures);
  boundedInteger(env, 'INSTALLMENT_REMINDER_SCAN_MS', 1_000, 3_600_000, failures);
  boundedInteger(env, 'COMMISSION_DUE_SCAN_MS', 1_000, 3_600_000, failures);

  if (failures.length > 0) throw new Error(`Invalid production worker configuration:\n- ${failures.join('\n- ')}`);
}

export const assertWorkerRuntimeConfiguration = validateWorkerRuntimeConfig;

function requiredValue(env: Env, name: string, failures: string[]): string | null {
  const value = env[name]?.trim();
  if (!value) {
    failures.push(`${name} is required in production.`);
    return null;
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    failures.push(`${name} contains a placeholder value.`);
    return null;
  }
  return value;
}

function requireSecret(env: Env, name: string, minLength: number, failures: string[]): void {
  const value = requiredValue(env, name, failures);
  if (value && value.length < minLength) failures.push(`${name} must contain at least ${minLength} characters.`);
}

function requireUrl(env: Env, name: string, protocols: string[], failures: string[], rejectLocalhost = false): void {
  const value = requiredValue(env, name, failures);
  if (!value) return;
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) failures.push(`${name} uses an unsupported protocol.`);
    if (rejectLocalhost && isLocalHostname(url.hostname)) failures.push(`${name} must not target localhost in production.`);
  } catch {
    failures.push(`${name} must be a valid URL.`);
  }
}

function boundedInteger(env: Env, name: string, min: number, max: number, failures: string[]): void {
  const raw = requiredValue(env, name, failures);
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) failures.push(`${name} must be an integer between ${min} and ${max}.`);
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
